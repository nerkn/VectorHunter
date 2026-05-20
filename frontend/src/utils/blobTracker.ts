import { Blob } from './blobDetector'

export interface TrackedBlob {
  internalId: number
  displayId: number | null
  cx: number
  cy: number
  vx: number
  vy: number
  area: number
  bbox: [number, number, number, number]
  lastSeen: number
  born: number
  framesSeen: number
  residualSpeed: number
  lowResidualFrames: number
  avgArea: number
  avgAspect: number
}

interface TrackerConfig {
  maxMissingMs: number
  confirmationFrames: number
  demotionFrames: number
  velocitySmoothing: number
  searchRadius: number
  enlargeStep: number
  maxEnlarge: number
  minWindowPixels: number
  minArea: number
  maxArea: number
  residualThreshold: number
  gridSize: number
  fullScanInterval: number
}

const DEFAULT_CONFIG: TrackerConfig = {
  maxMissingMs: 600,
  confirmationFrames: 5,
  demotionFrames: 15,
  velocitySmoothing: 0.5,
  searchRadius: 30,
  enlargeStep: 15,
  maxEnlarge: 60,
  minWindowPixels: 4,
  minArea: 8,
  maxArea: 128,
  residualThreshold: 15,
  gridSize: 16,
  fullScanInterval: 5,
}

export class BlobTracker {
  private tracked: TrackedBlob[] = []
  private nextId = 1
  private displayPool: number[] = []
  private activeDisplayIds = new Set<number>()
  private config: TrackerConfig
  private binary: Uint8Array | null = null
  private imgW = 0
  private imgH = 0
  private frameCount = 0
  private lastDm: { dx: number; dy: number } = { dx: 0, dy: 0 }

  constructor(config: Partial<TrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.displayPool = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  }

  setBinaryImage(binary: Uint8Array, w: number, h: number) {
    this.binary = binary
    this.imgW = w
    this.imgH = h
  }

  setAreaRange(min: number, max: number) {
    this.config.minArea = min
    this.config.maxArea = max
  }

  update(rawBlobs?: Blob[]): TrackedBlob[] {
    if (!this.binary) return this.tracked
    const now = performance.now()
    this.frameCount++

    if (this.tracked.length === 0 && rawBlobs && rawBlobs.length > 0) {
      this.bootstrap(rawBlobs, now)
      return this.tracked
    }

    if (this.frameCount === 1 && rawBlobs) {
      this.bootstrap(rawBlobs, now)
      return this.tracked
    }

    const examined = new Set<number>()

    const noise = this.tracked.filter(t => t.displayId === null)
    const targets = this.tracked.filter(t => t.displayId !== null)

    const dm = this.searchNoise(noise, now, examined)

    const targetResults = this.searchTargets(targets, dm, now, examined)

    this.updateResidualSpeeds(dm)
    this.demoteTargets(targetResults)

    if (this.frameCount % this.config.fullScanInterval === 0) {
      this.scanUnexamined(now, examined)
    }

    this.tracked = [...noise, ...targetResults]
    this.confirmBlobs()
    this.expireBlobs(now)

    return this.tracked
  }

  getTracked(): TrackedBlob[] {
    return this.tracked
  }

  getByDisplayId(displayId: number): TrackedBlob | undefined {
    return this.tracked.find(t => t.displayId === displayId)
  }

  reset() {
    this.tracked = []
    this.nextId = 1
    this.activeDisplayIds.clear()
    this.displayPool = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    this.frameCount = 0
    this.lastDm = { dx: 0, dy: 0 }
  }

  private bootstrap(rawBlobs: Blob[], now: number) {
    for (const b of rawBlobs) {
      this.tracked.push({
        internalId: this.nextId++,
        displayId: null,
        cx: b.cx,
        cy: b.cy,
        vx: 0,
        vy: 0,
        area: b.area,
        bbox: b.bbox,
        lastSeen: now,
        born: now,
        framesSeen: 1,
        residualSpeed: 0,
        lowResidualFrames: 0,
        avgArea: b.area,
        avgAspect: 1,
      })
    }
  }

