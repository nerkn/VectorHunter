import { BlobFinder } from '../utils/blobFinder'
import { TrackedBlob } from '../utils/blobTracker'
import { DetectionStrategy, StrategyResult } from './types'

type BlobType = 'smal' | 'bg' | 'target'

interface DriftBlob {
  id: number
  type: BlobType
  displayId: number | null
  cx: number
  cy: number
  vx: number
  vy: number
  confidence: number
  snapshot: Uint8Array | null
  snapshotW: number
  snapshotH: number
  bbox: [number, number, number, number]
  w: number
  h: number
  area: number
  framesSeen: number
  missMs: number
  highResidualCount: number
  residualHistory: number[]
  lastSeen: number
  positionHistory: { cx: number; cy: number }[]
}

export class DriftTracker implements DetectionStrategy {
  private gray: Uint8Array = new Uint8Array(0)
  private imgW = 0
  private imgH = 0
  private threshold = 25
  private minArea = 4
  private maxArea = 500
  private blobs: DriftBlob[] = []
  private nextId = 1
  private displayPool: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  private activeDisplayIds = new Set<number>()
  private blobFinder = new BlobFinder()
  private dt = 1 / 16
  private bgVx = 0
  private bgVy = 0

  private gridCols = 20
  private gridRows = 30
  private gridCellW = 32
  private gridCellH = 16
  private grid: boolean[] = new Array(600).fill(false)

  private maxMissingMs = 500
  private confidenceStart = 20
  private promoteSmalToBg = 5
  private promoteBgToTarget = 3
  private demoteTargetThreshold = 60
  private smalMergeBgArea = 20
  private distanceWeight = 0.3
  private residualThreshold = 25
  private historyLen = 10
  private maxNoiseObjects = 20

  private debug = false
  private frameIdx = 0

  setDebug(on: boolean) { this.debug = on }

  setGrayImage(gray: Uint8Array, w: number, h: number, threshold: number) {
    this.gray = gray
    this.imgW = w
    this.imgH = h
    this.threshold = threshold
    this.blobFinder.setGray(gray, w, h)
    this.gridCellW = Math.ceil(w / this.gridCols)
    this.gridCellH = Math.ceil(h / this.gridRows)
  }

  setAreaRange(min: number, max: number) {
    this.minArea = min
    this.maxArea = max
  }

  update(): StrategyResult {
    this.frameIdx++
    if (this.blobs.length === 0) {
      this.initialScan()
    } else {
      this.computeDraftVel()
      this.matchTargets()
      this.checkOutliers()
      this.scanRemaining()
      this.merge()
      this.typeTransitions()
      this.expire()
    }
    if (this.debug) this.printDebug()
    return { tracked: this.toTrackedBlobs(), bgVx: this.bgVx, bgVy: this.bgVy }
  }

  getByDisplayId(displayId: number): TrackedBlob | undefined {
    return this.toTrackedBlobs().find(t => t.displayId === displayId)
  }

  reset() {
    this.blobs = []
    this.nextId = 1
    this.activeDisplayIds.clear()
    this.bgVx = 0
    this.bgVy = 0
    this.frameIdx = 0
    this.grid.fill(false)
  }

