import { BlobFinder } from '../utils/blobFinder'
import { TrackedBlob } from '../utils/blobTracker'
import { DetectionStrategy, StrategyResult } from './types'

interface FlowVec {
  cx: number
  cy: number
  vx: number
  vy: number
}

interface MotionVector {
  cx: number
  cy: number
  vx: number
  vy: number
  sad: number
}

interface FlowCluster {
  cx: number
  cy: number
  vx: number
  vy: number
  size: number
}

export class FlowTracker implements DetectionStrategy {
  private gray: Uint8Array = new Uint8Array(0)
  private prevGray: Uint8Array = new Uint8Array(0)
  private imgW = 0
  private imgH = 0
  private threshold = 25
  private minArea = 4
  private maxArea = 256
  private table: TrackedBlob[] = []
  private nextId = 1
  private displayPool: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  private activeDisplayIds = new Set<number>()
  private blobFinder = new BlobFinder()
  private dt = 1 / 16
  private bgVx = 0
  private bgVy = 0
  private flowVectors: { cx: number; cy: number; vx: number; vy: number }[] = []
  private residualThreshold = 25
  private maxMissingMs = 500
  private maxNoiseObjects = 15
  private patchSize = 8
  private flowSearchRadius = 20
  private clusterDist = 30

  setGrayImage(gray: Uint8Array, w: number, h: number, threshold: number) {
    if (this.gray.length === w * h) {
      this.prevGray = new Uint8Array(this.gray)
    }
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
    if (this.table.length === 0) {
      this.initialScan()
    } else {
      this.flowVectors = this.computeFlow()
      this.computeBgFromFlow()
      this.verifyWithFlow()
      this.detectNew()
      this.classify()
      this.expire()
    }
    return { tracked: this.table, bgVx: this.bgVx, bgVy: this.bgVy }
  }

  getByDisplayId(displayId: number): TrackedBlob | undefined {
    return this.table.find(t => t.displayId === displayId)
  }

  reset() {
    this.table = []
    this.nextId = 1
    this.activeDisplayIds.clear()
    this.displayPool = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    this.prevGray = new Uint8Array(0)
  }

  private findBrightRegions(): { cx: number; cy: number }[] {
    const pts: { cx: number; cy: number }[] = []
    const step = 4
    for (let y = step; y < this.imgH - step; y += step) {
      for (let x = step; x < this.imgW - step; x += step) {
        let sum = 0
        for (let dy = -step; dy <= step; dy++) {
          for (let dx = -step; dx <= step; dx++) {
            sum += this.gray[(y + dy) * this.imgW + (x + dx)]
          }
        }
        if (sum / ((step * 2 + 1) ** 2) > this.threshold * 0.5) {
          pts.push({ cx: x, cy: y })
        }
      }
    }
    return pts
  }

  private patchSadAt(cx: number, cy: number, refGray: Uint8Array, refW: number, refH: number, offX: number, offY: number): number {
    let sad = 0
    const hw = Math.floor(refW / 2)
    const hh = Math.floor(refH / 2)
    for (let dy = -hh; dy < refH - hh; dy++) {
      for (let dx = -hw; dx < refW - hw; dx++) {
        const ri = (dy + hh) * refW + (dx + hw)
        const curX = cx + dx
        const curY = cy + dy
        const prevX = curX + offX
        const prevY = curY + offY
        if (prevX < 0 || prevX >= this.imgW || prevY < 0 || prevY >= this.imgH) {
          sad += refGray[ri]
          continue
        }
        sad += Math.abs(refGray[ri] - this.prevGray[prevY * this.imgW + prevX])
      }
    }
    return sad
  }

  private computeFlow(): FlowVec[] {
    if (this.prevGray.length !== this.imgW * this.imgH) return []
    const vectors: FlowVec[] = []
    const step = 4
    for (let y = step; y < this.imgH - step; y += step) {
      for (let x = step; x < this.imgW - step; x += step) {
        let sum = 0
        for (let dy = -step; dy <= step; dy++) {
          for (let dx = -step; dx <= step; dx++) {
            sum += this.gray[(y + dy) * this.imgW + (x + dx)]
          }
        }
        if (sum / ((step * 2 + 1) ** 2) < this.threshold * 0.3) continue

        const ps = this.patchSize
        const hw = Math.floor(ps / 2)
        const refPatch = new Uint8Array(ps * ps)
        let bright = 0
        for (let dy = 0; dy < ps; dy++) {
          for (let dx = 0; dx < ps; dx++) {
            const px = x - hw + dx
            const py = y - hw + dy
            if (px >= 0 && px < this.imgW && py >= 0 && py < this.imgH) {
              const val = this.gray[py * this.imgW + px]
              refPatch[dy * ps + dx] = val
              if (val > this.threshold) bright++
            }
          }
        }
        if (bright < 2) continue

        const sr = this.flowSearchRadius
        let bestDx = 0, bestDy = 0, bestSad = Infinity
        for (let dy = -sr; dy <= sr; dy += 2) {
          for (let dx = -sr; dx <= sr; dx += 2) {
            let sad = 0
            for (let py = 0; py < ps; py++) {
              for (let px = 0; px < ps; px++) {
                const cx2 = x - hw + px
                const cy2 = y - hw + py
                const prevX = cx2 + dx
                const prevY = cy2 + dy
                if (prevX < 0 || prevX >= this.imgW || prevY < 0 || prevY >= this.imgH) { sad += refPatch[py * ps + px]; continue }
                sad += Math.abs(refPatch[py * ps + px] - this.prevGray[prevY * this.imgW + prevX])
              }
            }
            if (sad < bestSad) { bestSad = sad; bestDx = dx; bestDy = dy }
          }
        }
        if (bestDx === 0 && bestDy === 0) continue
        vectors.push({ cx: x, cy: y, vx: -bestDx / this.dt, vy: -bestDy / this.dt })
      }
    }
    return vectors
  }

