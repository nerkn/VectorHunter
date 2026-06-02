import { BlobFinder, BlobCandidate } from '../utils/blobFinder'
import { TrackedBlob } from '../utils/blobTracker'
import { DetectionStrategy, StrategyResult } from './types'

interface ShapeTarget {
  id: number
  displayId: number | null
  cx: number
  cy: number
  vx: number
  vy: number
  w: number
  h: number
  area: number
  snapshot: Uint8Array
  snapshotW: number
  snapshotH: number
  bbox: [number, number, number, number]
  framesSeen: number
  missMs: number
  confidence: number
  lastSeen: number
  positionHistory: { cx: number; cy: number }[]
}

export class ShapeTracker implements DetectionStrategy {
  private blobFinder = new BlobFinder()
  private gray: Uint8Array = new Uint8Array(0)
  private imgW = 0
  private imgH = 0
  private threshold = 25
  private minArea = 4
  private maxArea = 500
  private targets: ShapeTarget[] = []
  private nextId = 1
  private displayPool: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  private activeDisplayIds = new Set<number>()
  private dt = 1 / 16
  private bgVx = 0
  private bgVy = 0

  private targetMinArea = 20
  private targetMinAspect = 1.5
  private matchRadius = 50
  private maxMissingMs = 500
  private historyLen = 10
  private smooth = 0.3
  private snapshotMaxW = 50
  private snapshotMaxH = 50

  private debug = false
  private frameIdx = 0

  private prevNoiseBlobs: { cx: number; cy: number; area: number }[] = []
  private bgMatchRadius = 20
  private bgBinSize = 2
  private bgHistBuf: Int32Array = new Int32Array(0)
  private bgHistW = 0
  private bgSmooth = 0.5

  setDebug(on: boolean) { this.debug = on }

  setGrayImage(gray: Uint8Array, w: number, h: number, threshold: number) {
    this.gray = gray
    this.imgW = w
    this.imgH = h
    this.threshold = threshold
    this.blobFinder.setGray(gray, w, h)
  }

  setAreaRange(min: number, max: number) {
    this.minArea = min
    this.maxArea = max
  }

  update(): StrategyResult {
    this.frameIdx++
    const blobs = this.blobFinder.nearbyBlobMerge({
      threshold: this.threshold,
      mergeDistance: 2,
      nmsDistance: 15,
      minArea: this.minArea,
      maxArea: this.maxArea,
    })

    const { targets: targetBlobs, noise: noiseBlobs } = this.classifyByShape(blobs)
    this.computeBgVelocity(noiseBlobs)
    this.matchTargets(targetBlobs)
    this.scanNewTargets(targetBlobs)
    this.expire()
    this.assignDisplayIds()

    if (this.debug) this.printDebug()
    return { tracked: this.toTrackedBlobs(), bgVx: this.bgVx, bgVy: this.bgVy }
  }

  getByDisplayId(displayId: number): TrackedBlob | undefined {
    return this.toTrackedBlobs().find(t => t.displayId === displayId)
  }

  reset() {
    this.targets = []
    this.nextId = 1
    this.activeDisplayIds.clear()
    this.bgVx = 0
    this.bgVy = 0
    this.frameIdx = 0
    this.prevNoiseBlobs = []
  }

  private classifyByShape(blobs: BlobCandidate[]): { targets: BlobCandidate[]; noise: BlobCandidate[] } {
    const targets: BlobCandidate[] = []
    const noise: BlobCandidate[] = []
    for (const b of blobs) {
      const area = b.w * b.h
      const aspect = b.w / b.h
      if (area >= this.targetMinArea && aspect >= this.targetMinAspect) {
        targets.push(b)
      } else {
        noise.push(b)
      }
    }
    return { targets, noise }
  }