  private computeDraftVel() {
    const longBg = this.blobs.filter(b => {
      if (b.type !== 'bg' || b.framesSeen < 5 || b.positionHistory.length < 3) return false
      const hist = b.positionHistory
      const first = hist[0]
      const last = hist[hist.length - 1]
      const disp = Math.sqrt((last.cx - first.cx) ** 2 + (last.cy - first.cy) ** 2)
      return disp < 20
    })
    if (longBg.length === 0) {
      const longSmal = this.blobs.filter(b => b.type === 'smal' && b.framesSeen >= 5 && b.positionHistory.length >= 3)
      if (longSmal.length >= 3) {
        const vel = longSmal.map(b => b.vx).sort((a, b) => a - b)
        const velY = longSmal.map(b => b.vy).sort((a, b) => a - b)
        const m = Math.floor(vel.length / 2)
        this.bgVx = vel.length % 2 === 0 ? (vel[m - 1] + vel[m]) / 2 : vel[m]
        this.bgVy = velY.length % 2 === 0 ? (velY[m - 1] + velY[m]) / 2 : velY[m]
      }
      return
    }

    const velocities = longBg.map(b => {
      const hist = b.positionHistory
      const last = hist[hist.length - 1]
      const prev = hist[Math.max(0, hist.length - 3)]
      const d = hist.length - Math.max(0, hist.length - 3)
      return { vx: (last.cx - prev.cx) / (d * this.dt), vy: (last.cy - prev.cy) / (d * this.dt), id: b.id }
    })

    const medVx = median(velocities.map(v => v.vx))
    const medVy = median(velocities.map(v => v.vy))
    const mad = median(velocities.map(v => Math.abs(v.vx - medVx) + Math.abs(v.vy - medVy)))
    const outlierThreshold = Math.max(mad * 3, 30)

    const inliers = velocities.filter(v =>
      Math.abs(v.vx - medVx) + Math.abs(v.vy - medVy) < outlierThreshold
    )

    if (inliers.length >= 2) {
      this.bgVx = median(inliers.map(v => v.vx))
      this.bgVy = median(inliers.map(v => v.vy))
    } else {
      this.bgVx = medVx
      this.bgVy = medVy
    }
  }

  private matchTargets() {
    const targets = this.blobs.filter(b => b.type === 'target')
    for (const t of targets) {
      const predCx = t.cx + t.vx * this.dt - this.bgVx * this.dt
      const predCy = t.cy + t.vy * this.dt - this.bgVy * this.dt

      if (t.snapshot && t.snapshotW > 0 && t.snapshotH > 0) {
        const match = this.findSnapshotMatch(predCx, predCy, t.snapshot, t.snapshotW, t.snapshotH, 30)
        if (match) {
          const rawVx = (match.cx - t.cx) / this.dt
          const rawVy = (match.cy - t.cy) / this.dt
          t.vx = t.vx * 0.5 + rawVx * 0.5
          t.vy = t.vy * 0.5 + rawVy * 0.5
          t.cx = match.cx
          t.cy = match.cy
          t.area = match.area
          t.w = match.w
          t.h = match.h
          t.bbox = match.bbox
          t.missMs = 0
          t.framesSeen++
          t.lastSeen = performance.now()
          this.updateSnapshot(t)
          this.pushHistory(t)
          t.confidence = Math.min(100, t.confidence + 5)
          continue
        }
      }

      const centroid = this.findCentroidNear(predCx, predCy, 20)
      if (centroid) {
        const rawVx = (centroid.cx - t.cx) / this.dt
        const rawVy = (centroid.cy - t.cy) / this.dt
        t.vx = t.vx * 0.5 + rawVx * 0.5
        t.vy = t.vy * 0.5 + rawVy * 0.5
        t.cx = centroid.cx
        t.cy = centroid.cy
        t.area = centroid.area
        t.w = centroid.bbox[2] - centroid.bbox[0]
        t.h = centroid.bbox[3] - centroid.bbox[1]
        t.bbox = centroid.bbox
        t.missMs = 0
        t.framesSeen++
        t.lastSeen = performance.now()
        this.updateSnapshot(t)
        this.pushHistory(t)
        t.confidence = Math.min(100, t.confidence + 2)
        continue
      }

      t.cx += t.vx * this.dt
      t.cy += t.vy * this.dt
      t.missMs += this.dt * 1000
      t.vx *= 0.7
      t.vy *= 0.7
      t.confidence = Math.max(0, t.confidence - 10)
    }

    const bgBlobs = this.blobs.filter(b => b.type === 'bg')
    for (const b of bgBlobs) {
      const predCx = b.cx + b.vx * this.dt
      const predCy = b.cy + b.vy * this.dt
      const centroid = this.findCentroidNear(predCx, predCy, 15)
      if (centroid) {
        const rawVx = (centroid.cx - b.cx) / this.dt
        const rawVy = (centroid.cy - b.cy) / this.dt
        b.vx = b.vx * 0.7 + rawVx * 0.3
        b.vy = b.vy * 0.7 + rawVy * 0.3
        b.cx = centroid.cx
        b.cy = centroid.cy
        b.area = centroid.area
        b.w = centroid.bbox[2] - centroid.bbox[0]
        b.h = centroid.bbox[3] - centroid.bbox[1]
        b.bbox = centroid.bbox
        b.missMs = 0
        b.framesSeen++
        b.lastSeen = performance.now()
        this.pushHistory(b)
      } else {
        b.cx += b.vx * this.dt
        b.cy += b.vy * this.dt
        b.missMs += this.dt * 1000
        b.vx *= 0.7
        b.vy *= 0.7
      }
    }
  }

