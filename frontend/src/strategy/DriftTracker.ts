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
  private minPromoteArea = 50
  private promoteBgToTarget = 3
  private demoteTargetThreshold = 60
  private smalMergeBgArea = 20
  private residualThreshold = 25
  private historyLen = 10
  private maxSmal = 20

  private visitedMap: Uint32Array = new Uint32Array(0)
  private visitStamp = 0
  private ffStack: number[] = []
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
    if (this.visitedMap.length !== w * h) this.visitedMap = new Uint32Array(w * h)
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
      this.computeBgVel()
      this.matchAll()
      this.scanGrid()
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

  private computeBgVel() {
    const stable = this.blobs.filter(b =>
      (b.type === 'bg' || b.type === 'smal') && b.missMs === 0 && b.positionHistory.length >= 2
    )
    if (stable.length < 3) return

    const vels = stable.map(b => {
      const h = b.positionHistory
      const prev = h[h.length - 2]
      const last = h[h.length - 1]
      return { vx: (last.cx - prev.cx) / this.dt, vy: (last.cy - prev.cy) / this.dt }
    })

    const medVx = median(vels.map(v => v.vx))
    const medVy = median(vels.map(v => v.vy))
    const mad = median(vels.map(v => Math.abs(v.vx - medVx) + Math.abs(v.vy - medVy)))
    const cutoff = Math.max(mad * 3, 30)

    const inliers = vels.filter(v =>
      Math.abs(v.vx - medVx) + Math.abs(v.vy - medVy) <= cutoff
    )

    this.bgVx = inliers.length >= 2 ? median(inliers.map(v => v.vx)) : medVx
    this.bgVy = inliers.length >= 2 ? median(inliers.map(v => v.vy)) : medVy
  }

  private matchAll() {
    const order: BlobType[] = ['target', 'bg', 'smal']

    for (const type of order) {
      for (const b of this.blobs) {
        if (b.type !== type) continue
        const predCx = b.cx + b.vx * this.dt
        const predCy = b.cy + b.vy * this.dt
        const radius = type === 'target' ? 20 : type === 'bg' ? 15 : 10

        let matched = false
        if (b.snapshot && b.snapshotW > 0 && b.snapshotH > 0) {
          const pos = this.findInNextFrame(b.snapshot, b.snapshotW, b.snapshotH, predCx, predCy, radius)
          const blob = this.floodFillBBox(pos.cx, pos.cy)
          if (blob && blob.area >= this.minArea) {
            const rawVx = (blob.cx - b.cx) / this.dt
            const rawVy = (blob.cy - b.cy) / this.dt
            const smooth = type === 'target' ? 0.5 : 0.7
            b.vx = b.vx * smooth + rawVx * (1 - smooth)
            b.vy = b.vy * smooth + rawVy * (1 - smooth)
            b.cx = blob.cx
            b.cy = blob.cy
            b.area = blob.area
            b.w = blob.w
            b.h = blob.h
            b.bbox = blob.bbox
            b.missMs = 0
            b.framesSeen++
            b.lastSeen = performance.now()
            this.updateSnapshot(b)
            this.pushHistory(b)
            if (type === 'target') b.confidence = Math.min(100, b.confidence + 5)
            matched = true
          }
        }
        if (!matched) {
          b.cx += b.vx * this.dt
          b.cy += b.vy * this.dt
          b.missMs += this.dt * 1000
          b.vx *= 0.7
          b.vy *= 0.7
          if (type === 'smal') b.confidence = Math.max(0, b.confidence - 5)
          if (type === 'target') b.confidence = Math.max(0, b.confidence - 10)
        }
      }
    }
  }

  private scanGrid() {
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
    const targets = this.blobs.filter(b => b.type === 'target')

    for (const bg of bgs) {
      for (const t of targets) {
        const dist = Math.sqrt((bg.cx - t.cx) ** 2 + (bg.cy - t.cy) ** 2)
        if (dist < 15) {
          const dvx = Math.abs(bg.vx - t.vx)
          const dvy = Math.abs(bg.vy - t.vy)
          if (dvx < 20 && dvy < 20) {
            remove.add(bg.id)
            break
          }
        }
      }
    }

    for (const bg of bgs) {
      for (let i = smals.length - 1; i >= 0; i--) {
        const s = smals[i]
        if (remove.has(s.id)) continue
        if (!this.overlaps(bg.bbox, s.bbox)) continue
        this.absorb(bg, s)
        remove.add(s.id)
        smals.splice(i, 1)
      }
    }

    for (let i = 0; i < smals.length; i++) {
      if (remove.has(smals[i].id)) continue
      for (let j = i + 1; j < smals.length; j++) {
        if (remove.has(smals[j].id)) continue
        if (!this.overlaps(smals[i].bbox, smals[j].bbox)) continue
        const a = smals[i], b = smals[j]
        const keeper = a.area >= b.area ? a : b
        const eaten = keeper === a ? b : a
        this.absorb(keeper, eaten)
        if (a.area + b.area >= this.smalMergeBgArea) {
          keeper.type = 'bg'
          keeper.confidence = Math.max(keeper.confidence, 30)
        }
        remove.add(eaten.id)
      }
    }

    if (remove.size > 0) {
      this.blobs = this.blobs.filter(b => !remove.has(b.id))
    }
  }

  private isMovingConsistently(b: DriftBlob): boolean {
    if (b.positionHistory.length < 4) return false
    const h = b.positionHistory
    const v: { dx: number; dy: number }[] = []
    for (let i = h.length - 3; i < h.length; i++) {
      const dx = h[i].cx - h[i - 1].cx
      const dy = h[i].cy - h[i - 1].cy
      if (dx * dx + dy * dy < 1) return false
      v.push({ dx, dy })
    }
    for (let i = 1; i < v.length; i++) {
      const dot = v[i].dx * v[i - 1].dx + v[i].dy * v[i - 1].dy
      const m1 = Math.sqrt(v[i - 1].dx ** 2 + v[i - 1].dy ** 2)
      const m2 = Math.sqrt(v[i].dx ** 2 + v[i].dy ** 2)
      if (dot / (m1 * m2) < 0.3) return false
    }
    return true
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
        if (recentHigh >= this.promoteBgToTarget && b.area >= this.minPromoteArea && this.isMovingConsistently(b)) {
          b.type = 'target'
          b.confidence = Math.max(b.confidence, 70)
        }
      }

      if (b.type === 'target' && b.confidence <= this.demoteTargetThreshold) {
        b.type = 'bg'
        b.residualHistory = []
        if (b.displayId !== null) this.releaseDisplayId(b.displayId)
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
    if (smals.length > this.maxSmal) {
      smals.sort((a, b) => b.confidence - a.confidence)
      const keep = new Set(smals.slice(0, this.maxSmal).map(s => s.id))
      this.blobs = this.blobs.filter(b => b.type !== 'smal' || keep.has(b.id))
    }
  }

  private updateSnapshot(b: DriftBlob) {
    const sw = Math.min(b.w + 2, 50)
    const sh = Math.min(b.h + 2, 50)
    const hw = Math.floor(sw / 2)
    const hh = Math.floor(sh / 2)
    if (!b.snapshot || b.snapshot.length < 50 * 50) b.snapshot = new Uint8Array(50 * 50)
    b.snapshot.fill(0, 0, sw * sh)
    for (let dy = 0; dy < sh; dy++) {
      for (let dx = 0; dx < sw; dx++) {
        const px = Math.round(b.cx) - hw + dx
        const py = Math.round(b.cy) - hh + dy
        if (px >= 0 && px < this.imgW && py >= 0 && py < this.imgH) {
          b.snapshot[dy * sw + dx] = this.gray[py * this.imgW + px]
        }
      }
    }
    b.snapshotW = sw
    b.snapshotH = sh
  }

  private computeSAD(snap: Uint8Array, snapW: number, snapH: number, cx: number, cy: number): number {
    const hw = Math.floor(snapW / 2)
    const hh = Math.floor(snapH / 2)
    let sad = 0
    let count = 0
    for (let dy = 0; dy < snapH; dy++) {
      for (let dx = 0; dx < snapW; dx++) {
        const fx = Math.round(cx) - hw + dx
        const fy = Math.round(cy) - hh + dy
        if (fx < 0 || fx >= this.imgW || fy < 0 || fy >= this.imgH) continue
        sad += Math.abs(this.gray[fy * this.imgW + fx] - snap[dy * snapW + dx])
        count++
      }
    }
    return count > 0 ? sad / count : Infinity
  }

  private findInNextFrame(
    snap: Uint8Array, snapW: number, snapH: number, px: number, py: number, searchRadius: number
  ): { cx: number; cy: number } {
    let bestOx = 0, bestOy = 0
    let bestScore = this.computeSAD(snap, snapW, snapH, px, py)
    let improved = true
    while (improved) {
      improved = false
      let nextOx = bestOx, nextOy = bestOy, nextScore = bestScore
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const ox = bestOx + dx
          const oy = bestOy + dy
          if (Math.abs(ox) > searchRadius || Math.abs(oy) > searchRadius) continue
          const score = this.computeSAD(snap, snapW, snapH, px + ox, py + oy)
          if (score < nextScore) {
            nextScore = score
            nextOx = ox
            nextOy = oy
          }
        }
      }
      if (nextScore < bestScore) {
        bestScore = nextScore
        bestOx = nextOx
        bestOy = nextOy
        improved = true
      }
    }
    return { cx: px + bestOx, cy: py + bestOy }
  }

  private floodFillBBox(startX: number, startY: number): {
    cx: number; cy: number; area: number; w: number; h: number; bbox: [number, number, number, number]
  } | null {
    let sx = Math.max(0, Math.min(this.imgW - 1, Math.round(startX)))
    let sy = Math.max(0, Math.min(this.imgH - 1, Math.round(startY)))
    if (this.gray[sy * this.imgW + sx] <= this.threshold) {
      let found = false
      for (let r = 1; r <= 3 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            const nx = sx + dx, ny = sy + dy
            if (nx >= 0 && nx < this.imgW && ny >= 0 && ny < this.imgH && this.gray[ny * this.imgW + nx] > this.threshold) {
              sx = nx; sy = ny; found = true
            }
          }
        }
      }
      if (!found) return null
    }
    this.visitStamp++
    const stamp = this.visitStamp
    const stack = this.ffStack
    stack.length = 0
    stack.push(sy * this.imgW + sx)
    let sumX = 0, sumY = 0, count = 0
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0
    while (stack.length > 0 && count < this.maxArea) {
      const idx = stack.pop()!
      if (this.visitedMap[idx] === stamp) continue
      const x = idx % this.imgW
      const y = (idx - x) / this.imgW
      if (this.gray[idx] <= this.threshold) continue
      this.visitedMap[idx] = stamp
      sumX += x; sumY += y; count++
      if (x < minX) minX = x; if (y < minY) minY = y
      if (x > maxX) maxX = x; if (y > maxY) maxY = y
      if (x > 0) stack.push(idx - 1)
      if (x < this.imgW - 1) stack.push(idx + 1)
      if (y > 0) stack.push(idx - this.imgW)
      if (y < this.imgH - 1) stack.push(idx + this.imgW)
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
    this.markGridBbox(b.bbox)
  }

  private markGridBbox(bbox: [number, number, number, number]) {
    const [l, t, r, bb] = bbox
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

  private absorb(into: DriftBlob, from: DriftBlob) {
    into.cx = Math.round((into.cx * into.area + from.cx * from.area) / (into.area + from.area))
    into.cy = Math.round((into.cy * into.area + from.cy * from.area) / (into.area + from.area))
    into.area += from.area
    into.bbox = unionBbox(into.bbox, from.bbox)
    into.w = into.bbox[2] - into.bbox[0]
    into.h = into.bbox[3] - into.bbox[1]
    into.vx = (into.vx + from.vx) / 2
    into.vy = (into.vy + from.vy) / 2
    if (from.displayId !== null) {
      if (into.displayId === null) into.displayId = from.displayId
      else this.releaseDisplayId(from.displayId)
    }
    this.updateSnapshot(into)
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
      lowResidualFrames: 0,
      highResidualFrames: b.residualHistory.reduce((s, v) => s + v, 0),
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
      const rh = b.residualHistory.reduce((s, v) => s + v, 0)
      console.log(`  ${tag} id=${b.id} conf=${b.confidence.toFixed(0)} (${b.cx.toFixed(0)},${b.cy.toFixed(0)}) v=(${b.vx.toFixed(0)},${b.vy.toFixed(0)}) res=${res.toFixed(0)} rh=${rh}/${b.residualHistory.length} a=${b.area} s=${b.framesSeen} m=${b.missMs.toFixed(0)}ms`)
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
