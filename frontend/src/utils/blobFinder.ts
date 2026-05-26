// Blob detection algorithms — each approach has different tradeoffs.
// Only nearbyBlobMerge is currently used; others are available for experimentation.
// Keep all implementations; they document the design space and can be swapped in.

export interface BlobCandidate {
  cx: number
  cy: number
  w: number
  h: number
  confidence: number
}

export interface BlobFinderConfig {
  threshold: number
  minArea: number
  maxArea: number
  dilateRadius: number
  hysteresisLow: number
  hysteresisHigh: number
  mergeDistance: number
  dbscanEps: number
  dbscanMinPts: number
  blurRadius: number
  peakMinDistance: number
  integralWindowSize: number
  projectionThreshold: number
  poolSize: number
  nmsDistance: number
}

const DEFAULT_CONFIG: BlobFinderConfig = {
  threshold: 25,
  minArea: 4,
  maxArea: 256,
  dilateRadius: 1,
  hysteresisLow: 15,
  hysteresisHigh: 35,
  mergeDistance: 3,
  dbscanEps: 3,
  dbscanMinPts: 4,
  blurRadius: 2,
  peakMinDistance: 3,
  integralWindowSize: 10,
  projectionThreshold: 30,
  poolSize: 2,
  nmsDistance: 5,
}

export class BlobFinder {
  private gray: Uint8Array = new Uint8Array(0)
  private w = 0
  private h = 0
  private config: BlobFinderConfig
  private autoThreshold = 25

  private _thresholdBuf: Uint8Array = new Uint8Array(0)
  private _dilateBuf: Uint8Array = new Uint8Array(0)
  private _visitedBuf: Uint8Array = new Uint8Array(0)
  private _blurOut: Uint8Array = new Uint8Array(0)
  private _blurTemp: Float32Array = new Float32Array(0)
  private _queueBuf: Int32Array = new Int32Array(0)