  private checkOutliers() {
    const smals = this.blobs.filter(b => b.type === 'smal' && b.missMs === 0)
    for (const s of smals) {
      const predCx = s.cx + s.vx * this.dt
      const predCy = s.cy + s.vy * this.dt
      const centroid = this.findCentroidNear(predCx, predCy, 10)
      if (centroid) {
        const rawVx = (centroid.cx - s.cx) / this.dt
        const rawVy = (centroid.cy - s.cy) / this.dt
        s.vx = s.vx * 0.5 + rawVx * 0.5
        s.vy = s.vy * 0.5 + rawVy * 0.5
        s.cx = centroid.cx
        s.cy = centroid.cy
        s.area = centroid.area
        s.w = centroid.bbox[2] - centroid.bbox[0]
        s.h = centroid.bbox[3] - centroid.bbox[1]
        s.bbox = centroid.bbox
        s.missMs = 0
        s.framesSeen++
        s.lastSeen = performance.now()
        this.pushHistory(s)
      } else {
        s.cx += s.vx * this.dt
        s.cy += s.vy * this.dt
        s.missMs += this.dt * 1000
        s.vx *= 0.7
        s.vy *= 0.7
      }
    }

    const unmatched = this.blobs.filter(b => b.type === 'smal' && b.missMs > 0)
    for (const s of unmatched) {
      s.confidence = Math.max(0, s.confidence - 5)
    }
  }

  private scanRemaining() {
    this.grid.fill(false)
    for (const b of this.blobs) {
      this.markGrid(b)
    }

    const blobs = this.blobFinder.nearbyBlobMerge({
      threshold: this.threshold, mergeDistance: 2, nmsDistance: 15,
      minArea: this.minArea, maxArea: this.maxArea,
    })

    for (const b of blobs) {
      const col = Math.floor(b.cx / this.gridCellW)
      const row = Math.floor(b.cy / this.gridCellH)
      if (col >= 0 && col < this.gridCols && row >= 0 && row < this.gridRows) {
        if (this.grid[row * this.gridCols + col]) continue
      }
      this.insertBlob(b.cx, b.cy, b.w, b.h)
    }
  }

  private merge() {
    const remove = new Set<number>()
    const bgs = this.blobs.filter(b => b.type === 'bg' && !remove.has(b.id))
    const smals = this.blobs.filter(b => b.type === 'smal' && !remove.has(b.id))

    for (const bg of bgs) {
      for (let i = smals.length - 1; i >= 0; i--) {
        const s = smals[i]
        if (remove.has(s.id)) continue
        if (this.overlaps(bg.bbox, s.bbox)) {
          bg.area += s.area
          bg.w = Math.max(bg.w, s.w)
          bg.h = Math.max(bg.h, s.h)
          bg.bbox = unionBbox(bg.bbox, s.bbox)
          bg.cx = Math.round((bg.cx + s.cx) / 2)
          bg.cy = Math.round((bg.cy + s.cy) / 2)
          remove.add(s.id)
          smals.splice(i, 1)
        }
      }
    }

    for (let i = 0; i < smals.length; i++) {
      if (remove.has(smals[i].id)) continue
      for (let j = i + 1; j < smals.length; j++) {
        if (remove.has(smals[j].id)) continue
        if (this.overlaps(smals[i].bbox, smals[j].bbox)) {
          const a = smals[i], b = smals[j]
          const mergedArea = a.area + b.area
          const nb = this.mergeInto(a, b)
          if (mergedArea >= this.smalMergeBgArea) {
            nb.type = 'bg'
            nb.confidence = (a.confidence + b.confidence) / 2 + 10
          }
          remove.add(a.id === nb.id ? b.id : a.id)
        }
      }
    }

    if (remove.size > 0) {
      this.blobs = this.blobs.filter(b => !remove.has(b.id))
    }
  }

