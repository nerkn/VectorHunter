import { BlobFinder } from './blobFinder'

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
  framesSeen: number
  missMs: number
  residualSpeed: number
  lowResidualFrames: number
  highResidualFrames: number
  highJerkFrames: number
  avgArea: number
  refSliceH: Uint8Array | null
  refSliceV: Uint8Array | null
  refBlock: Uint8Array | null
  refBlockW: number
  refBlockH: number
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
  maxNoiseObjects: number
  frameDt: number
}

const DEFAULT_CONFIG: TrackerConfig = {
  searchRadius: 30,
  minArea: 4,
  maxArea: 256,
  confirmationFrames: 10,
  demotionFrames: 10,
  jerkDemotionFrames: 10,
  jerkThreshold: 120,
  residualThreshold: 25,
  velocitySmoothing: 0.5,
  maxMissingMs: 300,
  maxNoiseObjects: 15,
  frameDt: 1 / 24,
}

export class BlobTracker {
  private table: TrackedBlob[] = []
  private nextId = 1
  private displayPool: number[] = []
  private activeDisplayIds = new Set<number>()
  private config: TrackerConfig
  private gray: Uint8Array | null = null
  private imgW = 0
  private imgH = 0
  private threshold = 25

  private blobFinder = new BlobFinder()

  private _coveredBuf: Uint8Array = new Uint8Array(0)

  constructor(config: Partial<TrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.displayPool = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  }

  setGrayImage(gray: Uint8Array, w: number, h: number, threshold: number) {
    this.gray = gray
    this.imgW = w
    this.imgH = h
    this.threshold = threshold
    this.blobFinder.setGray(gray, w, h)
    const n = w * h
    if (this._coveredBuf.length !== n) {
      this._coveredBuf = new Uint8Array(n)
    }
  }

  setAreaRange(min: number, max: number) {
    this.config.minArea = min
    this.config.maxArea = max
  }

  update(): TrackedBlob[] {
    if (!this.gray) return this.table
    const now = performance.now()
    const dt = this.config.frameDt

    if (this.table.length === 0) {
      this.initialScan(now)
      return this.table
    }

    const t0 = performance.now()
    this.verify(now, dt)
    const tVerify = performance.now()
    this.detectNew(now)
    const tDetect = performance.now()
    this.deduplicate()
    const tDedup = performance.now()
    this.classify()
    this.expire()
    const tEnd = performance.now()
    if (tEnd - t0 > 5) console.log(`tracker: verify=${(tVerify-t0).toFixed(1)}ms detectNew=${(tDetect-tVerify).toFixed(1)}ms dedup=${(tDedup-tDetect).toFixed(1)}ms total=${(tEnd-t0).toFixed(1)}ms objs=${this.table.length} withId=${this.table.filter(t=>t.displayId!==null).length}`)

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

  private extractSliceH(cx: number, cy: number, halfW: number, out: Uint8Array): void {
    const len = halfW * 2 + 1
    for (let i = 0; i < len; i++) {
      const x = Math.round(cx - halfW + i)
      if (x < 0 || x >= this.imgW) { out[i] = 0; continue }
      const ry = Math.round(cy)
      if (ry < 0 || ry >= this.imgH) { out[i] = 0; continue }
      out[i] = this.gray![ry * this.imgW + x]
    }
  }

  private extractSliceV(cx: number, cy: number, halfH: number, out: Uint8Array): void {
    const len = halfH * 2 + 1
    for (let i = 0; i < len; i++) {
      const y = Math.round(cy - halfH + i)
      if (y < 0 || y >= this.imgH) { out[i] = 0; continue }
      const rx = Math.round(cx)
      if (rx < 0 || rx >= this.imgW) { out[i] = 0; continue }
      out[i] = this.gray![y * this.imgW + rx]
    }
  }

  private sliceSad(a: Uint8Array, b: Uint8Array): number {
    let sum = 0
    const len = Math.min(a.length, b.length)
    for (let i = 0; i < len; i++) sum += Math.abs(a[i] - b[i])
    return sum
  }

  private blockSad(ref: Uint8Array, refW: number, refH: number, gray: Uint8Array, imgW: number, imgH: number, cx: number, cy: number): number {
    let sad = 0
    const hw = Math.floor(refW / 2)
    const hh = Math.floor(refH / 2)
    for (let dy = -hh; dy <= hh; dy++) {
      for (let dx = -hw; dx <= hw; dx++) {
        const rx = cx + dx
        const ry = cy + dy
        const ri = (dy + hh) * refW + (dx + hw)
        if (rx < 0 || rx >= imgW || ry < 0 || ry >= imgH) { sad += ref[ri]; continue }
        sad += Math.abs(ref[ri] - gray[ry * imgW + rx])
      }
    }
    return sad
  }

  private findSliceMatch(
    predCx: number, predCy: number,
    searchRadius: number,
    halfW: number, halfH: number,
    t: TrackedBlob | null
  ): { cx: number; cy: number; area: number; bbox: [number, number, number, number] } | null {
    if (!this.gray) return null

    const x0 = Math.max(0, Math.round(predCx - searchRadius))
    const y0 = Math.max(0, Math.round(predCy - searchRadius))
    const x1 = Math.min(this.imgW, Math.round(predCx + searchRadius))
    const y1 = Math.min(this.imgH, Math.round(predCy + searchRadius))

    if (!t || !t.refBlock || t.refBlockW <= 0 || t.refBlockH <= 0) return null

    let bestCx = predCx
    let bestCy = predCy
    let bestSad = Infinity

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (this.gray![y * this.imgW + x] <= this.threshold) continue
        const sad = this.blockSad(t.refBlock, t.refBlockW, t.refBlockH, this.gray!, this.imgW, this.imgH, x, y)
        if (sad < bestSad) {
          bestSad = sad
          bestCx = x
          bestCy = y
        }
      }
    }