  private computeBgVelocity(noiseBlobs: BlobCandidate[]) {
    const curNoise = noiseBlobs.map(b => ({ cx: b.cx, cy: b.cy, area: b.w * b.h }))

    if (this.prevNoiseBlobs.length === 0) {
      this.prevNoiseBlobs = curNoise
      return
    }

    const mr2 = this.bgMatchRadius * this.bgMatchRadius
    const votes: { dx: number; dy: number; weight: number }[] = []

    for (const p of this.prevNoiseBlobs) {
      let bestD2 = mr2
      let bestCur: typeof curNoise[0] | null = null
      for (const c of curNoise) {
        const d2 = (p.cx - c.cx) ** 2 + (p.cy - c.cy) ** 2
        if (d2 < bestD2) { bestD2 = d2; bestCur = c }
      }
      if (bestCur) {
        const ratio = Math.min(p.area, bestCur.area) / Math.max(p.area, bestCur.area)
        if (ratio > 0.2) {
          votes.push({ dx: bestCur.cx - p.cx, dy: bestCur.cy - p.cy, weight: Math.min(p.area, bestCur.area) })
        }
      }
    }

    this.prevNoiseBlobs = curNoise

    if (votes.length < 3) return

    const bins = this.bgBinSize
    const maxShift = this.bgMatchRadius
    const rangeBins = Math.ceil(maxShift / bins)
    this.bgHistW = rangeBins * 2 + 1
    const histLen = this.bgHistW * this.bgHistW
    if (this.bgHistBuf.length < histLen) this.bgHistBuf = new Int32Array(histLen)
    this.bgHistBuf.fill(0, 0, histLen)

    for (const v of votes) {
      const bx = Math.round(v.dx / bins) + rangeBins
      const by = Math.round(v.dy / bins) + rangeBins
      if (bx >= 0 && bx < this.bgHistW && by >= 0 && by < this.bgHistW) {
        this.bgHistBuf[by * this.bgHistW + bx] += v.weight
      }
    }

    let peakX = rangeBins, peakY = rangeBins, peakW = 0
    for (let by = 0; by < this.bgHistW; by++) {
      for (let bx = 0; bx < this.bgHistW; bx++) {
        const w = this.bgHistBuf[by * this.bgHistW + bx]
        if (w > peakW) { peakW = w; peakX = bx; peakY = by }
      }
    }
    if (peakW === 0) return

    let wSumX = 0, wSumY = 0, wTotal = 0
    for (const v of votes) {
      const bx = Math.round(v.dx / bins) + rangeBins
      const by = Math.round(v.dy / bins) + rangeBins
      if (Math.abs(bx - peakX) <= 1 && Math.abs(by - peakY) <= 1) {
        wSumX += v.dx * v.weight
        wSumY += v.dy * v.weight
        wTotal += v.weight
      }
    }

    if (wTotal > 0) {
      const rawVx = (wSumX / wTotal) / this.dt
      const rawVy = (wSumY / wTotal) / this.dt
      this.bgVx = this.bgVx * (1 - this.bgSmooth) + rawVx * this.bgSmooth
      this.bgVy = this.bgVy * (1 - this.bgSmooth) + rawVy * this.bgSmooth
    }
  }

  private matchTargets(candidates: BlobCandidate[]) {
    const used = new Set<number>()

    for (const t of this.targets) {
      const predCx = t.cx + t.vx * this.dt
      const predCy = t.cy + t.vy * this.dt

      let bestIdx = -1
      let bestDist = this.matchRadius
      for (let i = 0; i < candidates.length; i++) {
        if (used.has(i)) continue
        const c = candidates[i]
        const d = Math.sqrt((predCx - c.cx) ** 2 + (predCy - c.cy) ** 2)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        const c = candidates[bestIdx]
        used.add(bestIdx)

        const rawVx = (c.cx - t.cx) / this.dt
        const rawVy = (c.cy - t.cy) / this.dt
        t.vx = t.vx * this.smooth + rawVx * (1 - this.smooth)
        t.vy = t.vy * this.smooth + rawVy * (1 - this.smooth)
        t.cx = c.cx
        t.cy = c.cy
        t.w = c.w
        t.h = c.h
        t.area = c.w * c.h
        t.missMs = 0
        t.framesSeen++
        t.confidence = Math.min(100, t.confidence + 10)
        t.lastSeen = performance.now()
        const pad = 1
        t.bbox = [
          Math.max(0, Math.round(c.cx - c.w / 2) - pad),
          Math.max(0, Math.round(c.cy - c.h / 2) - pad),
          Math.min(this.imgW, Math.round(c.cx + c.w / 2) + pad),
          Math.min(this.imgH, Math.round(c.cy + c.h / 2) + pad),
        ]
        this.updateSnapshot(t)
        this.pushHistory(t)
      } else {
        t.cx += t.vx * this.dt
        t.cy += t.vy * this.dt
        t.missMs += this.dt * 1000
        t.vx *= 0.7
        t.vy *= 0.7
        t.confidence = Math.max(0, t.confidence - 15)
      }
    }
  }