  private typeTransitions() {
    for (const b of this.blobs) {
      const rvx = b.vx - this.bgVx
      const rvy = b.vy - this.bgVy
      const residual = Math.sqrt(rvx * rvx + rvy * rvy)

      if (b.type === 'smal' && b.framesSeen >= this.promoteSmalToBg) {
        b.type = 'bg'
        b.confidence = (b.confidence + 50) / 2 + 10
      }

      if (b.type === 'bg') {
        b.residualHistory.push(residual > this.residualThreshold ? 1 : 0)
        if (b.residualHistory.length > 5) b.residualHistory.shift()
        const recentHigh = b.residualHistory.reduce((s, v) => s + v, 0)
        if (recentHigh >= this.promoteBgToTarget) {
          b.type = 'target'
          b.confidence = Math.max(b.confidence, 70)
        }
      }

      if (b.type === 'target' && b.confidence <= this.demoteTargetThreshold) {
        b.type = 'bg'
        b.highResidualCount = 0
        this.releaseDisplayId(b.id)
      }
    }

    const targets = this.blobs.filter(b => b.type === 'target')
    for (const t of targets) {
      if (t.displayId !== null) continue
      const nearTarget = this.blobs.some(o => o !== t && o.type === 'target' && o.displayId !== null &&
        Math.sqrt((o.cx - t.cx) ** 2 + (o.cy - t.cy) ** 2) < 30)
      if (!nearTarget && this.activeDisplayIds.size < this.displayPool.length) {
        t.displayId = this.allocateDisplayId()
      }
    }
  }

  private expire() {
    this.blobs = this.blobs.filter(b => {
      if (b.cx < -50 || b.cy < -50 || b.cx > this.imgW + 50 || b.cy > this.imgH + 50) {
        if (b.displayId !== null) this.releaseDisplayId(b.displayId)
        return false
      }
      if (b.missMs > this.maxMissingMs) {
        if (b.displayId !== null) this.releaseDisplayId(b.displayId)
        return false
      }
      return true
    })

    const smals = this.blobs.filter(b => b.type === 'smal')
    if (smals.length > this.maxNoiseObjects) {
      smals.sort((a, b) => b.confidence - a.confidence)
      const keep = new Set(smals.slice(0, this.maxNoiseObjects).map(s => s.id))
      this.blobs = this.blobs.filter(b => b.type !== 'smal' || keep.has(b.id))
    }
  }