  constructor(config: Partial<BlobFinderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  private ensureBuffers() {
    const n = this.w * this.h
    if (this._thresholdBuf.length !== n) {
      this._thresholdBuf = new Uint8Array(n)
      this._dilateBuf = new Uint8Array(n)
      this._visitedBuf = new Uint8Array(n)
      this._blurOut = new Uint8Array(n)
      this._blurTemp = new Float32Array(n)
      this._queueBuf = new Int32Array(n)
    }
  }

  setGray(gray: Uint8Array, w: number, h: number) {
    this.w = w
    this.h = h
    this.gray = gray
    this.ensureBuffers()
    this.autoThreshold = this.computeAutoThreshold()
  }

  setConfig(config: Partial<BlobFinderConfig>) {
    Object.assign(this.config, config)
  }

  getAutoThreshold(): number {
    return this.autoThreshold
  }

  dilateAndFloodFill(overrides: Partial<BlobFinderConfig> = {}): BlobCandidate[] {
    const cfg = { ...this.config, ...overrides }
    this.thresholdInto(this._thresholdBuf, cfg.threshold)
    this.dilateInto(this._dilateBuf, this._thresholdBuf, cfg.dilateRadius)
    const raw = this.floodFillAll(this._dilateBuf)
    return this.nms(this.areaFilter(raw, cfg), cfg.nmsDistance)
  }

  hysteresis(overrides: Partial<BlobFinderConfig> = {}): BlobCandidate[] {
    const cfg = { ...this.config, ...overrides }
    const grown = this.hysteresisGrow(cfg.hysteresisLow, cfg.hysteresisHigh)
    const raw = this.floodFillAll(grown)
    return this.nms(this.areaFilter(raw, cfg), cfg.nmsDistance)
  }

  nearbyBlobMerge(overrides: Partial<BlobFinderConfig> = {}): BlobCandidate[] {
    const cfg = { ...this.config, ...overrides }
    this.thresholdInto(this._thresholdBuf, cfg.threshold)
    const raw = this.floodFillAll(this._thresholdBuf)
    return this.nms(this.areaFilter(this.mergeNearby(raw, cfg.mergeDistance), cfg), cfg.nmsDistance)
  }

  dbscan(overrides: Partial<BlobFinderConfig> = {}): BlobCandidate[] {
    const cfg = { ...this.config, ...overrides }
    this.thresholdInto(this._thresholdBuf, cfg.threshold)
    const points: number[] = []
    for (let i = 0; i < this.w * this.h; i++) {
      if (this._thresholdBuf[i]) points.push(i)
    }

    const labels = new Int32Array(points.length).fill(-1)
    let clusterId = 0
    const eps2 = cfg.dbscanEps * cfg.dbscanEps

    for (let i = 0; i < points.length; i++) {
      if (labels[i] !== -1) continue
      const neighbors = this.regionQuery(points, i, eps2)
      if (neighbors.length < cfg.dbscanMinPts) continue

      labels[i] = clusterId
      const queue = [...neighbors]
      while (queue.length > 0) {
        const q = queue.shift()!
        if (labels[q] === -1) {
          labels[q] = clusterId
          const qNeighbors = this.regionQuery(points, q, eps2)
          if (qNeighbors.length >= cfg.dbscanMinPts) {
            for (const nb of qNeighbors) {
              if (labels[nb] <= 0) queue.push(nb)
            }
          }
        } else if (labels[q] === -2) {
          labels[q] = clusterId
        }
      }
      clusterId++
    }

    const raw: BlobCandidate[] = []
    for (let c = 0; c < clusterId; c++) {
      let sx = 0, sy = 0, cnt = 0
      for (let i = 0; i < points.length; i++) {
        if (labels[i] === c) {
          const x = points[i] % this.w
          const y = (points[i] - x) / this.w
          sx += x
          sy += y
          cnt++
        }
      }
      if (cnt >= cfg.minArea && cnt <= cfg.maxArea) {
        const cx = Math.round(sx / cnt)
        const cy = Math.round(sy / cnt)
        const { w, h } = this.measureExtent(cx, cy)
        raw.push({ cx, cy, w, h, confidence: Math.min(1, cnt / cfg.maxArea) })
      }
    }
    return this.nms(raw, cfg.nmsDistance)
  }

  gaussianBlurPeak(overrides: Partial<BlobFinderConfig> = {}): BlobCandidate[] {
    const cfg = { ...this.config, ...overrides }
    this.gaussianBlurInto(this._blurOut, this._blurTemp, this.gray, cfg.blurRadius)
    const dist = cfg.peakMinDistance
    const raw: BlobCandidate[] = []

    for (let y = dist; y < this.h - dist; y++) {
      for (let x = dist; x < this.w - dist; x++) {
        const val = this._blurOut[y * this.w + x]
        if (val < cfg.threshold) continue

        let isPeak = true
        for (let dy = -dist; dy <= dist && isPeak; dy++) {
          for (let dx = -dist; dx <= dist && isPeak; dx++) {
            if (dx === 0 && dy === 0) continue
            if (this._blurOut[(y + dy) * this.w + (x + dx)] > val) isPeak = false
          }
        }

        if (isPeak) {
          const { w: bw, h: bh } = this.measureExtent(x, y)
          if (bw * bh >= cfg.minArea) {
            raw.push({ cx: x, cy: y, w: bw, h: bh, confidence: val / 255 })
          }
        }
      }
    }
    return this.nms(raw, cfg.nmsDistance)
  }

  integralImage(overrides: Partial<BlobFinderConfig> = {}): BlobCandidate[] {
    const cfg = { ...this.config, ...overrides }
    const sz = cfg.integralWindowSize
    const halfSz = Math.floor(sz / 2)
    const integ = new Float64Array(this.w * this.h)

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const val = this.gray[y * this.w + x]
        integ[y * this.w + x] = val
          + (x > 0 ? integ[y * this.w + x - 1] : 0)
          + (y > 0 ? integ[(y - 1) * this.w + x] : 0)
          - (x > 0 && y > 0 ? integ[(y - 1) * this.w + x - 1] : 0)
      }
    }