  private searchNoise(noise: TrackedBlob[], now: number, examined: Set<number>): { dx: number; dy: number } {
    const activeNoise = noise.filter(t => (now - t.lastSeen) < 300)
    if (activeNoise.length === 0) return this.lastDm

    let runDx = this.lastDm.dx
    let runDy = this.lastDm.dy
    let count = 0

    for (const prev of activeNoise) {
      const predCx = prev.cx + runDx
      const predCy = prev.cy + runDy

      const firstRadius = count === 0 ? this.config.searchRadius * 2 : this.config.searchRadius
      const found = this.findInBinary(predCx, predCy, firstRadius, examined, 0)

      if (found) {
        const measDt = Math.max(1, now - prev.lastSeen) / 1000
        const dx = found.cx - prev.cx
        const dy = found.cy - prev.cy
        const rawVx = dx / measDt
        const rawVy = dy / measDt
        const a = this.config.velocitySmoothing

        prev.cx = found.cx
        prev.cy = found.cy
        prev.vx = prev.vx * (1 - a) + rawVx * a
        prev.vy = prev.vy * (1 - a) + rawVy * a
        prev.area = found.area
        prev.bbox = found.bbox
        prev.lastSeen = now
        prev.framesSeen++

        count++
        runDx = runDx * (count - 1) / count + dx / count
        runDy = runDy * (count - 1) / count + dy / count
      }
    }

    if (count > 0) {
      const a = 0.5
      this.lastDm.dx = this.lastDm.dx * (1 - a) + runDx * a
      this.lastDm.dy = this.lastDm.dy * (1 - a) + runDy * a
    }

    return this.lastDm
  }

  private searchTargets(
    targets: TrackedBlob[],
    dm: { dx: number; dy: number },
    now: number,
    examined: Set<number>
  ): TrackedBlob[] {
    const result: TrackedBlob[] = []

    for (const prev of targets) {
      const dt = Math.max(1, now - prev.lastSeen) / 1000
      const bgVx = dm.dx / dt
      const bgVy = dm.dy / dt
      const residualVx = prev.vx - bgVx
      const residualVy = prev.vy - bgVy

      let predCx: number
      let predCy: number
      if (prev.residualSpeed > this.config.residualThreshold) {
        predCx = prev.cx + bgVx * dt + residualVx * dt
        predCy = prev.cy + bgVy * dt + residualVy * dt
      } else {
        predCx = prev.cx + dm.dx
        predCy = prev.cy + dm.dy
      }

      let found = this.findInBinary(predCx, predCy, this.config.searchRadius, examined, prev.avgArea)

      if (!found) {
        for (let enlarge = this.config.enlargeStep; enlarge <= this.config.maxEnlarge; enlarge += this.config.enlargeStep) {
          found = this.findInBinary(predCx, predCy, this.config.searchRadius + enlarge, examined, prev.avgArea)
          if (found) break
        }
      }

      if (!found) {
        found = this.findInBinary(prev.cx, prev.cy, this.config.searchRadius * 2, examined, prev.avgArea)
      }

      if (found) {
        const measDt = Math.max(1, now - prev.lastSeen) / 1000
        const rawVx = (found.cx - prev.cx) / measDt
        const rawVy = (found.cy - prev.cy) / measDt
        const a = this.config.velocitySmoothing

        const bw = found.bbox[2] - found.bbox[0]
        const bh = found.bbox[3] - found.bbox[1]
        const aspect = bw > 0 && bh > 0 ? Math.min(bw, bh) / Math.max(bw, bh) : 1

        result.push({
          ...prev,
          cx: found.cx,
          cy: found.cy,
          vx: prev.vx * (1 - a) + rawVx * a,
          vy: prev.vy * (1 - a) + rawVy * a,
          area: found.area,
          bbox: found.bbox,
          lastSeen: now,
          framesSeen: prev.framesSeen + 1,
          avgArea: prev.avgArea * 0.7 + found.area * 0.3,
          avgAspect: prev.avgAspect * 0.7 + aspect * 0.3,
          lowResidualFrames: prev.residualSpeed > this.config.residualThreshold ? 0 : prev.lowResidualFrames + 1,
        })
      } else {
        result.push({
          ...prev,
          cx: predCx,
          cy: predCy,
          lowResidualFrames: prev.lowResidualFrames + 1,
        })
      }
    }

    return result
  }

  private findInBinary(
    cx: number, cy: number, maxRadius: number, examined?: Set<number>, expectedArea?: number
  ): { cx: number; cy: number; area: number; bbox: [number, number, number, number] } | null {
    if (!this.binary) return null

    let radius = maxRadius

    while (radius >= 4) {
      const x0 = Math.max(0, Math.round(cx - radius))
      const y0 = Math.max(0, Math.round(cy - radius))
      const x1 = Math.min(this.imgW, Math.round(cx + radius))
      const y1 = Math.min(this.imgH, Math.round(cy + radius))

      let sumX = 0
      let sumY = 0
      let count = 0
      let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (examined) {
            const gx = Math.floor(x / this.config.gridSize)
            const gy = Math.floor(y / this.config.gridSize)
            examined.add(gy * Math.floor(this.imgW / this.config.gridSize) + gx)
          }
          if (this.binary[y * this.imgW + x]) {
            sumX += x
            sumY += y
            count++
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
          }
        }
      }

      if (count < this.config.minWindowPixels) return null

      if (expectedArea && expectedArea > 0 && count > this.config.maxArea) {
        radius = Math.round(radius * Math.sqrt(this.config.maxArea / count))
        continue
      }