  private findSnapshotMatch(
    cx: number, cy: number,
    snap: Uint8Array, snapW: number, snapH: number,
    radius: number
  ): { cx: number; cy: number; area: number; w: number; h: number; bbox: [number, number, number, number] } | null {
    const x0 = Math.max(0, Math.round(cx - radius))
    const y0 = Math.max(0, Math.round(cy - radius))
    const x1 = Math.min(this.imgW, Math.round(cx + radius))
    const y1 = Math.min(this.imgH, Math.round(cy + radius))

    let bestCx = cx, bestCy = cy, bestScore = -Infinity

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (this.gray[y * this.imgW + x] <= this.threshold) continue
        const sad = this.patchSadAt(snap, snapW, snapH, x, y)
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        const score = sad - dist * this.distanceWeight
        if (score > bestScore) {
          bestScore = score
          bestCx = x
          bestCy = y
        }
      }
    }

    const maxSad = snapW * snapH * 80
    const patchSad = this.patchSadAt(snap, snapW, snapH, bestCx, bestCy)
    if (patchSad > maxSad) return null

    return this.findCentroidNear(bestCx, bestCy, Math.max(snapW, snapH))
  }

  private patchSadAt(ref: Uint8Array, refW: number, refH: number, cx: number, cy: number): number {
    let sad = 0
    const hw = Math.floor(refW / 2)
    const hh = Math.floor(refH / 2)
    for (let dy = -hh; dy < refH - hh; dy++) {
      for (let dx = -hw; dx < refW - hw; dx++) {
        const ri = (dy + hh) * refW + (dx + hw)
        const px = Math.round(cx + dx)
        const py = Math.round(cy + dy)
        if (px < 0 || px >= this.imgW || py < 0 || py >= this.imgH) {
          sad += ref[ri]
          continue
        }
        sad += Math.abs(ref[ri] - this.gray[py * this.imgW + px])
      }
    }
    return sad
  }

  private updateSnapshot(b: DriftBlob) {
    const sw = b.w + 2
    const sh = b.h + 2
    const hw = Math.floor(sw / 2)
    const hh = Math.floor(sh / 2)
    const snap = new Uint8Array(sw * sh)
    for (let dy = 0; dy < sh; dy++) {
      for (let dx = 0; dx < sw; dx++) {
        const px = Math.round(b.cx) - hw + dx
        const py = Math.round(b.cy) - hh + dy
        if (px >= 0 && px < this.imgW && py >= 0 && py < this.imgH) {
          snap[dy * sw + dx] = this.gray[py * this.imgW + px]
        }
      }
    }
    b.snapshot = snap
    b.snapshotW = sw
    b.snapshotH = sh
  }

  private findCentroidNear(cx: number, cy: number, radius: number): { cx: number; cy: number; area: number; w: number; h: number; bbox: [number, number, number, number] } | null {
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
          if (x < minX) minX = x; if (y < minY) minY = y
          if (x > maxX) maxX = x; if (y > maxY) maxY = y
        }
      }
    }
    if (count < this.minArea) return null
    return {
      cx: Math.round(sumX / count), cy: Math.round(sumY / count), area: count,
      w: maxX - minX + 1, h: maxY - minY + 1,
      bbox: [Math.max(0, minX - 1), Math.max(0, minY - 1), Math.min(this.imgW, maxX + 2), Math.min(this.imgH, maxY + 2)],
    }
  }

  private pushHistory(b: DriftBlob) {
    b.positionHistory.push({ cx: b.cx, cy: b.cy })
    if (b.positionHistory.length > this.historyLen) b.positionHistory.shift()
  }

  private markGrid(b: DriftBlob) {
    const [l, t, r, bb] = b.bbox
    const c0 = Math.max(0, Math.floor(l / this.gridCellW))
    const r0 = Math.max(0, Math.floor(t / this.gridCellH))
    const c1 = Math.min(this.gridCols - 1, Math.floor(r / this.gridCellW))
    const r1 = Math.min(this.gridRows - 1, Math.floor(bb / this.gridCellH))
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        this.grid[row * this.gridCols + col] = true
      }
    }
  }

  private overlaps(a: [number, number, number, number], b: [number, number, number, number]): boolean {
    return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
  }

  private mergeInto(a: DriftBlob, b: DriftBlob): DriftBlob {
    const keeper = a.area >= b.area ? a : b
    const absorbed = keeper === a ? b : a
    keeper.area += absorbed.area
    keeper.bbox = unionBbox(keeper.bbox, absorbed.bbox)
    keeper.w = keeper.bbox[2] - keeper.bbox[0]
    keeper.h = keeper.bbox[3] - keeper.bbox[1]
    keeper.cx = Math.round((keeper.cx * keeper.framesSeen + absorbed.cx * absorbed.framesSeen) / (keeper.framesSeen + absorbed.framesSeen))
    keeper.cy = Math.round((keeper.cy * keeper.framesSeen + absorbed.cy * absorbed.framesSeen) / (keeper.framesSeen + absorbed.framesSeen))
    keeper.vx = (keeper.vx + absorbed.vx) / 2
    keeper.vy = (keeper.vy + absorbed.vy) / 2
    keeper.framesSeen += absorbed.framesSeen
    if (absorbed.displayId !== null && keeper.displayId === null) {
      keeper.displayId = absorbed.displayId
    } else if (absorbed.displayId !== null) {
      this.releaseDisplayId(absorbed.displayId)
    }
    this.updateSnapshot(keeper)
    return keeper
  }

  private initialScan() {
    const blobs = this.blobFinder.nearbyBlobMerge({
      threshold: this.threshold, mergeDistance: 2, nmsDistance: 15,
      minArea: this.minArea, maxArea: this.maxArea,
    })
    for (const b of blobs) {
      this.insertBlob(b.cx, b.cy, b.w, b.h)
    }
  }

  private insertBlob(cx: number, cy: number, w: number, h: number) {
    const area = w * h
    const pad = 1
    const bbox: [number, number, number, number] = [
      Math.max(0, Math.round(cx - w / 2) - pad),
      Math.max(0, Math.round(cy - h / 2) - pad),
      Math.min(this.imgW, Math.round(cx + w / 2) + pad),
      Math.min(this.imgH, Math.round(cy + h / 2) + pad),
    ]
    const b: DriftBlob = {
      id: this.nextId++,
      type: 'smal',
      displayId: null,
      cx, cy, vx: 0, vy: 0,
      confidence: this.confidenceStart,
      snapshot: null, snapshotW: 0, snapshotH: 0,
      bbox, w, h, area,
      framesSeen: 1, missMs: 0,
      highResidualCount: 0,
      residualHistory: [],
      lastSeen: performance.now(),
      positionHistory: [{ cx, cy }],
    }
    this.updateSnapshot(b)
    this.blobs.push(b)
  }

  private toTrackedBlobs(): TrackedBlob[] {
    return this.blobs.map(b => ({
      internalId: b.id,
      displayId: b.displayId,
      cx: b.cx,
      cy: b.cy,
      vx: b.vx,
      vy: b.vy,
      area: b.area,
      bbox: b.bbox,
      lastSeen: b.lastSeen,
      framesSeen: b.framesSeen,
      missMs: b.missMs,
      residualSpeed: Math.sqrt((b.vx - this.bgVx) ** 2 + (b.vy - this.bgVy) ** 2),
      lowResidualFrames: b.type === 'bg' ? b.framesSeen : 0,
      highResidualFrames: b.highResidualCount,
      highJerkFrames: 0,
      avgArea: b.area,
      refSliceH: null,
      refSliceV: null,
      refBlock: b.snapshot,
      refBlockW: b.snapshotW,
      refBlockH: b.snapshotH,
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
    const targets = this.blobs.filter(b => b.type === 'target')
    const bgs = this.blobs.filter(b => b.type === 'bg')
    const smals = this.blobs.filter(b => b.type === 'smal')
    console.log(`\n[DRIFT] === frame ${this.frameIdx} | bgV=${this.bgVx.toFixed(1)},${this.bgVy.toFixed(1)} | T=${targets.length} B=${bgs.length} S=${smals.length} ===`)
    for (const b of this.blobs) {
      const tag = b.type === 'target' ? `TGT#${b.displayId}` : b.type === 'bg' ? 'BG' : 'S'
      const res = Math.sqrt((b.vx - this.bgVx) ** 2 + (b.vy - this.bgVy) ** 2)
      const rhist = b.residualHistory.reduce((s, v) => s + v, 0)
      console.log(`  ${tag} id=${b.id} conf=${b.confidence.toFixed(0)} (${b.cx.toFixed(0)},${b.cy.toFixed(0)}) v=(${b.vx.toFixed(0)},${b.vy.toFixed(0)}) res=${res.toFixed(0)} rh=${rhist}/${b.residualHistory.length} a=${b.area} s=${b.framesSeen} m=${b.missMs.toFixed(0)}ms`)
    }
  }
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function unionBbox(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}
