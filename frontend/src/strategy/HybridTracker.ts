import { BlobFinder } from '../utils/blobFinder'
import { TrackedBlob } from '../utils/blobTracker'
import { DetectionStrategy, StrategyResult } from './types'

interface FlowVec {
  cx: number
  cy: number
  vx: number
  vy: number
}

export class HybridTracker implements DetectionStrategy {
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
  private maxMissingMs = 400
  private maxNoiseObjects = 15
  private residualThreshold = 25
  private demotionFrames = 10
  private patchSize = 8
  private flowRadius = 20
  private flowDown = 4
  private bgVx = 0
  private bgVy = 0
  private flowVectors: FlowVec[] = []

  private confidence: Map<number, number> = new Map()
  private velocityHistory: Map<number, number[]> = new Map()
  private refPatches: Map<number, Uint8Array> = new Map()
  private historyLen = 8
  private promoteThreshold = 80
  private demoteThreshold = 60
  private framesWithFlow = 0
  private debug = false
  private frameIdx = 0
  private confLog: Map<number, string[]> = new Map()

  setDebug(on: boolean) { this.debug = on }

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
    this.frameIdx++
    if (this.prevGray.length === this.imgW * this.imgH) {
      this.flowVectors = this.computeFlow()
      this.computeBgFromFlow()
      this.framesWithFlow++
    }
    if (this.table.length === 0) {
      this.initialScan()
    } else {
      this.verify()
      this.detectNew()
      this.classify()
      this.expire()
    }
    if (this.debug) this.printDebug()
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
    this.flowVectors = []
    this.bgVx = 0
    this.bgVy = 0
    this.confidence.clear()
    this.velocityHistory.clear()
    this.refPatches.clear()
    this.confLog.clear()
    this.frameIdx = 0
    this.framesWithFlow = 0
  }

  private extractPatch(cx: number, cy: number): Uint8Array | null {
    const ps = this.patchSize
    const hw = Math.floor(ps / 2)
    const patch = new Uint8Array(ps * ps)
    let bright = 0
    for (let dy = 0; dy < ps; dy++) {
      for (let dx = 0; dx < ps; dx++) {
        const px = Math.round(cx) - hw + dx
        const py = Math.round(cy) - hw + dy
        if (px >= 0 && px < this.imgW && py >= 0 && py < this.imgH) {
          const val = this.gray[py * this.imgW + px]
          patch[dy * ps + dx] = val
          if (val > this.threshold) bright++
        }
      }
    }
    if (bright < ps * ps * 0.5) return null
    return patch
  }

  private patchSad(a: Uint8Array, b: Uint8Array): number {
    let sad = 0
    const len = Math.min(a.length, b.length)
    for (let i = 0; i < len; i++) sad += Math.abs(a[i] - b[i])
    return sad
  }

  private computeFlow(): FlowVec[] {
    if (this.prevGray.length !== this.imgW * this.imgH) return []
    const vectors: FlowVec[] = []
    const d = this.flowDown
    const sw = Math.floor(this.imgW / d)
    const sh = Math.floor(this.imgH / d)
    const step = 4
    for (let sy = step; sy < sh - step; sy += step) {
      for (let sx = step; sx < sw - step; sx += step) {
        const x = sx * d
        const y = sy * d
        let sum = 0
        for (let dy = -step; dy <= step; dy++) {
          for (let dx = -step; dx <= step; dx++) {
            const px = x + dx * d
            const py = y + dy * d
            if (px >= 0 && px < this.imgW && py >= 0 && py < this.imgH) {
              sum += this.gray[py * this.imgW + px]
            }
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
        if (bright < 3) continue

        const sr = this.flowRadius
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

  private computeBgFromFlow() {
    if (this.flowVectors.length < 3) { this.bgVx = 0; this.bgVy = 0; return }
    const sx = [...this.flowVectors].sort((a, b) => a.vx - b.vx)
    const mx = Math.floor(sx.length / 2)
    this.bgVx = sx.length % 2 === 0 ? (sx[mx - 1].vx + sx[mx].vx) / 2 : sx[mx].vx
    const sy = [...this.flowVectors].sort((a, b) => a.vy - b.vy)
    const my = Math.floor(sy.length / 2)
    this.bgVy = sy.length % 2 === 0 ? (sy[my - 1].vy + sy[my].vy) / 2 : sy[my].vy
  }

  private verify() {
    for (const t of this.table) {
      const predCx = t.cx + t.vx * this.dt
      const predCy = t.cy + t.vy * this.dt
      let ncx = predCx, ncy = predCy
      let found = false

      let matchFlow: FlowVec | null = null
      let bestDist = Infinity
      for (const v of this.flowVectors) {
        const dist = Math.sqrt((v.cx - t.cx) ** 2 + (v.cy - t.cy) ** 2)
        if (dist < this.flowRadius * 2 && dist < bestDist) { bestDist = dist; matchFlow = v }
      }

      const searchR = 15

      if (matchFlow) {
        const fpX = t.cx + matchFlow.vx * this.dt
        const fpY = t.cy + matchFlow.vy * this.dt
        const centroid = this.findCentroidNear(fpX, fpY, searchR)
        if (centroid) {
          ncx = centroid.cx; ncy = centroid.cy
          t.area = centroid.area; t.bbox = centroid.bbox
          t.avgArea = t.avgArea * 0.6 + centroid.area * 0.4
          found = true
        } else {
          ncx = fpX; ncy = fpY; found = true
        }
      }

      if (!found) {
        const centroid = this.findCentroidNear(predCx, predCy, searchR)
        if (centroid) {
          ncx = centroid.cx; ncy = centroid.cy
          t.area = centroid.area; t.bbox = centroid.bbox
          t.avgArea = t.avgArea * 0.6 + centroid.area * 0.4
          found = true
        }
      }

      if (!found) {
        const centroid = this.findCentroidNear(t.cx, t.cy, searchR)
        if (centroid) {
          ncx = centroid.cx; ncy = centroid.cy
          t.area = centroid.area; t.bbox = centroid.bbox
          t.avgArea = t.avgArea * 0.7 + centroid.area * 0.3
          found = true
        }
      }

      if (found) {
        const rawDx = ncx - t.cx
        const rawDy = ncy - t.cy
        const disp = Math.sqrt(rawDx * rawDx + rawDy * rawDy)
        if (disp > 15) {
          const scale = 15 / disp
          ncx = t.cx + rawDx * scale
          ncy = t.cy + rawDy * scale
        }
        const rawVx = (ncx - t.cx) / this.dt
        const rawVy = (ncy - t.cy) / this.dt
        t.vx = t.vx * 0.5 + rawVx * 0.5
        t.vy = t.vy * 0.5 + rawVy * 0.5
        t.cx = ncx; t.cy = ncy
        t.missMs = 0; t.framesSeen++
        t.lastSeen = performance.now()

        const patch = this.extractPatch(ncx, ncy)
        if (patch) {
          const prev = this.refPatches.get(t.internalId)
          if (prev) {
            const appearanceDelta = this.patchSad(patch, prev) / (this.patchSize * this.patchSize)
            if (appearanceDelta > 40) {
              const conf = this.confidence.get(t.internalId) ?? 50
              this.confidence.set(t.internalId, Math.max(0, conf - 5))
            }
          }
          this.refPatches.set(t.internalId, patch)
        }
      } else {
        t.cx += t.vx * this.dt; t.cy += t.vy * this.dt
        t.missMs += this.dt * 1000
        t.vx *= 0.7; t.vy *= 0.7
      }
    }
  }

  private dedup() {
    const remove = new Set<number>()
    for (let i = 0; i < this.table.length; i++) {
      if (remove.has(this.table[i].internalId)) continue
      for (let j = i + 1; j < this.table.length; j++) {
        if (remove.has(this.table[j].internalId)) continue
        const a = this.table[i], b = this.table[j]
        const d = Math.sqrt((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2)
        if (d < 15) {
          const keep = (a.displayId ?? -1) > (b.displayId ?? -1) ? a : b
          const kill = keep === a ? b : a
          if (kill.displayId !== null && keep.displayId === null) keep.displayId = kill.displayId
          keep.vx = (keep.vx + kill.vx) / 2
          keep.vy = (keep.vy + kill.vy) / 2
          remove.add(kill.internalId)
        }
      }
    }
    if (remove.size > 0) {
      this.table = this.table.filter(t => !remove.has(t.internalId))
      for (const id of remove) {
        this.confidence.delete(id)
        this.velocityHistory.delete(id)
        this.refPatches.delete(id)
      }
    }
  }

  private detectNew() {
    const masked = new Uint8Array(this.gray)
    for (const t of this.table) {
      const r = Math.max(10, Math.sqrt(t.area) * 2)
      const x0 = Math.max(0, Math.round(t.cx - r))
      const y0 = Math.max(0, Math.round(t.cy - r))
      const x1 = Math.min(this.imgW, Math.round(t.cx + r))
      const y1 = Math.min(this.imgH, Math.round(t.cy + r))
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          masked[y * this.imgW + x] = 0
    }
    const bf = new BlobFinder()
    bf.setGray(masked, this.imgW, this.imgH)
    const blobs = bf.nearbyBlobMerge({
      threshold: this.threshold, mergeDistance: 2, nmsDistance: 15,
      minArea: this.minArea, maxArea: this.maxArea,
    })
    for (const b of blobs) this.insertBlob(b.cx, b.cy, b.w * b.h)
  }

  private computeBgFromTracks() {
    if (this.table.length < 3) return
    const vxs = [...this.table].sort((a, b) => a.vx - b.vx)
    const mx = Math.floor(vxs.length / 2)
    const trackBgVx = vxs.length % 2 === 0 ? (vxs[mx - 1].vx + vxs[mx].vx) / 2 : vxs[mx].vx
    const vys = [...this.table].sort((a, b) => a.vy - b.vy)
    const my = Math.floor(vys.length / 2)
    const trackBgVy = vys.length % 2 === 0 ? (vys[my - 1].vy + vys[my].vy) / 2 : vys[my].vy
    if (this.flowVectors.length >= 5) return
    this.bgVx = this.bgVx * 0.7 + trackBgVx * 0.3
    this.bgVy = this.bgVy * 0.7 + trackBgVy * 0.3
  }

  private classify() {
    this.computeBgFromTracks()
    for (const t of this.table) {
      const rvx = t.vx - this.bgVx
      const rvy = t.vy - this.bgVy
      const residual = Math.sqrt(rvx * rvx + rvy * rvy)
      t.residualSpeed = residual
      const speed = Math.sqrt(t.vx ** 2 + t.vy ** 2)

      let conf = this.confidence.get(t.internalId) ?? 50
      const deltas: string[] = []

      if (residual > this.residualThreshold) {
        let boost = Math.min(10, 4 + Math.floor(Math.max(0, residual - 50) / 25) * 2)
        if (t.area < 10) boost = Math.min(boost, 2)
        conf += boost
        deltas.push(`+R(${residual.toFixed(0)}>${this.residualThreshold} a=${t.area} +${boost})`)
      } else {
        conf -= 10; deltas.push(`-R(${residual.toFixed(0)}<${this.residualThreshold})`)
      }

      if (speed < 2) { conf -= 5; deltas.push(`-SLOW(${speed.toFixed(1)})`) }

      if (t.missMs > 0) { conf -= 15; deltas.push(`-MISS(${t.missMs.toFixed(0)}ms)`) }

      const hist = this.velocityHistory.get(t.internalId) ?? []
      hist.push(residual > this.residualThreshold ? 1 : 0)
      if (hist.length > this.historyLen) hist.shift()
      this.velocityHistory.set(t.internalId, hist)

      const recentMoving = hist.reduce((s, v) => s + v, 0) / hist.length
      if (recentMoving < 0.3) { conf -= 8; deltas.push(`-HIST(${(recentMoving * 100).toFixed(0)}%)`) }

      conf = Math.max(0, Math.min(100, conf))
      this.confidence.set(t.internalId, conf)

      if (this.debug) {
        const log = this.confLog.get(t.internalId) ?? []
        log.push(`f${this.frameIdx} conf=${conf} ${deltas.join(' ')} | vx=${t.vx.toFixed(1)} vy=${t.vy.toFixed(1)} bgVx=${this.bgVx.toFixed(1)} bgVy=${this.bgVy.toFixed(1)} area=${t.area} seen=${t.framesSeen}`)
        this.confLog.set(t.internalId, log)
      }

      if (t.displayId === null && conf >= this.promoteThreshold && t.framesSeen >= 5 && t.area >= this.minArea && this.framesWithFlow >= 3) {
        const nearTarget = this.table.some(o => o !== t && o.displayId !== null &&
          Math.sqrt((o.cx - t.cx) ** 2 + (o.cy - t.cy) ** 2) < 30)
        if (!nearTarget && this.activeDisplayIds.size < this.displayPool.length) {
          t.displayId = this.allocateDisplayId()
          if (this.debug) console.log(`[HYBRID] PROMOTE id=${t.internalId} displayId=${t.displayId} conf=${conf} at (${t.cx.toFixed(0)},${t.cy.toFixed(0)}) frame=${this.frameIdx}`)
        }
      }

      if (t.displayId !== null && conf <= this.demoteThreshold) {
        if (this.debug) console.log(`[HYBRID] DEMOTE id=${t.internalId} displayId=${t.displayId} conf=${conf} at (${t.cx.toFixed(0)},${t.cy.toFixed(0)}) frame=${this.frameIdx}`)
        this.releaseDisplayId(t.displayId)
        t.displayId = null
      }

      if (t.displayId !== null && t.lowResidualFrames >= this.demotionFrames) {
        if (this.debug) console.log(`[HYBRID] DEMOTE-lowRes id=${t.internalId} displayId=${t.displayId} lowRes=${t.lowResidualFrames} frame=${this.frameIdx}`)
        this.releaseDisplayId(t.displayId)
        t.displayId = null
      }
    }
  }

  private expire() {
    this.table = this.table.filter(t => {
      if (t.cx < -50 || t.cy < -50 || t.cx > this.imgW + 50 || t.cy > this.imgH + 50) {
        if (t.displayId !== null) this.releaseDisplayId(t.displayId)
        this.confidence.delete(t.internalId)
        this.velocityHistory.delete(t.internalId)
        this.refPatches.delete(t.internalId)
        return false
      }
      const maxMs = t.displayId !== null ? this.maxMissingMs * 2 : this.maxMissingMs
      if (t.missMs > maxMs) {
        if (t.displayId !== null) this.releaseDisplayId(t.displayId)
        this.confidence.delete(t.internalId)
        this.velocityHistory.delete(t.internalId)
        this.refPatches.delete(t.internalId)
        return false
      }
      return true
    })
    const noise = this.table.filter(t => t.displayId === null)
    if (noise.length > this.maxNoiseObjects) {
      noise.sort((a, b) => (this.confidence.get(b.internalId) ?? 0) - (this.confidence.get(a.internalId) ?? 0))
      const keep = new Set(noise.slice(0, this.maxNoiseObjects).map(t => t.internalId))
      const removed = noise.slice(this.maxNoiseObjects)
      for (const t of removed) {
        this.confidence.delete(t.internalId)
        this.velocityHistory.delete(t.internalId)
        this.refPatches.delete(t.internalId)
      }
      this.table = this.table.filter(t => t.displayId !== null || keep.has(t.internalId))
    }
  }

  private initialScan() {
    const blobs = this.blobFinder.nearbyBlobMerge({
      threshold: this.threshold, mergeDistance: 2, nmsDistance: 15,
      minArea: this.minArea, maxArea: this.maxArea,
    })
    for (const b of blobs) this.insertBlob(b.cx, b.cy, b.w * b.h)
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
          if (x < minX) minX = x; if (y < minY) minY = y
          if (x > maxX) maxX = x; if (y > maxY) maxY = y
        }
      }
    }
    if (count < this.minArea) return null
    return {
      cx: Math.round(sumX / count), cy: Math.round(sumY / count), area: count,
      bbox: [Math.max(0, minX - 1), Math.max(0, minY - 1), Math.min(this.imgW, maxX + 2), Math.min(this.imgH, maxY + 2)],
    }
  }

  private insertBlob(cx: number, cy: number, area: number) {
    const id = this.nextId++
    this.confidence.set(id, 40)
    this.velocityHistory.set(id, [])
    const patch = this.extractPatch(cx, cy)
    if (patch) this.refPatches.set(id, patch)
    this.table.push({
      internalId: id, displayId: null,
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

  private printDebug() {
    const targets = this.table.filter(t => t.displayId !== null)
    const noise = this.table.filter(t => t.displayId === null)
    console.log(`\n[HYBRID] === frame ${this.frameIdx} | bgV=${this.bgVx.toFixed(1)},${this.bgVy.toFixed(1)} | tracks=${this.table.length} targets=${targets.length} noise=${noise.length} ===`)
    for (const t of this.table) {
      const conf = this.confidence.get(t.internalId) ?? 0
      const tag = t.displayId !== null ? `TGT#${t.displayId}` : 'noise'
      const hist = this.velocityHistory.get(t.internalId) ?? []
      const moving = hist.reduce((s, v) => s + v, 0)
      console.log(`  id=${t.internalId} ${tag} conf=${conf} (${t.cx.toFixed(0)},${t.cy.toFixed(0)}) v=(${t.vx.toFixed(1)},${t.vy.toFixed(1)}) res=${t.residualSpeed.toFixed(1)} area=${t.area} seen=${t.framesSeen} miss=${t.missMs.toFixed(0)}ms hist=${moving}/${hist.length}`)
    }
  }
}