      return {
        cx: Math.round(sumX / count),
        cy: Math.round(sumY / count),
        area: count,
        bbox: [minX, minY, maxX + 1, maxY + 1],
      }
    }

    return null
  }

  private scanUnexamined(now: number, examined: Set<number>) {
    if (!this.binary) return
    const gs = this.config.gridSize
    const cellsX = Math.floor(this.imgW / gs)
    const cellsY = Math.floor(this.imgH / gs)

    const cells: { gx: number; gy: number; cx: number; cy: number; count: number }[] = []

    for (let gy = 0; gy < cellsY; gy++) {
      for (let gx = 0; gx < cellsX; gx++) {
        if (examined.has(gy * cellsX + gx)) continue
        let count = 0
        let sumX = 0
        let sumY = 0
        for (let dy = 0; dy < gs; dy++) {
          for (let dx = 0; dx < gs; dx++) {
            const px = gx * gs + dx
            const py = gy * gs + dy
            if (px < this.imgW && py < this.imgH && this.binary[py * this.imgW + px]) {
              count++
              sumX += px
              sumY += py
            }
          }
        }
        if (count > 0) cells.push({ gx, gy, cx: sumX / count, cy: sumY / count, count })
      }
    }

    if (cells.length === 0) return

    const visited = new Set<number>()
    const newBlobs: { cx: number; cy: number; area: number }[] = []

    for (let i = 0; i < cells.length; i++) {
      if (visited.has(i)) continue
      visited.add(i)
      const cluster = [cells[i]]
      const queue = [i]

      while (queue.length > 0) {
        const cur = queue.shift()!
        for (let j = 0; j < cells.length; j++) {
          if (visited.has(j)) continue
          const dx = Math.abs(cells[cur].cx - cells[j].cx)
          const dy = Math.abs(cells[cur].cy - cells[j].cy)
          if (dx < gs * 1.5 && dy < gs * 1.5) {
            visited.add(j)
            cluster.push(cells[j])
            queue.push(j)
          }
        }
      }

      let totalWeight = 0
      let cx = 0
      let cy = 0
      for (const cell of cluster) {
        cx += cell.cx * cell.count
        cy += cell.cy * cell.count
        totalWeight += cell.count
      }

      if (totalWeight >= this.config.minWindowPixels) {
        newBlobs.push({ cx: Math.round(cx / totalWeight), cy: Math.round(cy / totalWeight), area: totalWeight })
      }
    }

    for (const b of newBlobs) {
      this.tracked.push({
        internalId: this.nextId++,
        displayId: null,
        cx: b.cx,
        cy: b.cy,
        vx: 0,
        vy: 0,
        area: b.area,
        bbox: [b.cx - 4, b.cy - 4, b.cx + 4, b.cy + 4],
        lastSeen: now,
        born: now,
        framesSeen: 1,
        residualSpeed: 0,
        lowResidualFrames: 0,
        avgArea: b.area,
        avgAspect: 1,
      })
    }
  }

  private updateResidualSpeeds(dm: { dx: number; dy: number }) {
    const dt = Math.max(0.001, 1 / 24)
    const bgVx = dm.dx / dt
    const bgVy = dm.dy / dt
    for (const t of this.tracked) {
      const rvx = t.vx - bgVx
      const rvy = t.vy - bgVy
      t.residualSpeed = Math.sqrt(rvx * rvx + rvy * rvy)
    }
  }

  private demoteTargets(targets: TrackedBlob[]) {
    for (const t of targets) {
      if (t.displayId !== null && t.lowResidualFrames >= this.config.demotionFrames) {
        if (t.displayId !== -1) this.releaseDisplayId(t.displayId)
        t.displayId = null
        t.lowResidualFrames = 0
      }
    }
  }

  private confirmBlobs() {
    for (const t of this.tracked) {
      if (t.displayId === null && t.framesSeen >= this.config.confirmationFrames && t.residualSpeed > this.config.residualThreshold) {
        t.displayId = this.allocateDisplayId()
      }
    }
  }

  private expireBlobs(now: number) {
    this.tracked = this.tracked.filter(t => {
      const missingMs = now - t.lastSeen
      const maxMs = t.displayId !== null ? this.config.maxMissingMs * 2 : this.config.maxMissingMs
      if (missingMs > maxMs) {
        if (t.displayId !== null) this.releaseDisplayId(t.displayId)
        return false
      }
      return true
    })
  }

  private allocateDisplayId(): number {
    const available = this.displayPool.filter(id => !this.activeDisplayIds.has(id))
    if (available.length === 0) return -1
    available.sort((a, b) => a - b)
    const id = available[0]
    this.activeDisplayIds.add(id)
    return id
  }

  private releaseDisplayId(id: number) {
    this.activeDisplayIds.delete(id)
  }
}
