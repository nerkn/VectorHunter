import { BlobFinder, BlobCandidate } from '../utils/blobFinder'
import { BlobTracker, TrackedBlob } from '../utils/blobTracker'
import { DetectionStrategy, StrategyResult } from './types'

interface PrevBlob {
  cx: number
  cy: number
  w: number
  h: number
  area: number
}

export class WrappedBlobTracker implements DetectionStrategy {
  private inner = new BlobTracker()
  private blobFinder = new BlobFinder()
  private prevBlobs: PrevBlob[] = []
  private threshold = 25
  private bgVx = 0
  private bgVy = 0
  private matchRadius = 40
  private minPairs = 3
  private minBlobArea = 3
  private binSize = 2
  private histBuf: Int32Array = new Int32Array(0)
  private histW = 0
  private smooth = 0.5

  setGrayImage(gray: Uint8Array, w: number, h: number, threshold: number) {
    this.threshold = threshold
    this.inner.setGrayImage(gray, w, h, threshold)
    this.blobFinder.setGray(gray, w, h)
  }

  setAreaRange(min: number, max: number) {
    this.inner.setAreaRange(min, max)
  }

  update(): StrategyResult {
    this.computeBgVelocity()
    const tracked = this.inner.update(this.bgVx, this.bgVy)
    return { tracked, bgVx: this.bgVx, bgVy: this.bgVy }
  }

  getByDisplayId(displayId: number): TrackedBlob | undefined {
    return this.inner.getByDisplayId(displayId)
  }

  reset() {
    this.inner.reset()
    this.prevBlobs = []
    this.bgVx = 0
    this.bgVy = 0
  }

  private computeBgVelocity() {
    const blobs = this.blobFinder.nearbyBlobMerge({
      threshold: this.threshold,
      mergeDistance: 2,
      nmsDistance: 15,
      minArea: this.minBlobArea,
      maxArea: 500,
    })

    const sorted = [...blobs].sort((a, b) => (b.w * b.h) - (a.w * a.h))
    const largestArea = sorted[0].w * sorted[0].h
    const maxSmallArea = largestArea * 0.5
    const filteredBlobs = blobs.filter(b => b.w * b.h < maxSmallArea)

    if (this.prevBlobs.length === 0) {
      this.prevBlobs = filteredBlobs.map(b => ({ cx: b.cx, cy: b.cy, w: b.w, h: b.h, area: b.w * b.h }))
      return
    }

    const prev = this.prevBlobs
    const mr2 = this.matchRadius * this.matchRadius
    const votes: { dx: number; dy: number; weight: number }[] = []

    for (const p of prev) {
      let bestCur: BlobCandidate | null = null
      let bestD2 = mr2
      for (const c of filteredBlobs) {
        const d2 = (p.cx - c.cx) ** 2 + (p.cy - c.cy) ** 2
        if (d2 < bestD2) {
          bestD2 = d2
          bestCur = c
        }
      }
      if (bestCur) {
        const curArea = bestCur.w * bestCur.h
        const sizeRatio = Math.min(p.area, curArea) / Math.max(p.area, curArea)
        if (sizeRatio > 0.2) {
          votes.push({ dx: bestCur.cx - p.cx, dy: bestCur.cy - p.cy, weight: Math.min(p.area, curArea) })
        }
      }
    }

    this.prevBlobs = filteredBlobs.map(b => ({ cx: b.cx, cy: b.cy, w: b.w, h: b.h, area: b.w * b.h }))

    if (votes.length < this.minPairs) return

    const bins = this.binSize
    const maxShift = this.matchRadius
    const rangeBins = Math.ceil(maxShift / bins)
    this.histW = rangeBins * 2 + 1
    const histLen = this.histW * this.histW
    if (this.histBuf.length < histLen) this.histBuf = new Int32Array(histLen)
    this.histBuf.fill(0, 0, histLen)

    for (const v of votes) {
      const bx = Math.round(v.dx / bins) + rangeBins
      const by = Math.round(v.dy / bins) + rangeBins
      if (bx >= 0 && bx < this.histW && by >= 0 && by < this.histW) {
        this.histBuf[by * this.histW + bx] += v.weight
      }
    }

    let peakX = rangeBins, peakY = rangeBins, peakW = 0
    for (let by = 0; by < this.histW; by++) {
      for (let bx = 0; bx < this.histW; bx++) {
        const w = this.histBuf[by * this.histW + bx]
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
      const dx = wSumX / wTotal
      const dy = wSumY / wTotal
      const dt = 1 / 24
      const rawVx = dx / dt
      const rawVy = dy / dt
      this.bgVx = this.bgVx * 0.3 + rawVx * 0.7
      this.bgVy = this.bgVy * 0.3 + rawVy * 0.7
    }
  }
}