    const raw: BlobCandidate[] = []
    for (let y = halfSz; y < this.h - halfSz; y += halfSz) {
      for (let x = halfSz; x < this.w - halfSz; x += halfSz) {
        const x0 = x - halfSz, y0 = y - halfSz
        const x1 = x + halfSz - 1, y1 = y + halfSz - 1
        const sum = integ[y1 * this.w + x1]
          - (x0 > 0 ? integ[y1 * this.w + x0 - 1] : 0)
          - (y0 > 0 ? integ[(y0 - 1) * this.w + x1] : 0)
          + (x0 > 0 && y0 > 0 ? integ[(y0 - 1) * this.w + x0 - 1] : 0)
        const avg = sum / (sz * sz)

        if (avg > cfg.projectionThreshold) {
          const { w: bw, h: bh } = this.measureExtent(x, y)
          raw.push({ cx: x, cy: y, w: bw, h: bh, confidence: Math.min(1, avg / 255) })
        }
      }
    }
    return this.nms(raw, cfg.nmsDistance)
  }

  projection(overrides: Partial<BlobFinderConfig> = {}): BlobCandidate[] {
    const cfg = { ...this.config, ...overrides }
    const rowSum = new Float64Array(this.h)
    const colSum = new Float64Array(this.w)
    const thresh = cfg.projectionThreshold

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        rowSum[y] += this.gray[y * this.w + x]
        colSum[x] += this.gray[y * this.w + x]
      }
    }

    const rowPeaks: number[] = []
    const colPeaks: number[] = []

    for (let y = 1; y < this.h - 1; y++) {
      if (rowSum[y] > thresh && rowSum[y] > rowSum[y - 1] && rowSum[y] >= rowSum[y + 1]) {
        rowPeaks.push(y)
      }
    }
    for (let x = 1; x < this.w - 1; x++) {
      if (colSum[x] > thresh && colSum[x] > colSum[x - 1] && colSum[x] >= colSum[x + 1]) {
        colPeaks.push(x)
      }
    }

    const raw: BlobCandidate[] = []
    for (const ry of rowPeaks) {
      for (const cx of colPeaks) {
        const val = this.gray[ry * this.w + cx]
        if (val > cfg.threshold) {
          const { w: bw, h: bh } = this.measureExtent(cx, ry)
          raw.push({ cx, cy: ry, w: bw, h: bh, confidence: Math.min(1, val / 255) })
        }
      }
    }
    return this.nms(raw, cfg.nmsDistance)
  }

  maxPooling(overrides: Partial<BlobFinderConfig> = {}): BlobCandidate[] {
    const cfg = { ...this.config, ...overrides }
    const sz = cfg.poolSize
    const pw = Math.ceil(this.w / sz)
    const ph = Math.ceil(this.h / sz)
    const pooled = new Uint8Array(pw * ph)

    for (let py = 0; py < ph; py++) {
      for (let px = 0; px < pw; px++) {
        let maxVal = 0
        for (let dy = 0; dy < sz; dy++) {
          for (let dx = 0; dx < sz; dx++) {
            const x = px * sz + dx
            const y = py * sz + dy
            if (x < this.w && y < this.h) {
              const v = this.gray[y * this.w + x]
              if (v > maxVal) maxVal = v
            }
          }
        }
        pooled[py * pw + px] = maxVal
      }
    }

    const raw: BlobCandidate[] = []
    for (let py = 1; py < ph - 1; py++) {
      for (let px = 1; px < pw - 1; px++) {
        const val = pooled[py * pw + px]
        if (val < cfg.threshold) continue
        let isPeak = true
        for (let dy = -1; dy <= 1 && isPeak; dy++) {
          for (let dx = -1; dx <= 1 && isPeak; dx++) {
            if (dx === 0 && dy === 0) continue
            if (pooled[(py + dy) * pw + (px + dx)] > val) isPeak = false
          }
        }
        if (isPeak) {
          const cx = px * sz + Math.floor(sz / 2)
          const cy = py * sz + Math.floor(sz / 2)
          const { w: bw, h: bh } = this.measureExtent(cx, cy)
          raw.push({ cx, cy, w: bw, h: bh, confidence: val / 255 })
        }
      }
    }
    return this.nms(raw, cfg.nmsDistance)
  }

  private computeAutoThreshold(): number {
    const n = this.w * this.h
    let sum = 0
    for (let i = 0; i < n; i++) sum += this.gray[i]
    const mean = sum / n
    let variance = 0
    for (let i = 0; i < n; i++) variance += (this.gray[i] - mean) ** 2
    const std = Math.sqrt(variance / n)
    return Math.min(255, Math.max(10, mean + 2 * std))
  }

  private thresholdInto(dst: Uint8Array, t: number) {
    for (let i = 0; i < this.w * this.h; i++) {
      dst[i] = this.gray[i] > t ? 1 : 0
    }
  }

  private dilateInto(dst: Uint8Array, src: Uint8Array, radius: number) {
    dst.fill(0)
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let found = false
        for (let dy = -radius; dy <= radius && !found; dy++) {
          for (let dx = -radius; dx <= radius && !found; dx++) {
            const nx = x + dx, ny = y + dy
            if (nx >= 0 && nx < this.w && ny >= 0 && ny < this.h && src[ny * this.w + nx]) {
              found = true
            }
          }
        }
        dst[y * this.w + x] = found ? 1 : 0
      }
    }
  }

  private hysteresisGrow(low?: number, high?: number): Uint8Array {
    const lo = low ?? this.config.hysteresisLow
    const hi = high ?? this.config.hysteresisHigh
    const grown = new Uint8Array(this.w * this.h)
    const queue: number[] = []

    for (let i = 0; i < this.w * this.h; i++) {
      if (this.gray[i] > hi) {
        grown[i] = 1
        queue.push(i)
      }
    }

    while (queue.length > 0) {
      const px = queue.shift()!
      const x = px % this.w
      const y = (px - x) / this.w
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= this.w || ny < 0 || ny >= this.h) continue
          const npx = ny * this.w + nx
          if (grown[npx]) continue
          if (this.gray[npx] > lo) {
            grown[npx] = 1
            queue.push(npx)
          }
        }
      }
    }
    return grown
  }

  private floodFillAll(src: Uint8Array): BlobCandidate[] {
    this._visitedBuf.fill(0)
    const visited = this._visitedBuf
    const queue = this._queueBuf
    const w = this.w
    const blobs: BlobCandidate[] = []

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const px = y * w + x
        if (visited[px] || !src[px]) continue

        visited[px] = 1
        let head = 0, tail = 1
        queue[0] = px
        let sumX = 0, sumY = 0, count = 0
        let minX = x, minY = y, maxX = x, maxY = y

        while (head < tail) {
          const cur = queue[head++]
          const cx = cur % w
          const cy = (cur - cx) / w
          sumX += cx
          sumY += cy
          count++
          if (cx < minX) minX = cx
          if (cy < minY) minY = cy
          if (cx > maxX) maxX = cx
          if (cy > maxY) maxY = cy

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = cx + dx, ny = cy + dy
              if (nx < 0 || nx >= w || ny < 0 || ny >= this.h) continue
              const npx = ny * w + nx
              if (visited[npx] || !src[npx]) continue
              visited[npx] = 1
              queue[tail++] = npx
            }
          }
        }

        if (count > 0) {
          const bw = maxX - minX + 1
          const bh = maxY - minY + 1
          blobs.push({
            cx: Math.round(sumX / count),
            cy: Math.round(sumY / count),
            w: bw,
            h: bh,
            confidence: count / (bw * bh),
          })
        }
      }
    }
    return blobs
  }

  private areaFilter(blobs: BlobCandidate[], overrides?: Partial<BlobFinderConfig>): BlobCandidate[] {
    const cfg = { ...this.config, ...overrides }
    return blobs.filter(b => {
      const a = b.w * b.h
      return a >= cfg.minArea && a <= cfg.maxArea
    })
  }

  private mergeNearby(blobs: BlobCandidate[], maxGap: number): BlobCandidate[] {
    const used = new Set<number>()
    const merged: BlobCandidate[] = []

    const bboxOf = (b: BlobCandidate) => ({
      left: b.cx - Math.floor((b.w - 1) / 2),
      right: b.cx + Math.floor((b.w - 1) / 2),
      top: b.cy - Math.floor((b.h - 1) / 2),
      bottom: b.cy + Math.floor((b.h - 1) / 2),
    })

    const shouldMerge = (a: BlobCandidate, b: BlobCandidate) => {
      const ba = bboxOf(a), bb = bboxOf(b)
      const hGap = Math.max(0, Math.max(ba.left - bb.right, bb.left - ba.right))
      const vGap = Math.max(0, Math.max(ba.top - bb.bottom, bb.top - ba.bottom))
      return hGap <= maxGap && vGap <= maxGap
    }

    const unionBbox = (a: BlobCandidate, b: BlobCandidate) => {
      const ba = bboxOf(a), bb = bboxOf(b)
      const left = Math.min(ba.left, bb.left)
      const right = Math.max(ba.right, bb.right)
      const top = Math.min(ba.top, bb.top)
      const bottom = Math.max(ba.bottom, bb.bottom)
      return { cx: Math.round((left + right) / 2), cy: Math.round((top + bottom) / 2), w: right - left, h: bottom - top }
    }

    for (let i = 0; i < blobs.length; i++) {
      if (used.has(i)) continue
      let cur = { ...blobs[i] }
      used.add(i)

      let changed = true
      while (changed) {
        changed = false
        for (let j = i + 1; j < blobs.length; j++) {
          if (used.has(j)) continue
          if (shouldMerge(cur, blobs[j])) {
            const u = unionBbox(cur, blobs[j])
            cur = { cx: u.cx, cy: u.cy, w: u.w, h: u.h, confidence: Math.max(cur.confidence, blobs[j].confidence) }
            used.add(j)
            changed = true
          }
        }
      }

      merged.push(cur)
    }

    return merged
  }

  private measureExtent(cx: number, cy: number, thresh?: number): { w: number; h: number } {
    const peakVal = this.gray[cy * this.w + cx]
    const t = thresh ?? peakVal * 0.3
    let left = cx, right = cx, top = cy, bottom = cy
    const maxR = 30

    while (left > 0 && this.gray[cy * this.w + left] > t && cx - left < maxR) left--
    while (right < this.w - 1 && this.gray[cy * this.w + right] > t && right - cx < maxR) right++
    while (top > 0 && this.gray[top * this.w + cx] > t && cy - top < maxR) top--
    while (bottom < this.h - 1 && this.gray[bottom * this.w + cx] > t && bottom - cy < maxR) bottom--

    return { w: right - left + 1, h: bottom - top + 1 }
  }

  private nms(blobs: BlobCandidate[], nmsDistance?: number): BlobCandidate[] {
    if (blobs.length === 0) return []
    const sorted = blobs.sort((a, b) => b.confidence - a.confidence)
    const keep: BlobCandidate[] = []
    const minDist2 = (nmsDistance ?? this.config.nmsDistance) ** 2

    for (const blob of sorted) {
      let suppressed = false
      for (const k of keep) {
        if ((blob.cx - k.cx) ** 2 + (blob.cy - k.cy) ** 2 < minDist2) {
          suppressed = true
          break
        }
      }
      if (!suppressed) keep.push(blob)
    }
    return keep
  }

  private regionQuery(points: number[], idx: number, eps2: number): number[] {
    const px = points[idx] % this.w
    const py = (points[idx] - px) / this.w
    const neighbors: number[] = []
    for (let i = 0; i < points.length; i++) {
      const x = points[i] % this.w
      const y = (points[i] - x) / this.w
      if ((x - px) ** 2 + (y - py) ** 2 <= eps2) neighbors.push(i)
    }
    return neighbors
  }

  private gaussianBlurInto(out: Uint8Array, temp: Float32Array, src: Uint8Array, radius: number) {
    const size = radius * 2 + 1
    const kernel = new Float32Array(size)
    const sigma = radius / 2
    let kSum = 0
    for (let i = 0; i < size; i++) {
      const x = i - radius
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma))
      kSum += kernel[i]
    }
    for (let i = 0; i < size; i++) kernel[i] /= kSum

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let val = 0
        for (let k = -radius; k <= radius; k++) {
          const sx = Math.min(this.w - 1, Math.max(0, x + k))
          val += src[y * this.w + sx] * kernel[k + radius]
        }
        temp[y * this.w + x] = val
      }
    }
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let val = 0
        for (let k = -radius; k <= radius; k++) {
          const sy = Math.min(this.h - 1, Math.max(0, y + k))
          val += temp[sy * this.w + x] * kernel[k + radius]
        }
        out[y * this.w + x] = Math.round(val)
      }
    }
  }
}