  private scanNewTargets(candidates: BlobCandidate[]) {
    for (let i = 0; i < candidates.length; i++) {
      let nearExisting = false
      for (const t of this.targets) {
        const d = Math.sqrt((candidates[i].cx - t.cx) ** 2 + (candidates[i].cy - t.cy) ** 2)
        if (d < 30) { nearExisting = true; break }
      }
      if (nearExisting) continue

      const c = candidates[i]
      const pad = 1
      const bbox: [number, number, number, number] = [
        Math.max(0, Math.round(c.cx - c.w / 2) - pad),
        Math.max(0, Math.round(c.cy - c.h / 2) - pad),
        Math.min(this.imgW, Math.round(c.cx + c.w / 2) + pad),
        Math.min(this.imgH, Math.round(c.cy + c.h / 2) + pad),
      ]
      const t: ShapeTarget = {
        id: this.nextId++,
        displayId: null,
        cx: c.cx, cy: c.cy,
        vx: 0, vy: 0,
        w: c.w, h: c.h,
        area: c.w * c.h,
        snapshot: new Uint8Array(this.snapshotMaxW * this.snapshotMaxH),
        snapshotW: 0, snapshotH: 0,
        bbox,
        framesSeen: 1, missMs: 0,
        confidence: 50,
        lastSeen: performance.now(),
        positionHistory: [{ cx: c.cx, cy: c.cy }],
      }
      this.updateSnapshot(t)
      this.targets.push(t)
    }
  }

  private expire() {
    this.targets = this.targets.filter(t => {
      if (t.cx < -50 || t.cy < -50 || t.cx > this.imgW + 50 || t.cy > this.imgH + 50) {
        if (t.displayId !== null) this.releaseDisplayId(t.displayId)
        return false
      }
      if (t.missMs > this.maxMissingMs) {
        if (t.displayId !== null) this.releaseDisplayId(t.displayId)
        return false
      }
      return true
    })
  }

  private assignDisplayIds() {
    for (const t of this.targets) {
      if (t.displayId === null && t.confidence >= 60 && this.activeDisplayIds.size < this.displayPool.length) {
        const nearAssigned = this.targets.some(o =>
          o !== t && o.displayId !== null &&
          Math.sqrt((o.cx - t.cx) ** 2 + (o.cy - t.cy) ** 2) < 30
        )
        if (!nearAssigned) {
          t.displayId = this.allocateDisplayId()
        }
      }
    }
  }

  private updateSnapshot(t: ShapeTarget) {
    const sw = Math.min(t.w + 2, this.snapshotMaxW)
    const sh = Math.min(t.h + 2, this.snapshotMaxH)
    const hw = Math.floor(sw / 2)
    const hh = Math.floor(sh / 2)
    t.snapshot.fill(0, 0, sw * sh)
    for (let dy = 0; dy < sh; dy++) {
      for (let dx = 0; dx < sw; dx++) {
        const px = Math.round(t.cx) - hw + dx
        const py = Math.round(t.cy) - hh + dy
        if (px >= 0 && px < this.imgW && py >= 0 && py < this.imgH) {
          t.snapshot[dy * sw + dx] = this.gray[py * this.imgW + px]
        }
      }
    }
    t.snapshotW = sw
    t.snapshotH = sh
  }

  private pushHistory(t: ShapeTarget) {
    t.positionHistory.push({ cx: t.cx, cy: t.cy })
    if (t.positionHistory.length > this.historyLen) t.positionHistory.shift()
  }

  private toTrackedBlobs(): TrackedBlob[] {
    return this.targets.map(t => ({
      internalId: t.id,
      displayId: t.displayId,
      cx: t.cx, cy: t.cy,
      vx: t.vx, vy: t.vy,
      area: t.area,
      bbox: t.bbox,
      lastSeen: t.lastSeen,
      framesSeen: t.framesSeen,
      missMs: t.missMs,
      residualSpeed: Math.sqrt((t.vx - this.bgVx) ** 2 + (t.vy - this.bgVy) ** 2),
      lowResidualFrames: 0,
      highResidualFrames: 0,
      highJerkFrames: 0,
      avgArea: t.area,
      refSliceH: null,
      refSliceV: null,
      refBlock: t.snapshot,
      refBlockW: t.snapshotW,
      refBlockH: t.snapshotH,
    }))
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

  private printDebug() {
    console.log(`\n[SHAPE] === frame ${this.frameIdx} | bg=(${this.bgVx.toFixed(0)},${this.bgVy.toFixed(0)}) | targets=${this.targets.length} ===`)
    for (const t of this.targets) {
      const res = Math.sqrt((t.vx - this.bgVx) ** 2 + (t.vy - this.bgVy) ** 2)
      console.log(`  TGT#${t.displayId} id=${t.id} conf=${t.confidence.toFixed(0)} (${t.cx.toFixed(0)},${t.cy.toFixed(0)}) v=(${t.vx.toFixed(0)},${t.vy.toFixed(0)}) res=${res.toFixed(0)} ${t.w}x${t.h} a=${t.area} s=${t.framesSeen} m=${t.missMs.toFixed(0)}ms`)
    }
  }
}