  private computeFlowFor(cx: number, cy: number): { vx: number; vy: number; sad: number } | null {
    if (this.prevGray.length !== this.imgW * this.imgH) return null
    const ps = this.patchSize
    const sr = this.flowSearchRadius
    const hw = Math.floor(ps / 2)

    const refPatch = new Uint8Array(ps * ps)
    let brightCount = 0
    for (let dy = 0; dy < ps; dy++) {
      for (let dx = 0; dx < ps; dx++) {
        const px = cx - hw + dx
        const py = cy - hw + dy
        if (px >= 0 && px < this.imgW && py >= 0 && py < this.imgH) {
          const val = this.gray[py * this.imgW + px]
          refPatch[dy * ps + dx] = val
          if (val > this.threshold) brightCount++
        }
      }
    }

    if (brightCount < 2) return null

    let bestDx = 0
    let bestDy = 0
    let bestSad = Infinity

    for (let dy = -sr; dy <= sr; dy += 2) {
      for (let dx = -sr; dx <= sr; dx += 2) {
        const sad = this.patchSadAt(cx, cy, refPatch, ps, ps, dx, dy)
        if (sad < bestSad) {
          bestSad = sad
          bestDx = dx
          bestDy = dy
        }
      }
    }

    if (bestDx === 0 && bestDy === 0) return null
    return { vx: -bestDx / this.dt, vy: -bestDy / this.dt, sad: bestSad }
  }

  private computeBgFromFlow() {
    if (this.flowVectors.length < 3) { this.bgVx = 0; this.bgVy = 0; return }
    const sorted = [...this.flowVectors].sort((a, b) => a.vx - b.vx)
    const mid = Math.floor(sorted.length / 2)
    this.bgVx = sorted.length % 2 === 0 ? (sorted[mid - 1].vx + sorted[mid].vx) / 2 : sorted[mid].vx
    const sortedY = [...this.flowVectors].sort((a, b) => a.vy - b.vy)
    const midY = Math.floor(sortedY.length / 2)
    this.bgVy = sortedY.length % 2 === 0 ? (sortedY[midY - 1].vy + sortedY[midY].vy) / 2 : sortedY[midY].vy
  }

  private verifyWithFlow() {
    for (const t of this.table) {
      const predCx = t.cx + t.vx * this.dt
      const predCy = t.cy + t.vy * this.dt

      let matchFlow: { vx: number; vy: number } | null = null
      let bestDist = Infinity
      for (const v of this.flowVectors) {
        const d = Math.sqrt((v.cx - t.cx) ** 2 + (v.cy - t.cy) ** 2)
        if (d < this.flowSearchRadius && d < bestDist) {
          bestDist = d
          matchFlow = v
        }
      }

      let ncx = predCx
      let ncy = predCy
      let found = false

      if (matchFlow) {
        const flowPredX = t.cx + matchFlow.vx * this.dt
        const flowPredY = t.cy + matchFlow.vy * this.dt
        const centroid = this.findCentroidNear(flowPredX, flowPredY, 20)
        if (centroid) {
          ncx = centroid.cx
          ncy = centroid.cy
          t.area = centroid.area
          t.bbox = centroid.bbox
          t.avgArea = t.avgArea * 0.6 + centroid.area * 0.4
          found = true
        } else {
          ncx = flowPredX
          ncy = flowPredY
          found = true
        }
      }

      if (!found) {
        const centroid = this.findCentroidNear(predCx, predCy, 30)
        if (centroid) {
          ncx = centroid.cx
          ncy = centroid.cy
          t.area = centroid.area
          t.bbox = centroid.bbox
          t.avgArea = t.avgArea * 0.6 + centroid.area * 0.4
          found = true
        }
      }

      if (!found) {
        const centroid = this.findCentroidNear(t.cx, t.cy, 40)
        if (centroid) {
          ncx = centroid.cx
          ncy = centroid.cy
          t.area = centroid.area
          t.bbox = centroid.bbox
          t.avgArea = t.avgArea * 0.7 + centroid.area * 0.3
          found = true
        }
      }

      if (found) {
        const rawVx = (ncx - t.cx) / this.dt
        const rawVy = (ncy - t.cy) / this.dt
        const a = 0.5
        t.vx = t.vx * (1 - a) + rawVx * a
        t.vy = t.vy * (1 - a) + rawVy * a
        t.cx = ncx
        t.cy = ncy
        t.missMs = 0
        t.framesSeen++
        t.lastSeen = performance.now()
      } else {
        t.cx += t.vx * this.dt
        t.cy += t.vy * this.dt
        t.missMs += this.dt * 1000
        t.vx *= 0.7
        t.vy *= 0.7
      }
    }
  }

