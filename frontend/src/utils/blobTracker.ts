export type PatchMethod = 'ncc' | 'xor'

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
  patch: Uint8Array | null
  patchW: number
  patchH: number
  patternScore: number
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
  maxArea: 256,
  confirmationFrames: 3,
  demotionFrames: 15,
  jerkDemotionFrames: 10,
  jerkThreshold: 120,
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
  private rawPixels: Uint8Array | null = null
  private imgW = 0
  private imgH = 0

  constructor(config: Partial<TrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.displayPool = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  }

  setBinaryImage(binary: Uint8Array, w: number, h: number, rawPixels?: Uint8Array) {
    this.binary = binary
    this.rawPixels = rawPixels ?? null
    this.imgW = w
    this.imgH = h
  }

  setAreaRange(min: number, max: number) {
    this.config.minArea = min
    this.config.maxArea = max
  }

  update(patchMethod: PatchMethod = 'ncc'): TrackedBlob[] {
    if (!this.binary) return this.table
    const now = performance.now()
    const dt = this.config.frameDt

    if (this.table.length === 0) {
      this.initialScan(now)
      return this.table
    }

    this.verify(now, dt, patchMethod)
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

  private extractGrayRect(x0: number, y0: number, w: number, h: number): Uint8Array {
    const patch = new Uint8Array(w * h)
    let idx = 0
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = x0 + dx
        const y = y0 + dy
        if (x >= 0 && x < this.imgW && y >= 0 && y < this.imgH && this.rawPixels) {
          const i = (y * this.imgW + x) * 4
          patch[idx++] = (this.rawPixels[i] + this.rawPixels[i + 1] + this.rawPixels[i + 2]) / 3
        } else {
          patch[idx++] = 0
        }
      }
    }
    return patch
  }

  private computeAreaFromBinary(cx: number, cy: number, halfW: number, halfH: number): { area: number; bbox: [number, number, number, number] } {
    let count = 0
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0
    for (let dy = -halfH; dy < halfH; dy++) {
      for (let dx = -halfW; dx < halfW; dx++) {
        const x = Math.round(cx) + dx
        const y = Math.round(cy) + dy
        if (x >= 0 && x < this.imgW && y >= 0 && y < this.imgH && this.binary) {
          if (this.binary[y * this.imgW + x]) {
            count++
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
          }
        }
      }
    }
    return { area: count, bbox: [minX, minY, maxX + 1, maxY + 1] as [number, number, number, number] }
  }

  private scoreNCC(patch1: Uint8Array, patch2: Uint8Array): number {
    const len = Math.min(patch1.length, patch2.length)
    if (len === 0) return 0

    let sum1 = 0, sum2 = 0, sum12 = 0
    let sqSum1 = 0, sqSum2 = 0

    for (let i = 0; i < len; i++) {
      sum1 += patch1[i]
      sum2 += patch2[i]
      sum12 += patch1[i] * patch2[i]
      sqSum1 += patch1[i] * patch1[i]
      sqSum2 += patch2[i] * patch2[i]
    }

    const n = len
    const num = n * sum12 - sum1 * sum2
    const den = Math.sqrt((n * sqSum1 - sum1 * sum1) * (n * sqSum2 - sum2 * sum2))

    return den === 0 ? 0 : num / den
  }

  private scoreSAD(patch1: Uint8Array, patch2: Uint8Array): number {
    const len = Math.min(patch1.length, patch2.length)
    if (len === 0) return Infinity
    let sad = 0
    for (let i = 0; i < len; i++) {
      sad += Math.abs(patch1[i] - patch2[i])
    }
    return sad / len
  }

  private matchBySliding(
    predCx: number, predCy: number, searchRadius: number,
    storedPatch: Uint8Array, patchW: number, patchH: number,
    method: PatchMethod
  ): { cx: number; cy: number; area: number; bbox: [number, number, number, number]; patch: Uint8Array; patchW: number; patchH: number; score: number } | null {
    const halfW = Math.floor(patchW / 2)
    const halfH = Math.floor(patchH / 2)
    const margin = Math.max(halfW, halfH)
    const x0 = Math.max(0, Math.round(predCx - margin - searchRadius))
    const y0 = Math.max(0, Math.round(predCy - margin - searchRadius))
    const x1 = Math.min(this.imgW, Math.round(predCx + margin + searchRadius))
    const y1 = Math.min(this.imgH, Math.round(predCy + margin + searchRadius))

    let bestScore = -Infinity
    let bestCx = -1, bestCy = -1

    for (let cy = y0 + halfH; cy < y1 - halfH; cy++) {
      for (let cx = x0 + halfW; cx < x1 - halfW; cx++) {
        const dx = cx - predCx, dy = cy - predCy
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > searchRadius + margin) continue

        const candidate = this.extractGrayRect(cx - halfW, cy - halfH, patchW, patchH)
        let rawScore: number
        if (method === 'ncc') {
          rawScore = this.scoreNCC(storedPatch, candidate)
        } else {
          rawScore = 1 / (1 + this.scoreSAD(storedPatch, candidate))
        }
        const distPenalty = dist * 0.01
        const score = rawScore - distPenalty

        if (score > bestScore) {
          bestScore = score
          bestCx = cx
          bestCy = cy
        }
      }
    }

    if (bestCx < 0 || bestScore < 0.1) return null

    const areaHalfW = Math.max(halfW, Math.ceil(Math.sqrt(this.config.maxArea) / 2))
    const areaHalfH = Math.max(halfH, Math.ceil(Math.sqrt(this.config.maxArea) / 2))
    const { area, bbox } = this.computeAreaFromBinary(bestCx, bestCy, areaHalfW, areaHalfH)
    const newPatch = this.extractGrayRect(bestCx - halfW, bestCy - halfH, patchW, patchH)

    return { cx: bestCx, cy: bestCy, area, bbox, patch: newPatch, patchW, patchH, score: bestScore }
  }

  private verify(now: number, dt: number, method: PatchMethod) {

    for (const t of this.table) {
      const predCx = t.cx + t.vx * dt
      const predCy = t.cy + t.vy * dt

      let found: { cx: number; cy: number; area: number; bbox: [number, number, number, number]; patch?: Uint8Array; score?: number } | null = null

      if (t.patch && t.displayId !== null) {
        found = this.matchBySliding(predCx, predCy, this.config.searchRadius, t.patch, t.patchW, t.patchH, method)
      }

      if (!found) {
        found = this.searchAround(predCx, predCy, this.config.searchRadius)
      }

      if (!found && t.displayId !== null && this.rawPixels) {
        const rawFound = this.searchAroundRaw(predCx, predCy, this.config.searchRadius, 10)
        if (rawFound) {
          const pw = rawFound.bbox[2] - rawFound.bbox[0] + 8
          const ph = rawFound.bbox[3] - rawFound.bbox[1] + 8
          const px0 = Math.round(rawFound.cx) - Math.floor(pw / 2)
          const py0 = Math.round(rawFound.cy) - Math.floor(ph / 2)
          found = { ...rawFound, patch: this.extractGrayRect(px0, py0, pw, ph) }
        }
      }

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

        if (found.patch) {
          t.patch = found.patch
          t.patchW = found.patchW
          t.patchH = found.patchH
          t.patternScore = found.score ?? 0
        } else {
          const pw = t.bbox[2] - t.bbox[0] + 8
          const ph = t.bbox[3] - t.bbox[1] + 8
          const px0 = Math.round(t.cx) - Math.floor(pw / 2)
          const py0 = Math.round(t.cy) - Math.floor(ph / 2)
          t.patch = this.extractGrayRect(px0, py0, pw, ph)
          t.patchW = pw
          t.patchH = ph
          t.patternScore = 1
        }
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
    const missed = this.table.filter(t => t.missMs > 0 && t.missMs <= this.config.maxMissingMs)

    for (let y = 0; y < this.imgH; y++) {
      for (let x = 0; x < this.imgW; x++) {
        const px = y * this.imgW + x
        if (covered[px] || visited[px] || !this.binary[px]) continue

        const blob = this.floodFillFull(x, y, visited)
        if (!blob || blob.area < this.config.minArea || blob.area > this.config.maxArea) continue

        let adopted = false
        for (const t of missed) {
          const dist = Math.sqrt((blob.cx - t.cx) ** 2 + (blob.cy - t.cy) ** 2)
          if (dist < r * 2) {
            t.cx = blob.cx
            t.cy = blob.cy
            t.area = blob.area
            t.bbox = blob.bbox
            t.missMs = 0
            t.framesSeen++
            t.lastSeen = now
            const pw = blob.bbox[2] - blob.bbox[0] + 8
            const ph = blob.bbox[3] - blob.bbox[1] + 8
            t.patch = this.extractGrayRect(Math.round(blob.cx) - Math.floor(pw / 2), Math.round(blob.cy) - Math.floor(ph / 2), pw, ph)
            t.patchW = pw
            t.patchH = ph
            adopted = true
            break
          }
        }

        if (!adopted) {
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
      const jerkLimit = t.area < 10 ? this.config.jerkDemotionFrames * 3 : this.config.jerkDemotionFrames
      if (t.lowResidualFrames >= this.config.demotionFrames
        || t.highJerkFrames >= jerkLimit) {
        this.releaseDisplayId(t.displayId)
        t.displayId = null
        t.lowResidualFrames = 0
        t.highJerkFrames = 0
      }
    }

    const speed = (t: TrackedBlob) => Math.sqrt(t.vx * t.vx + t.vy * t.vy)
    const candidates = this.table
      .filter(t => {
        if (t.displayId !== null) return false
        if (t.framesSeen < this.config.confirmationFrames) return false
        if (speed(t) <= this.config.residualThreshold) return false
        const jerkLimit = t.area < 10 ? this.config.jerkDemotionFrames * 3 : this.config.jerkDemotionFrames
        if (t.highJerkFrames >= jerkLimit) return false
        return true
      })
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

  private searchAroundRaw(
    cx: number, cy: number, radius: number, threshold: number
  ): { cx: number; cy: number; area: number; bbox: [number, number, number, number] } | null {
    if (!this.rawPixels) return null

    const x0 = Math.max(0, Math.round(cx - radius))
    const y0 = Math.max(0, Math.round(cy - radius))
    const x1 = Math.min(this.imgW, Math.round(cx + radius))
    const y1 = Math.min(this.imgH, Math.round(cy + radius))

    let bestDist = Infinity
    let seedX = -1, seedY = -1

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * this.imgW + x) * 4
        const brightness = (this.rawPixels[idx] + this.rawPixels[idx + 1] + this.rawPixels[idx + 2]) / 3
        if (brightness > threshold) {
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
          if (visited.has(npx)) continue
          const idx = (ny * this.imgW + nx) * 4
          const brightness = (this.rawPixels[idx] + this.rawPixels[idx + 1] + this.rawPixels[idx + 2]) / 3
          if (brightness <= threshold) continue
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
    const pw = blob.bbox[2] - blob.bbox[0] + 8
    const ph = blob.bbox[3] - blob.bbox[1] + 8
    const px0 = Math.round(blob.cx) - Math.floor(pw / 2)
    const py0 = Math.round(blob.cy) - Math.floor(ph / 2)
    const patch = this.extractGrayRect(px0, py0, pw, ph)
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
      patch,
      patchW: pw,
      patchH: ph,
      patternScore: 1,
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
