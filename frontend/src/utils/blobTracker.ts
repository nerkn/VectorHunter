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
  missMs: number
  residualSpeed: number
  lowResidualFrames: number
  highJerkFrames: number
  avgArea: number
}

interface TrackerConfig {
  searchRadius: number
  minArea: number
  maxArea: number
  confirmationFrames: number
  demotionFrames: number
  jerkDemotionFrames: number
  jerkThreshold: number
  residualThreshold: number
  velocitySmoothing: number
  maxMissingMs: number
  frameDt: number
}

const DEFAULT_CONFIG: TrackerConfig = {
  searchRadius: 30,
  minArea: 4,
  maxArea: 128,
  confirmationFrames: 3,
  demotionFrames: 15,
  jerkDemotionFrames: 5,
  jerkThreshold: 60,
  residualThreshold: 8,
  velocitySmoothing: 0.5,
  maxMissingMs: 600,
  frameDt: 1 / 24,
}

export class BlobTracker {
  private table: TrackedBlob[] = []
  private nextId = 1
  private displayPool: number[] = []
  private activeDisplayIds = new Set<number>()
  private config: TrackerConfig
  private binary: Uint8Array | null = null
  private imgW = 0
  private imgH = 0

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

  update(): TrackedBlob[] {
    if (!this.binary) return this.table
    const now = performance.now()
    const dt = this.config.frameDt

    if (this.table.length === 0) {
      this.initialScan(now)
      return this.table
    }

    this.verify(now, dt)
    this.deduplicate()
    this.detectNew(now)
    this.classify()
    this.expire()

    return this.table
  }

  getTracked(): TrackedBlob[] {
    return this.table
  }

  getByDisplayId(displayId: number): TrackedBlob | undefined {
    return this.table.find(t => t.displayId === displayId)
  }

  reset() {
    this.table = []
    this.nextId = 1
    this.activeDisplayIds.clear()
    this.displayPool = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  }

  private verify(now: number, dt: number) {
    for (const t of this.table) {
      const predCx = t.cx + t.vx * dt
      const predCy = t.cy + t.vy * dt
      const found = this.searchAround(predCx, predCy, this.config.searchRadius)

      if (found) {
        const rawVx = (found.cx - t.cx) / dt
        const rawVy = (found.cy - t.cy) / dt
        const a = this.config.velocitySmoothing
        const newVx = t.vx * (1 - a) + rawVx * a
        const newVy = t.vy * (1 - a) + rawVy * a
        const jerk = Math.sqrt((newVx - t.vx) ** 2 + (newVy - t.vy) ** 2)

        t.cx = found.cx
        t.cy = found.cy
        t.vx = newVx
        t.vy = newVy
        t.area = found.area
        t.bbox = found.bbox
        t.avgArea = t.avgArea * 0.7 + found.area * 0.3
        t.missMs = 0
        t.framesSeen++
        t.lastSeen = now
        t.highJerkFrames = jerk > this.config.jerkThreshold ? t.highJerkFrames + 1 : 0
      } else {
        t.cx = predCx
        t.cy = predCy
        t.missMs += dt * 1000
        t.highJerkFrames++
      }
    }
  }

  private deduplicate() {
    const toRemove = new Set<number>()
    for (let i = 0; i < this.table.length; i++) {
      if (toRemove.has(this.table[i].internalId)) continue
      for (let j = i + 1; j < this.table.length; j++) {
        if (toRemove.has(this.table[j].internalId)) continue
        const a = this.table[i]
        const b = this.table[j]
        const dist = Math.sqrt((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2)
        if (dist < 5) {
          const victim = a.framesSeen < b.framesSeen ? a : b
          toRemove.add(victim.internalId)
          if (victim.displayId !== null) this.releaseDisplayId(victim.displayId)
        }
      }
    }
    if (toRemove.size > 0) {
      this.table = this.table.filter(t => !toRemove.has(t.internalId))
    }
  }

  private detectNew(now: number) {
    if (!this.binary) return

    const covered = new Uint8Array(this.imgW * this.imgH)
    const r = this.config.searchRadius

    for (const t of this.table) {
      if (t.missMs > this.config.maxMissingMs) continue
      const x0 = Math.max(0, Math.round(t.cx - r))
      const y0 = Math.max(0, Math.round(t.cy - r))
      const x1 = Math.min(this.imgW, Math.round(t.cx + r))
      const y1 = Math.min(this.imgH, Math.round(t.cy + r))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          covered[y * this.imgW + x] = 1
        }
      }
    }

    const visited = new Uint8Array(this.imgW * this.imgH)