  private findCentroidNear(cx: number, cy: number, radius: number): { cx: number; cy: number; area: number; bbox: [number, number, number, number] } | null {
    const x0 = Math.max(0, Math.round(cx - radius))
    const y0 = Math.max(0, Math.round(cy - radius))
    const x1 = Math.min(this.imgW, Math.round(cx + radius))
    const y1 = Math.min(this.imgH, Math.round(cy + radius))
    let sumX = 0, sumY = 0, count = 0
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0
    const blobThr = this.threshold * 1.2
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (this.gray[y * this.imgW + x] > blobThr) {
          sumX += x; sumY += y; count++
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    if (count < this.minArea) return null
    return {
      cx: Math.round(sumX / count), cy: Math.round(sumY / count), area: count,
      bbox: [Math.max(0, minX - 1), Math.max(0, minY - 1), Math.min(this.imgW, maxX + 2), Math.min(this.imgH, maxY + 2)],
    }
  }

  private detectNew() {
    const blobs = this.blobFinder.nearbyBlobMerge({
      threshold: this.threshold, mergeDistance: 2, nmsDistance: 15,
      minArea: this.minArea, maxArea: this.maxArea,
    })
    for (const b of blobs) {
      let near = false
      for (const t of this.table) {
        if (Math.sqrt((b.cx - t.cx) ** 2 + (b.cy - t.cy) ** 2) < 30) { near = true; break }
      }
      if (!near) {
        this.insertBlob(b.cx, b.cy, b.w * b.h)
      }
    }
  }

  private classify() {
    for (const t of this.table) {
      const rvx = t.vx - this.bgVx
      const rvy = t.vy - this.bgVy
      t.residualSpeed = Math.sqrt(rvx * rvx + rvy * rvy)
      if (t.residualSpeed > this.residualThreshold) {
        t.highResidualFrames++
        t.lowResidualFrames = 0
      } else {
        t.lowResidualFrames++
        t.highResidualFrames = 0
      }
    }
    for (const t of this.table) {
      if (t.displayId !== null && t.lowResidualFrames >= 10) {
        this.releaseDisplayId(t.displayId)
        t.displayId = null
        t.lowResidualFrames = 0
      }
    }
    const candidates = this.table.filter(t =>
      t.displayId === null && t.highResidualFrames >= 5 && t.framesSeen >= 3 &&
      t.area >= this.minArea && Math.abs(t.vx) + Math.abs(t.vy) > 1
    )
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
      const maxMs = t.displayId !== null ? this.maxMissingMs * 2 : this.maxMissingMs
      if (t.missMs > maxMs) {
        if (t.displayId !== null) this.releaseDisplayId(t.displayId)
        return false
      }
      return true
    })
    const noise = this.table.filter(t => t.displayId === null)
    if (noise.length > this.maxNoiseObjects) {
      noise.sort((a, b) => b.framesSeen - a.framesSeen)
      const keep = new Set(noise.slice(0, this.maxNoiseObjects).map(t => t.internalId))
      this.table = this.table.filter(t => t.displayId !== null || keep.has(t.internalId))
    }
  }

  private initialScan() {
    const blobs = this.blobFinder.nearbyBlobMerge({
      threshold: this.threshold, mergeDistance: 2, nmsDistance: 15,
      minArea: this.minArea, maxArea: this.maxArea,
    })
    for (const b of blobs) {
      this.insertBlob(b.cx, b.cy, b.w * b.h)
    }
  }

  private insertBlob(cx: number, cy: number, area: number) {
    this.table.push({
      internalId: this.nextId++, displayId: null,
      cx, cy, vx: 0, vy: 0, area,
      bbox: [cx - 1, cy - 1, cx + 2, cy + 2],
      lastSeen: performance.now(), framesSeen: 1, missMs: 0,
      residualSpeed: 0, lowResidualFrames: 0, highResidualFrames: 0, highJerkFrames: 0,
      avgArea: area, refSliceH: null, refSliceV: null, refBlock: null, refBlockW: 0, refBlockH: 0,
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