    if (bestSad === Infinity) return null
    const maxSad = t.refBlockW * t.refBlockH * 80
    if (bestSad > maxSad) return null

    return this.computeCentroid(bestCx, bestCy, halfW, halfH)
  }

  private computeCentroid(cx: number, cy: number, halfW: number, halfH: number): { cx: number; cy: number; area: number; bbox: [number, number, number, number] } | null {
    const x0b = Math.max(0, Math.round(cx - halfW))
    const y0b = Math.max(0, Math.round(cy - halfH))
    const x1b = Math.min(this.imgW, Math.round(cx + halfW))
    const y1b = Math.min(this.imgH, Math.round(cy + halfH))

    let sumX = 0, sumY = 0, count = 0
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0
    const blobThr = this.threshold * 1.5

    for (let y = y0b; y < y1b; y++) {
      for (let x = x0b; x < x1b; x++) {
        const val = this.gray![y * this.imgW + x]
        if (val > blobThr) {
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

    if (count < this.config.minArea) return null

    const pad = 1
    return {
      cx: Math.round(sumX / count),
      cy: Math.round(sumY / count),
      area: count,
      bbox: [
        Math.max(0, minX - pad),
        Math.max(0, minY - pad),
        Math.min(this.imgW, maxX + 1 + pad),
        Math.min(this.imgH, maxY + 1 + pad),
      ],
    }
  }

  private findNearestBlob(cx: number, cy: number, radius: number, avgArea: number = 0): { cx: number; cy: number; area: number; bbox: [number, number, number, number] } | null {
    if (!this.gray) return null

    const x0 = Math.max(0, Math.round(cx - radius))
    const y0 = Math.max(0, Math.round(cy - radius))
    const x1 = Math.min(this.imgW, Math.round(cx + radius))
    const y1 = Math.min(this.imgH, Math.round(cy + radius))

    const blobThr = this.threshold * 1.5

    const visited = new Uint8Array(this.imgW * this.imgH)
    const queue = new Int32Array(this.imgW * this.imgH)
    const blobs: { cx: number; cy: number; area: number; minX: number; minY: number; maxX: number; maxY: number }[] = []

    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) {
        const px = sy * this.imgW + sx
        if (visited[px] || this.gray![px] <= blobThr) continue
        visited[px] = 1
        let head = 0, tail = 1
        queue[0] = px
        let sumX = 0, sumY = 0, count = 0
        let minX = sx, minY = sy, maxX = sx, maxY = sy

        while (head < tail) {
          const cur = queue[head++]
          const bx = cur % this.imgW
          const by = (cur - bx) / this.imgW
          sumX += bx
          sumY += by
          count++
          if (bx < minX) minX = bx
          if (by < minY) minY = by
          if (bx > maxX) maxX = bx
          if (by > maxY) maxY = by

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = bx + dx, ny = by + dy
              if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue
              const npx = ny * this.imgW + nx
              if (visited[npx] || this.gray![npx] <= blobThr) continue
              visited[npx] = 1
              queue[tail++] = npx
            }
          }
        }

        if (count >= this.config.minArea) {
          blobs.push({ cx: Math.round(sumX / count), cy: Math.round(sumY / count), area: count, minX, minY, maxX, maxY })
        }
      }
    }

    if (blobs.length === 0) return null

    let best: typeof blobs[0] | null = null
    let bestDist = Infinity
    for (const b of blobs) {
      const d2 = (b.cx - cx) ** 2 + (b.cy - cy) ** 2
      if (d2 < bestDist) {
        if (avgArea > 0 && (b.area < avgArea * 0.2 || b.area > avgArea * 5)) continue
        bestDist = d2
        best = b
      }
    }

    if (!best) return null

    const pad = 1
    return {
      cx: best.cx,
      cy: best.cy,
      area: best.area,
      bbox: [
        Math.max(0, best.minX - pad),
        Math.max(0, best.minY - pad),
        Math.min(this.imgW, best.maxX + 1 + pad),
        Math.min(this.imgH, best.maxY + 1 + pad),
      ],
    }
  }

  private verify(now: number, dt: number) {
    for (const t of this.table) {
      const predCx = t.cx + t.vx * dt
      const predCy = t.cy + t.vy * dt

      const [bx0, by0, bx1, by1] = t.bbox
      const halfW = Math.max(8, Math.round((bx1 - bx0) / 2))
      const halfH = Math.max(5, Math.round((by1 - by0) / 2))

      let found = this.findSliceMatch(predCx, predCy, this.config.searchRadius, halfW, halfH, t)

      if (!found) {
        found = this.findSliceMatch(t.cx, t.cy, this.config.searchRadius * 2, halfW, halfH, t)
      }

      if (found) {
        const rawVx = (found.cx - t.cx) / dt
        const rawVy = (found.cy - t.cy) / dt
        const a = this.config.velocitySmoothing
        const maxVel = Math.max(500, t.area * 30)
        const clampedRawVx = Math.max(-maxVel, Math.min(maxVel, rawVx))
        const clampedRawVy = Math.max(-maxVel, Math.min(maxVel, rawVy))
        const newVx = t.vx * (1 - a) + clampedRawVx * a
        const newVy = t.vy * (1 - a) + clampedRawVy * a
        const jerk = Math.sqrt((newVx - t.vx) ** 2 + (newVy - t.vy) ** 2)
        const consistentMatch = Math.abs(rawVx - t.vx) < this.config.jerkThreshold * 2 && Math.abs(rawVy - t.vy) < this.config.jerkThreshold * 2

        t.cx = found.cx
        t.cy = found.cy
        t.vx = newVx
        t.vy = newVy
        t.missMs = 0
        t.framesSeen++
        t.lastSeen = now
        t.highJerkFrames = jerk > this.config.jerkThreshold ? t.highJerkFrames + 1 : 0

        if (consistentMatch) {
          const clampedArea = Math.min(found.area, t.avgArea * 2)
          t.area = clampedArea
          t.bbox = found.bbox
          t.avgArea = t.avgArea * 0.6 + clampedArea * 0.4
          const sLenH = halfW * 2 + 1
          const sLenV = halfH * 2 + 1
          const newSliceH = new Uint8Array(sLenH)
          const newSliceV = new Uint8Array(sLenV)
          this.extractSliceH(found.cx, found.cy, halfW, newSliceH)
          this.extractSliceV(found.cx, found.cy, halfH, newSliceV)
          t.refSliceH = newSliceH
          t.refSliceV = newSliceV
          const BLOCK_SIZE = 8
          const bw = BLOCK_SIZE
          const bh = BLOCK_SIZE
          const block = new Uint8Array(bw * bh)
          for (let dy = 0; dy < bh; dy++) {
            for (let dx = 0; dx < bw; dx++) {
              const px = Math.round(found.cx - Math.floor(bw / 2) + dx)
              const py = Math.round(found.cy - Math.floor(bh / 2) + dy)
              if (px < 0 || px >= this.imgW || py < 0 || py >= this.imgH) continue
              block[dy * bw + dx] = this.gray![py * this.imgW + px]
            }
          }
          t.refBlock = block
          t.refBlockW = bw
          t.refBlockH = bh
        } else {
          const clampedArea = Math.min(found.area, t.avgArea * 1.2)
          t.area = clampedArea
          t.bbox = found.bbox
          t.avgArea = t.avgArea * 0.9 + clampedArea * 0.1
        }
      } else {
        const fallback = this.findNearestBlob(predCx, predCy, this.config.searchRadius, t.avgArea)
        if (fallback) {
          const rawVx = (fallback.cx - t.cx) / dt
          const rawVy = (fallback.cy - t.cy) / dt
          const a = this.config.velocitySmoothing
          const maxVel = Math.max(500, t.area * 30)
          const clampedRawVx = Math.max(-maxVel, Math.min(maxVel, rawVx))
          const clampedRawVy = Math.max(-maxVel, Math.min(maxVel, rawVy))
          t.vx = t.vx * (1 - a) + clampedRawVx * a
          t.vy = t.vy * (1 - a) + clampedRawVy * a
          t.cx = fallback.cx
          t.cy = fallback.cy
          t.area = fallback.area
          t.bbox = fallback.bbox
          t.missMs = 0
          t.framesSeen++
          t.lastSeen = now
          t.highJerkFrames = 0
        } else {
          t.cx = predCx
          t.cy = predCy
          t.missMs += dt * 1000
          t.highJerkFrames++
          t.vx *= 0.7
          t.vy *= 0.7
        }
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
        const dist2 = (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2
        if (dist2 > this.config.searchRadius ** 2) continue
        const velDiff = Math.sqrt((a.vx - b.vx) ** 2 + (a.vy - b.vy) ** 2)
        const avgSpeed = (Math.sqrt(a.vx ** 2 + a.vy ** 2) + Math.sqrt(b.vx ** 2 + b.vy ** 2)) / 2
        if (velDiff > avgSpeed * 0.5 + 20) continue
        const survivor = a.framesSeen >= b.framesSeen ? a : b
        const victim = survivor === a ? b : a
        toRemove.add(victim.internalId)
        if (victim.displayId !== null) {
          if (survivor.displayId === null) {
            survivor.displayId = victim.displayId
          } else {
            this.releaseDisplayId(victim.displayId)
          }
        }
      }
    }
    if (toRemove.size > 0) {
      this.table = this.table.filter(t => !toRemove.has(t.internalId))
    }
  }

  private detectNew(now: number) {
    if (!this.gray) return

    this._coveredBuf.fill(0)
    const covered = this._coveredBuf
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

    const blobs = this.blobFinder.nearbyBlobMerge({
      threshold: 25,
      mergeDistance: 2,
      nmsDistance: 15,
      minArea: this.config.minArea,
      maxArea: this.config.maxArea,
    })

    const missed = this.table.filter(t => t.missMs > 0 && t.missMs <= this.config.maxMissingMs)

    for (const blob of blobs) {
      if (covered[Math.round(blob.cy) * this.imgW + Math.round(blob.cx)]) continue

      const pad = 1
      const bbox: [number, number, number, number] = [
        Math.max(0, Math.round(blob.cx - blob.w / 2) - pad),
        Math.max(0, Math.round(blob.cy - blob.h / 2) - pad),
        Math.min(this.imgW, Math.round(blob.cx + blob.w / 2) + pad),
        Math.min(this.imgH, Math.round(blob.cy + blob.h / 2) + pad),
      ]

      let adopted = false
      for (const t of missed) {
        const d2 = (blob.cx - t.cx) ** 2 + (blob.cy - t.cy) ** 2
        if (d2 < (r * 2) ** 2) {
          t.cx = blob.cx
          t.cy = blob.cy
          t.area = blob.w * blob.h
          t.bbox = bbox
          t.missMs = 0
          t.framesSeen++
          t.lastSeen = now
          adopted = true
          break
        }
      }

      if (!adopted) {
        this.insertEntry({ cx: blob.cx, cy: blob.cy, area: blob.w * blob.h, bbox }, now)
      }
    }
  }

  private classify() {
    const allTracks = this.table.filter(t => t.framesSeen >= 2)
    let bgVx = 0, bgVy = 0

    if (allTracks.length >= 3) {
      const vxs = allTracks.map(t => t.vx).sort((a, b) => a - b)
      const vys = allTracks.map(t => t.vy).sort((a, b) => a - b)
      const mid = Math.floor(vxs.length / 2)
      bgVx = vxs.length % 2 === 0 ? (vxs[mid - 1] + vxs[mid]) / 2 : vxs[mid]
      bgVy = vys.length % 2 === 0 ? (vys[mid - 1] + vys[mid]) / 2 : vys[mid]
    }

    for (const t of this.table) {
      const rvx = t.vx - bgVx
      const rvy = t.vy - bgVy
      t.residualSpeed = Math.sqrt(rvx * rvx + rvy * rvy)

      if (t.residualSpeed > this.config.residualThreshold) {
        t.lowResidualFrames = 0
        t.highResidualFrames++
      } else {
        t.lowResidualFrames++
      }
    }

    for (const t of this.table) {
      if (t.displayId === null) continue
      const jerkLimit = t.area < 10 ? this.config.jerkDemotionFrames * 3 : this.config.jerkDemotionFrames
      const isStationary = Math.abs(t.vx) < 1 && Math.abs(t.vy) < 1
      if (t.lowResidualFrames >= (isStationary ? 3 : this.config.demotionFrames)
        || t.highJerkFrames >= jerkLimit) {
        this.releaseDisplayId(t.displayId)
        t.displayId = null
        t.lowResidualFrames = 0
        t.highJerkFrames = 0
      }
    }

    for (const t of this.table) {
      if (t.displayId !== null && t.area < this.config.minArea) {
        this.releaseDisplayId(t.displayId)
        t.displayId = null
      }
    }

    const candidates = this.table
      .filter(t => {
        if (t.displayId !== null) return false
        if (t.highResidualFrames < 5) return false
        if (t.framesSeen < 3) return false
        if (t.area < this.config.minArea) return false
        if (Math.abs(t.vx) + Math.abs(t.vy) < 1) return false
        const jerkLimit = t.area < this.config.minArea ? this.config.jerkDemotionFrames * 3 : this.config.jerkDemotionFrames
        if (t.highJerkFrames >= jerkLimit) return false
        return true
      })
      .sort((a, b) => {
        if (Math.abs(a.vx) + Math.abs(a.vy) < 1 && Math.abs(b.vx) + Math.abs(b.vy) >= 1) return 1
        return b.residualSpeed - a.residualSpeed
      })

    for (const t of candidates) {
      if (this.activeDisplayIds.size >= this.displayPool.length) break
      t.displayId = this.allocateDisplayId()
    }
  }

  private expire() {
    this.table = this.table.filter(t => {
      if (t.cx < -50 || t.cy < -50 || t.cx > this.imgW + 50 || t.cy > this.imgH + 50) {
        if (t.displayId !== null) this.releaseDisplayId(t.displayId)
        return false
      }
      const maxMs = t.displayId !== null ? this.config.maxMissingMs * 2 : this.config.maxMissingMs
      if (t.missMs > maxMs) {
        if (t.displayId !== null) this.releaseDisplayId(t.displayId)
        return false
      }
      return true
    })
    const noise = this.table.filter(t => t.displayId === null)
    if (noise.length > this.config.maxNoiseObjects) {
      noise.sort((a, b) => {
        if (a.area >= 15 && b.area < 15) return -1
        if (b.area >= 15 && a.area < 15) return 1
        if (Math.abs(a.vx) + Math.abs(a.vy) < 1 && Math.abs(b.vx) + Math.abs(b.vy) >= 1) return -1
        return b.framesSeen - a.framesSeen
      })
      const toRemove = new Set(noise.slice(this.config.maxNoiseObjects).map(t => t.internalId))
      this.table = this.table.filter(t => !toRemove.has(t.internalId))
    }
  }

  private insertEntry(
    blob: { cx: number; cy: number; area: number; bbox: [number, number, number, number] },
    now: number
  ) {
    const noise = this.table.filter(t => t.displayId === null)
    if (noise.length >= this.config.maxNoiseObjects) {
      let victim = noise[0]
      for (const n of noise) {
        if (n.area >= 15) continue
        if (n.framesSeen < victim.framesSeen || (n.framesSeen === victim.framesSeen && n.area < victim.area)) victim = n
      }
      if (victim.area >= 15) return
      this.table = this.table.filter(t => t.internalId !== victim.internalId)
    }

    const BLOCK_SIZE = 8
    const bw = BLOCK_SIZE
    const bh = BLOCK_SIZE
    let block: Uint8Array | null = null
    if (this.gray) {
      block = new Uint8Array(bw * bh)
      for (let dy = 0; dy < bh; dy++) {
        for (let dx = 0; dx < bw; dx++) {
          const px = Math.round(blob.cx - Math.floor(bw / 2) + dx)
          const py = Math.round(blob.cy - Math.floor(bh / 2) + dy)
          if (px < 0 || px >= this.imgW || py < 0 || py >= this.imgH) continue
          block[dy * bw + dx] = this.gray[py * this.imgW + px]
        }
      }
    }

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
      framesSeen: 1,
      missMs: 0,
      residualSpeed: 0,
      lowResidualFrames: 0,
      highResidualFrames: 0,
      highJerkFrames: 0,
      avgArea: blob.area,
      refSliceH: null,
      refSliceV: null,
      refBlock: block,
      refBlockW: bw,
      refBlockH: bh,
    })
  }

  private initialScan(now: number) {
    if (!this.gray) return

    const blobs = this.blobFinder.nearbyBlobMerge({
      threshold: 25,
      mergeDistance: 2,
      nmsDistance: 15,
      minArea: this.config.minArea,
      maxArea: this.config.maxArea,
    })

    for (const blob of blobs) {
      const pad = 1
      const bbox: [number, number, number, number] = [
        Math.max(0, Math.round(blob.cx - blob.w / 2) - pad),
        Math.max(0, Math.round(blob.cy - blob.h / 2) - pad),
        Math.min(this.imgW, Math.round(blob.cx + blob.w / 2) + pad),
        Math.min(this.imgH, Math.round(blob.cy + blob.h / 2) + pad),
      ]
      this.insertEntry({ cx: blob.cx, cy: blob.cy, area: blob.w * blob.h, bbox }, now)
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