    for (let y = 0; y < this.imgH; y++) {
      for (let x = 0; x < this.imgW; x++) {
        const px = y * this.imgW + x
        if (covered[px] || visited[px] || !this.binary[px]) continue

        const blob = this.floodFillFull(x, y, visited)
        if (blob && blob.area >= this.config.minArea && blob.area <= this.config.maxArea) {
          this.insertEntry(blob, now)
        }
      }
    }
  }

  private classify() {
    const noise = this.table.filter(t => t.displayId === null && t.framesSeen > 1)
    let bgVx = 0, bgVy = 0

    if (noise.length > 0) {
      const vxs = noise.map(t => t.vx).sort((a, b) => a - b)
      const vys = noise.map(t => t.vy).sort((a, b) => a - b)
      bgVx = vxs[Math.floor(vxs.length / 2)]
      bgVy = vys[Math.floor(vys.length / 2)]
    }

    for (const t of this.table) {
      const rvx = t.vx - bgVx
      const rvy = t.vy - bgVy
      t.residualSpeed = Math.sqrt(rvx * rvx + rvy * rvy)
      t.lowResidualFrames = t.residualSpeed > this.config.residualThreshold ? 0 : t.lowResidualFrames + 1
    }

    for (const t of this.table) {
      if (t.displayId === null) continue
      if (t.lowResidualFrames >= this.config.demotionFrames
        || t.highJerkFrames >= this.config.jerkDemotionFrames) {
        this.releaseDisplayId(t.displayId)
        t.displayId = null
        t.lowResidualFrames = 0
        t.highJerkFrames = 0
      }
    }

    const speed = (t: TrackedBlob) => Math.sqrt(t.vx * t.vx + t.vy * t.vy)
    const candidates = this.table
      .filter(t =>
        t.displayId === null
        && t.framesSeen >= this.config.confirmationFrames
        && speed(t) > this.config.residualThreshold
        && t.highJerkFrames < this.config.jerkDemotionFrames
      )
      .sort((a, b) => speed(b) - speed(a))

    for (const t of candidates) {
      if (this.activeDisplayIds.size >= this.displayPool.length) break
      t.displayId = this.allocateDisplayId()
    }
  }

  private expire() {
    this.table = this.table.filter(t => {
      const maxMs = t.displayId !== null ? this.config.maxMissingMs * 2 : this.config.maxMissingMs
      if (t.missMs > maxMs) {
        if (t.displayId !== null) this.releaseDisplayId(t.displayId)
        return false
      }
      return true
    })
  }

  private searchAround(
    cx: number, cy: number, radius: number
  ): { cx: number; cy: number; area: number; bbox: [number, number, number, number] } | null {
    if (!this.binary) return null

    const x0 = Math.max(0, Math.round(cx - radius))
    const y0 = Math.max(0, Math.round(cy - radius))
    const x1 = Math.min(this.imgW, Math.round(cx + radius))
    const y1 = Math.min(this.imgH, Math.round(cy + radius))

    let bestDist = Infinity
    let seedX = -1, seedY = -1

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (this.binary[y * this.imgW + x]) {
          const d = (x - cx) ** 2 + (y - cy) ** 2
          if (d < bestDist) {
            bestDist = d
            seedX = x
            seedY = y
          }
        }
      }
    }

    if (seedX < 0) return null

    const visited = new Set<number>()
    const startPx = seedY * this.imgW + seedX
    visited.add(startPx)

    const queue = [startPx]
    let sumX = 0, sumY = 0, count = 0
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0

    while (queue.length > 0) {
      const px = queue.shift()!
      const x = px % this.imgW
      const y = (px - x) / this.imgW

      sumX += x
      sumY += y
      count++
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue
          const npx = ny * this.imgW + nx
          if (visited.has(npx) || !this.binary[npx]) continue
          visited.add(npx)
          queue.push(npx)
        }
      }
    }

    if (count < this.config.minArea) return null

    return {
      cx: Math.round(sumX / count),
      cy: Math.round(sumY / count),
      area: count,
      bbox: [minX, minY, maxX + 1, maxY + 1],
    }
  }

  private floodFillFull(
    startX: number, startY: number, visited: Uint8Array
  ): { cx: number; cy: number; area: number; bbox: [number, number, number, number] } | null {
    const startPx = startY * this.imgW + startX
    visited[startPx] = 1

    const queue = [startPx]
    let sumX = 0, sumY = 0, count = 0
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0

    while (queue.length > 0) {
      const px = queue.shift()!
      const x = px % this.imgW
      const y = (px - x) / this.imgW

      sumX += x
      sumY += y
      count++
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= this.imgW || ny < 0 || ny >= this.imgH) continue
          const npx = ny * this.imgW + nx
          if (visited[npx] || !this.binary![npx]) continue
          visited[npx] = 1
          queue.push(npx)
        }
      }
    }

    if (count === 0) return null

    return {
      cx: Math.round(sumX / count),
      cy: Math.round(sumY / count),
      area: count,
      bbox: [minX, minY, maxX + 1, maxY + 1],
    }
  }

  private insertEntry(
    blob: { cx: number; cy: number; area: number; bbox: [number, number, number, number] },
    now: number
  ) {
    this.table.push({
      internalId: this.nextId++,
      displayId: null,
      cx: blob.cx,
      cy: blob.cy,
      vx: 0,
      vy: 0,
      area: blob.area,
      bbox: blob.bbox,
      lastSeen: now,
      born: now,
      framesSeen: 1,
      missMs: 0,
      residualSpeed: 0,
      lowResidualFrames: 0,
      highJerkFrames: 0,
      avgArea: blob.area,
    })
  }

  private initialScan(now: number) {
    if (!this.binary) return
    const visited = new Uint8Array(this.imgW * this.imgH)

    for (let y = 0; y < this.imgH; y++) {
      for (let x = 0; x < this.imgW; x++) {
        const px = y * this.imgW + x
        if (visited[px] || !this.binary[px]) continue

        const blob = this.floodFillFull(x, y, visited)
        if (blob && blob.area >= this.config.minArea && blob.area <= this.config.maxArea) {
          this.insertEntry(blob, now)
        }
      }
    }
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
