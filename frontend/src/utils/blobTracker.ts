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
  born: number
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
  _debug?: boolean
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
  private _sliceHRef: Uint8Array = new Uint8Array(0)
  private _sliceVRef: Uint8Array = new Uint8Array(0)
  private _sliceHCand: Uint8Array = new Uint8Array(0)
  private _sliceVCand: Uint8Array = new Uint8Array(0)

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

  private frameCount = 0

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
    this.deduplicate()
    this.detectNew(now)
    const tDetect = performance.now()
    this.classify()
    this.expire()
    const tEnd = performance.now()
    if (tEnd - t0 > 5) console.log(`tracker: verify=${(tVerify-t0).toFixed(1)}ms detectNew=${(tDetect-tVerify).toFixed(1)}ms total=${(tEnd-t0).toFixed(1)}ms objs=${this.table.length} withId=${this.table.filter(t=>t.displayId!==null).length}`)

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

  findSliceMatchGrid(
    predCx: number, predCy: number,
    searchRadius: number,
    halfW: number, halfH: number,
    t: TrackedBlob | null
  ): { x: number; y: number; sliceScore: number; blockSad: number }[] {
    if (!this.gray) return []

    const sliceLenH = halfW * 2 + 1
    const sliceLenV = halfH * 2 + 1
    if (this._sliceHRef.length < sliceLenH) this._sliceHRef = new Uint8Array(sliceLenH)
    if (this._sliceVRef.length < sliceLenV) this._sliceVRef = new Uint8Array(sliceLenV)
    if (this._sliceHCand.length < sliceLenH) this._sliceHCand = new Uint8Array(sliceLenH)
    if (this._sliceVCand.length < sliceLenV) this._sliceVCand = new Uint8Array(sliceLenV)

    const refH = this._sliceHRef
    const refV = this._sliceVRef
    const candH = this._sliceHCand
    const candV = this._sliceVCand

    if (t && t.refSliceH && t.refSliceV && t.refSliceH.length >= sliceLenH && t.refSliceV.length >= sliceLenV) {
      refH.set(t.refSliceH.subarray(0, sliceLenH))
      refV.set(t.refSliceV.subarray(0, sliceLenV))
    } else {
      this.extractSliceH(predCx, predCy, halfW, refH)
      this.extractSliceV(predCx, predCy, halfH, refV)
    }

    const results: { x: number; y: number; sliceScore: number; blockSad: number }[] = []

    const x0 = Math.max(0, Math.round(predCx - searchRadius))
    const y0 = Math.max(0, Math.round(predCy - searchRadius))
    const x1 = Math.min(this.imgW, Math.round(predCx + searchRadius))
    const y1 = Math.min(this.imgH, Math.round(predCy + searchRadius))

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (this.gray![y * this.imgW + x] <= this.threshold) continue
        this.extractSliceH(x, y, halfW, candH)
        this.extractSliceV(x, y, halfH, candV)
        const score = this.sliceSad(refH, candH) + this.sliceSad(refV, candV)
        const bsad = (t && t.refBlock && t.refBlockW > 0 && t.refBlockH > 0)
          ? this.blockSad(t.refBlock, t.refBlockW, t.refBlockH, this.gray!, this.imgW, this.imgH, x, y)
          : -1
        results.push({ x, y, sliceScore: score, blockSad: bsad })
      }
    }

    results.sort((a, b) => a.sliceScore - b.sliceScore)
    return results
  }

  private findSliceMatch(
    predCx: number, predCy: number,
    searchRadius: number,
    halfW: number, halfH: number,
    t: TrackedBlob | null
  ): { cx: number; cy: number; area: number; bbox: [number, number, number, number] } | null {
    if (!this.gray) return null

    const sliceLenH = halfW * 2 + 1
    const sliceLenV = halfH * 2 + 1
    if (this._sliceHRef.length < sliceLenH) this._sliceHRef = new Uint8Array(sliceLenH)
    if (this._sliceVRef.length < sliceLenV) this._sliceVRef = new Uint8Array(sliceLenV)
    if (this._sliceHCand.length < sliceLenH) this._sliceHCand = new Uint8Array(sliceLenH)
    if (this._sliceVCand.length < sliceLenV) this._sliceVCand = new Uint8Array(sliceLenV)

    const refH = this._sliceHRef
    const refV = this._sliceVRef
    const candH = this._sliceHCand
    const candV = this._sliceVCand

    if (t && t.refSliceH && t.refSliceV && t.refSliceH.length >= sliceLenH && t.refSliceV.length >= sliceLenV) {
      refH.set(t.refSliceH.subarray(0, sliceLenH))
      refV.set(t.refSliceV.subarray(0, sliceLenV))
    } else {
      this.extractSliceH(predCx, predCy, halfW, refH)
      this.extractSliceV(predCx, predCy, halfH, refV)
    }

    const candidates: { x: number; y: number; score: number }[] = []
    const maxCandidates = 4
    const candidateMargin = 0.2

    const pcx = Math.round(predCx)
    const pcy = Math.round(predCy)
    const x0 = Math.max(0, Math.round(predCx - searchRadius))
    const y0 = Math.max(0, Math.round(predCy - searchRadius))
    const x1 = Math.min(this.imgW, Math.round(predCx + searchRadius))
    const y1 = Math.min(this.imgH, Math.round(predCy + searchRadius))

    const innerR = Math.min(searchRadius, 10)
    let innerBest: { x: number; y: number; score: number } | null = null
    let innerThreshold = 0

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if ((x - pcx) * (x - pcx) + (y - pcy) * (y - pcy) > innerR * innerR) continue
        if (this.gray![y * this.imgW + x] <= this.threshold) continue
        this.extractSliceH(x, y, halfW, candH)
        this.extractSliceV(x, y, halfH, candV)
        const score = this.sliceSad(refH, candH) + this.sliceSad(refV, candV)
        if (!innerBest || score < innerBest.score) innerBest = { x, y, score }
      }
    }

    if (innerBest) {
      innerThreshold = innerBest.score * (1 + candidateMargin)
      let useInner = true
      if (t && t.refBlock && t.refBlockW > 0 && t.refBlockH > 0) {
        const innerBlock = this.blockSad(t.refBlock, t.refBlockW, t.refBlockH, this.gray!, this.imgW, this.imgH, innerBest.x, innerBest.y)
        const peakVal = this.gray![Math.min(this.imgH - 1, Math.max(0, innerBest.y)) * this.imgW + Math.min(this.imgW - 1, Math.max(0, innerBest.x))]
        useInner = peakVal > this.threshold * 2 && innerBlock < (t.refBlockW * t.refBlockH * 40)
      }
      if (useInner) {
        const result = this.computeCentroid(innerBest.x, innerBest.y, halfW, halfH)
        if (result) return result
      }
    }

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if ((x - pcx) * (x - pcx) + (y - pcy) * (y - pcy) <= innerR * innerR) continue
        if (this.gray![y * this.imgW + x] <= this.threshold) continue
        this.extractSliceH(x, y, halfW, candH)
        this.extractSliceV(x, y, halfH, candV)
        const score = this.sliceSad(refH, candH) + this.sliceSad(refV, candV)
        candidates.push({ x, y, score })
      }
    }

    if (innerBest && innerThreshold > 0) {
      candidates.push(innerBest)
    }

    if (candidates.length === 0) return null

    candidates.sort((a, b) => a.score - b.score)
    const bestSliceScore = candidates[0].score
    const scoreThreshold = bestSliceScore * (1 + candidateMargin)

    let bestCx = candidates[0].x
    let bestCy = candidates[0].y

    if (candidates.length > 1 && t && t.refBlock && t.refBlockW > 0 && t.refBlockH > 0) {
      const tied = candidates.filter(c => c.score <= scoreThreshold).slice(0, maxCandidates)
      if (tied.length > 1) {
        let bestBlockSad = Infinity
        for (const c of tied) {
          const bsad = this.blockSad(t.refBlock, t.refBlockW, t.refBlockH, this.gray!, this.imgW, this.imgH, c.x, c.y)
          if (bsad < bestBlockSad) {
            bestBlockSad = bsad
            bestCx = c.x
            bestCy = c.y
          }
        }
      }
    }

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
          const bw = halfW * 2 + 1
          const bh = halfH * 2 + 1
          const block = new Uint8Array(bw * bh)
          for (let dy = 0; dy < bh; dy++) {
            for (let dx = 0; dx < bw; dx++) {
              const px = Math.round(found.cx - halfW + dx)
              const py = Math.round(found.cy - halfH + dy)
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
        t.cx = predCx
        t.cy = predCy
        t.missMs += dt * 1000
        t.highJerkFrames++
        t.vx *= 0.7
        t.vy *= 0.7
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
        if ((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2 < 25) {
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
    const noise = this.table.filter(t => t.displayId === null && t.framesSeen >= 5 && t.area >= 10)
    let bgVx = 0, bgVy = 0

    if (noise.length >= 2) {
      let vxs = noise.map(t => t.vx)
      let vys = noise.map(t => t.vy)
      let meanVx = vxs.reduce((s, v) => s + v, 0) / vxs.length
      let meanVy = vys.reduce((s, v) => s + v, 0) / vys.length
      vxs = vxs.filter(v => Math.abs(v - meanVx) < Math.abs(meanVx) * 0.8 + 10)
      vys = vys.filter(v => Math.abs(v - meanVy) < Math.abs(meanVy) * 0.8 + 10)
      if (vxs.length > 0) bgVx = vxs.reduce((s, v) => s + v, 0) / vxs.length
      if (vys.length > 0) bgVy = vys.reduce((s, v) => s + v, 0) / vys.length
    }

    this.frameCount++

    for (const t of this.table) {
      const rvx = t.vx - bgVx
      const rvy = t.vy - bgVy
      t.residualSpeed = Math.sqrt(rvx * rvx + rvy * rvy)

      if (t.residualSpeed > this.config.residualThreshold) {
        t.lowResidualFrames = 0
        t.highResidualFrames++
      } else {
        t.lowResidualFrames++
        t.highResidualFrames = Math.max(0, t.highResidualFrames - 1)
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

    const candidates = this.table
      .filter(t => {
        if (t.displayId !== null) return false
        if (t.highResidualFrames < 5) return false
        if (t.framesSeen < 3) return false
        const jerkLimit = t.area < 10 ? this.config.jerkDemotionFrames * 3 : this.config.jerkDemotionFrames
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
      highResidualFrames: 0,
      highJerkFrames: 0,
      avgArea: blob.area,
      refSliceH: null,
      refSliceV: null,
      refBlock: null,
      refBlockW: 0,
      refBlockH: 0,
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
