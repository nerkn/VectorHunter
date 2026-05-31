import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { deflateSync } from 'zlib'

const dir = process.argv[2] || 'docs/frames/2026-05-30T19-17-49'
const frameIdx = parseInt(process.argv[3] || '14')
const scale = 5

function readGray(filename: string) {
  const match = filename.match(/(\d+)x(\d+)\.gray$/)
  if (!match) { console.error('Bad filename:', filename); process.exit(1) }
  return { w: parseInt(match[1]), h: parseInt(match[2]), data: new Uint8Array(readFileSync(filename)) }
}

function getFrameFile(idx: number) {
  const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()
  return join(dir, files[idx])
}

function writeGrayPNG(path: string, data: Uint8Array, w: number, h: number, scale: number) {
  const sw = w * scale, sh = h * scale
  const raw = Buffer.alloc(sh * (1 + sw * 4))
  for (let y = 0; y < sh; y++) {
    raw[y * (1 + sw * 4)] = 0
    for (let x = 0; x < sw; x++) {
      const v = data[Math.floor(y / scale) * w + Math.floor(x / scale)]
      const off = y * (1 + sw * 4) + 1 + x * 4
      raw[off] = v; raw[off + 1] = v; raw[off + 2] = v; raw[off + 3] = 255
    }
  }
  const deflated = deflateSync(raw)
  const chunks: Buffer[] = []
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  chunks.push(sig)

  function crc32(buf: Buffer) {
    let c = 0xFFFFFFFF
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xEDB88320 ^ (v >>> 1) : v >>> 1; t[n] = v }
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }

  function chunk(type: string, data: Buffer) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const typeB = Buffer.from(type)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])))
    return Buffer.concat([len, typeB, data, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(sw, 0); ihdr.writeUInt32BE(sh, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  chunks.push(chunk('IHDR', ihdr))
  chunks.push(chunk('IDAT', deflated))
  chunks.push(chunk('IEND', Buffer.alloc(0)))
  writeFileSync(path, Buffer.concat(chunks))
}

function writeColorPNG(path: string, pixels: Uint8Array, w: number, h: number) {
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4
      const off = y * (1 + w * 4) + 1 + x * 4
      raw[off] = pixels[si]; raw[off + 1] = pixels[si + 1]; raw[off + 2] = pixels[si + 2]; raw[off + 3] = pixels[si + 3]
    }
  }
  const deflated = deflateSync(raw)

  function crc32(buf: Buffer) {
    let c = 0xFFFFFFFF
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xEDB88320 ^ (v >>> 1) : v >>> 1; t[n] = v }
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  function chunk(type: string, data: Buffer) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const typeB = Buffer.from(type)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])))
    return Buffer.concat([len, typeB, data, crc])
  }

  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  chunks.push(chunk('IHDR', ihdr))
  chunks.push(chunk('IDAT', deflated))
  chunks.push(chunk('IEND', Buffer.alloc(0)))
  writeFileSync(path, Buffer.concat(chunks))
}

function computeSAD(
  snap: Uint8Array, snapW: number, snapH: number,
  gray: Uint8Array, imgW: number, imgH: number,
  cx: number, cy: number
): number {
  const hw = Math.floor(snapW / 2)
  const hh = Math.floor(snapH / 2)
  let sad = 0, count = 0
  for (let dy = 0; dy < snapH; dy++) {
    for (let dx = 0; dx < snapW; dx++) {
      const fx = Math.round(cx) - hw + dx
      const fy = Math.round(cy) - hh + dy
      if (fx < 0 || fx >= imgW || fy < 0 || fy >= imgH) continue
      sad += Math.abs(gray[fy * imgW + fx] - snap[dy * snapW + dx])
      count++
    }
  }
  return count > 0 ? sad / count : 255
}

function computeShiftAdd(
  snap: Uint8Array, snapW: number, snapH: number,
  gray: Uint8Array, imgW: number, imgH: number,
  cx: number, cy: number
): number {
  const hw = Math.floor(snapW / 2)
  const hh = Math.floor(snapH / 2)
  let total = 0, count = 0
  for (let dy = 0; dy < snapH; dy++) {
    for (let dx = 0; dx < snapW; dx++) {
      const fx = Math.round(cx) - hw + dx
      const fy = Math.round(cy) - hh + dy
      if (fx < 0 || fx >= imgW || fy < 0 || fy >= imgH) continue
      total += (gray[fy * imgW + fx] + snap[dy * snapW + dx]) >> 1
      count++
    }
  }
  return count > 0 ? total / count : 0
}

function computeClampAdd(
  snap: Uint8Array, snapW: number, snapH: number,
  gray: Uint8Array, imgW: number, imgH: number,
  cx: number, cy: number
): number {
  const hw = Math.floor(snapW / 2)
  const hh = Math.floor(snapH / 2)
  let total = 0, count = 0
  for (let dy = 0; dy < snapH; dy++) {
    for (let dx = 0; dx < snapW; dx++) {
      const fx = Math.round(cx) - hw + dx
      const fy = Math.round(cy) - hh + dy
      if (fx < 0 || fx >= imgW || fy < 0 || fy >= imgH) continue
      total += Math.min(gray[fy * imgW + fx] + snap[dy * snapW + dx], 256)
      count++
    }
  }
  return count > 0 ? total / count : 256
}

function main() {
  const rec = JSON.parse(readFileSync(join(dir, 'recording.json'), 'utf-8'))
  const { w: imgW, h: imgH, data: gray } = readGray(getFrameFile(frameIdx))

  const recFrame = rec.frames[frameIdx]
  if (!recFrame) { console.error('No recording frame', frameIdx); process.exit(1) }
  const target = recFrame.tracked.find((t: any) => t.displayId === 1)
  if (!target) { console.error('No displayId=1 in frame', frameIdx); process.exit(1) }
  const prevFrame = rec.frames[frameIdx - 1]
  if (!prevFrame) { console.error('No previous frame'); process.exit(1) }
  const prevTarget = prevFrame.tracked.find((t: any) => t.displayId === 1)
  if (!prevTarget) { console.error('No displayId=1 in prev frame'); process.exit(1) }

  console.log(`Frame ${frameIdx}: target at (${target.cx}, ${target.cy}) area=${target.area} vx=${target.vx.toFixed(0)} vy=${target.vy.toFixed(0)}`)
  console.log(`Prev: (${prevTarget.cx}, ${prevTarget.cy}) area=${prevTarget.area} vx=${prevTarget.vx.toFixed(0)} vy=${prevTarget.vy.toFixed(0)}`)

  const blockObj = target.refBlock
  const snapW = target.refBlockW
  const snapH = target.refBlockH
  const snap = new Uint8Array(snapW * snapH)
  for (let i = 0; i < snapW * snapH; i++) snap[i] = blockObj[String(i)] || 0
  console.log(`Snapshot: ${snapW}x${snapH}`)

  const dt = 1 / 16
  const predCx = prevTarget.cx + prevTarget.vx * dt
  const predCy = prevTarget.cy + prevTarget.vy * dt
  const R = 40
  const hw = Math.floor(snapW / 2)
  const hh = Math.floor(snapH / 2)

  console.log(`Predicted: (${predCx.toFixed(1)}, ${predCy.toFixed(1)})`)
  console.log(`Actual: (${target.cx}, ${target.cy})`)

  // 1. Snapshot PNG
  writeGrayPNG(join(dir, `sad_f${frameIdx}_snapshot.png`), snap, snapW, snapH, scale)
  console.log(`Wrote snapshot PNG`)

  // 2. Search area from frame
  const areaW = snapW + 2 * R
  const areaH = snapH + 2 * R
  const areaData = new Uint8Array(areaW * areaH)
  for (let dy = 0; dy < areaH; dy++) {
    for (let dx = 0; dx < areaW; dx++) {
      const fx = Math.round(predCx) - R - hw + dx
      const fy = Math.round(predCy) - R - hh + dy
      if (fx >= 0 && fx < imgW && fy >= 0 && fy < imgH)
        areaData[dy * areaW + dx] = gray[fy * imgW + fx]
    }
  }
  writeGrayPNG(join(dir, `sad_f${frameIdx}_searcharea.png`), areaData, areaW, areaH, scale)
  console.log(`Wrote search area PNG (${areaW}x${areaH})`)

  // 3. Compute both SAD and ClampAdd heatmaps
  const step = 2
  const gridW = Math.floor(2 * R / step) + 1
  const gridH = Math.floor(2 * R / step) + 1
  const sadGrid = new Float32Array(gridW * gridH)
  const saGrid = new Float32Array(gridW * gridH)
  let minSad = Infinity, minSadOx = 0, minSadOy = 0
  let maxSa = -Infinity, maxSaOx = 0, maxSaOy = 0

  for (let gy = 0; gy < gridH; gy++) {
    const oy = -R + gy * step
    for (let gx = 0; gx < gridW; gx++) {
      const ox = -R + gx * step
      const sad = computeSAD(snap, snapW, snapH, gray, imgW, imgH, predCx + ox, predCy + oy)
      const sa = computeShiftAdd(snap, snapW, snapH, gray, imgW, imgH, predCx + ox, predCy + oy)
      sadGrid[gy * gridW + gx] = sad
      saGrid[gy * gridW + gx] = sa
      if (sad < minSad) { minSad = sad; minSadOx = ox; minSadOy = oy }
      if (sa > maxSa) { maxSa = sa; maxSaOx = ox; maxSaOy = oy }
    }
  }

  const actualOx = target.cx - predCx
  const actualOy = target.cy - predCy
  const actualSad = computeSAD(snap, snapW, snapH, gray, imgW, imgH, target.cx, target.cy)
  const actualSa = computeShiftAdd(snap, snapW, snapH, gray, imgW, imgH, target.cx, target.cy)

  console.log(`\nSAD  min: ${minSad.toFixed(1)} at (${minSadOx}, ${minSadOy}) | actual: ${actualSad.toFixed(1)} at (${actualOx.toFixed(1)}, ${actualOy.toFixed(1)})`)
  console.log(`SHIFT-ADD max: ${maxSa.toFixed(1)} at (${maxSaOx}, ${maxSaOy}) | actual: ${actualSa.toFixed(1)} at (${actualOx.toFixed(1)}, ${actualOy.toFixed(1)})`)

  // Render side-by-side: SAD on left, ClampAdd on right
  // Layout: SAD | gap | SHIFT-ADD | gap | SEARCH-AREA (auto-scaled to grid height)
  const hs = 4
  const halfW = gridW * hs
  const gap = 10
  // Scale search area to match heatmap height
  const areaScale = Math.max(1, Math.floor((gridH * hs) / areaH))
  const areaRenderW = areaW * areaScale
  const areaRenderH = areaH * areaScale
  const totalH = gridH * hs
  const totalW = halfW + gap + halfW + gap + areaRenderW
  const heatPixels = new Uint8Array(totalW * totalH * 4)
  heatPixels.fill(20)

  function renderHeatmap(grid: Float32Array, offsetX: number, lo: number, hi: number) {
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const v = grid[gy * gridW + gx]
        const t = Math.min(Math.max((v - lo) / (hi - lo), 0), 1)
        let r: number, g: number, b: number
        if (t < 0.33) { r = 0; g = Math.round(255 * t * 3); b = 255 }
        else if (t < 0.66) { const u = (t - 0.33) * 3; r = 0; g = 255; b = Math.round(255 * (1 - u)) }
        else { const u = (t - 0.66) * 3; r = Math.round(255 * u); g = Math.round(255 * (1 - u)); b = 0 }

        for (let sy = 0; sy < hs; sy++) {
          for (let sx = 0; sx < hs; sx++) {
            const px = offsetX + gx * hs + sx
            const py = gy * hs + sy
            const pi = (py * totalW + px) * 4
            heatPixels[pi] = r; heatPixels[pi + 1] = g; heatPixels[pi + 2] = b; heatPixels[pi + 3] = 255
          }
        }
      }
    }
  }

  // Render search area into third panel (raw grayscale, boosted)
  const areaOffX = halfW + gap + halfW + gap
  for (let y = 0; y < areaRenderH; y++) {
    for (let x = 0; x < areaRenderW; x++) {
      const srcX = Math.floor(x / areaScale)
      const srcY = Math.floor(y / areaScale)
      const v = Math.min(255, areaData[srcY * areaW + srcX] * 3) // boost 3x for visibility
      const pi = (y * totalW + areaOffX + x) * 4
      heatPixels[pi] = v; heatPixels[pi + 1] = v; heatPixels[pi + 2] = v; heatPixels[pi + 3] = 255
    }
  }

  // Draw crosshairs in search area
  function drawCross(cx: number, cy: number, r: number, g: number, b: number, size: number) {
    for (let d = -size; d <= size; d++) {
      // horizontal
      const hx = cx + d, hy = cy
      if (hx >= 0 && hx < areaRenderW && hy >= 0 && hy < areaRenderH) {
        const pi = (hy * totalW + areaOffX + hx) * 4
        heatPixels[pi] = r; heatPixels[pi + 1] = g; heatPixels[pi + 2] = b; heatPixels[pi + 3] = 255
      }
      // vertical
      const vx = cx, vy = cy + d
      if (vx >= 0 && vx < areaRenderW && vy >= 0 && vy < areaRenderH) {
        const pi = (vy * totalW + areaOffX + vx) * 4
        heatPixels[pi] = r; heatPixels[pi + 1] = g; heatPixels[pi + 2] = b; heatPixels[pi + 3] = 255
      }
    }
  }

  const sz = Math.max(8, Math.round(areaScale * 4))
  // Yellow cross = actual target (from recording)
  drawCross(Math.round((actualOx + R) * areaScale), Math.round((actualOy + R) * areaScale), 255, 255, 0, sz)
  // White cross = SAD best
  drawCross(Math.round((minSadOx + R) * areaScale), Math.round((minSadOy + R) * areaScale), 255, 255, 255, sz)
  // Green cross = ShiftAdd best (raw)
  drawCross(Math.round((maxSaOx + R) * areaScale), Math.round((maxSaOy + R) * areaScale), 0, 255, 0, sz)
  // Cyan cross = ShiftAdd corrected (best + snapW/2, snapH/2)
  const corrOx = maxSaOx + snapW / 2
  const corrOy = maxSaOy + snapH / 2
  drawCross(Math.round((corrOx + R) * areaScale), Math.round((corrOy + R) * areaScale), 0, 255, 255, sz)

  // Auto-range heatmaps using actual min/max of data
  const sadMin = sadGrid.reduce((a, b) => a < b ? a : b, Infinity)
  const sadMax = sadGrid.reduce((a, b) => a > b ? a : b, -Infinity)
  const saGridMin = saGrid.reduce((a, b) => a < b ? a : b, Infinity)
  const saGridMax = saGrid.reduce((a, b) => a > b ? a : b, -Infinity)

  renderHeatmap(sadGrid, 0, sadMin, sadMax)
  renderHeatmap(saGrid, halfW + gap, saGridMin, saGridMax)

  function markCell(gx: number, gy: number, offsetX: number, r: number, g: number, b: number) {
    if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) return
    for (let sy = 0; sy < hs; sy++) for (let sx = 0; sx < hs; sx++) {
      const px = offsetX + gx * hs + sx
      const py = gy * hs + sy
      const pi = (py * totalW + px) * 4
      heatPixels[pi] = r; heatPixels[pi + 1] = g; heatPixels[pi + 2] = b; heatPixels[pi + 3] = 255
    }
  }

  markCell(Math.round((minSadOx + R) / step), Math.round((minSadOy + R) / step), 0, 255, 255, 255)
  markCell(Math.round((actualOx + R) / step), Math.round((actualOy + R) / step), 0, 255, 255, 0)

  markCell(Math.round((maxSaOx + R) / step), Math.round((maxSaOy + R) / step), halfW + gap, 255, 255, 255)
  markCell(Math.round((actualOx + R) / step), Math.round((actualOy + R) / step), halfW + gap, 255, 255, 0)

  writeColorPNG(join(dir, `sad_f${frameIdx}_heatmap.png`), heatPixels, totalW, totalH)
  console.log(`Wrote heatmap (${totalW}x${totalH})`)
  console.log(`  LEFT=SAD(min) white=best yellow=actual`)
  console.log(`  MID=SHIFT-ADD(max) white=best yellow=actual`)
  console.log(`  RIGHT=SEARCH-AREA yellow=actual white=SAD-best green=SA-best cyan=SA-corrected(+snapW/2,+snapH/2)`)
  console.log(`  SAD range: ${sadMin.toFixed(1)} .. ${sadMax.toFixed(1)} delta=${(sadMax - sadMin).toFixed(1)}`)
  console.log(`  SA  range: ${saGridMin.toFixed(1)} .. ${saGridMax.toFixed(1)} delta=${(saGridMax - saGridMin).toFixed(1)}`)

  // 4. Print both grids (center crop for readability)
  const crop = 8
  const cg0 = Math.max(0, Math.floor(gridW / 2) - crop)
  const cg1 = Math.min(gridW, Math.floor(gridW / 2) + crop + 1)
  const rg0 = Math.max(0, Math.floor(gridH / 2) - crop)
  const rg1 = Math.min(gridH, Math.floor(gridH / 2) + crop + 1)

  console.log(`\nCenter crop of grids (±${crop * step}px):`)
  console.log(`\nSAD:`)
  for (let gy = rg0; gy < rg1; gy++) {
    const row: string[] = []
    for (let gx = cg0; gx < cg1; gx++) row.push(sadGrid[gy * gridW + gx].toFixed(1).padStart(5))
    console.log(`  oy=${(-R + gy * step).toString().padStart(3)}: ${row.join('')}`)
  }
  console.log(`  ox: ${Array.from({ length: cg1 - cg0 }, (_, i) => (-R + (cg0 + i) * step).toString().padStart(5)).join('')}`)

  console.log(`\nSHIFT-ADD:`)
  for (let gy = rg0; gy < rg1; gy++) {
    const row: string[] = []
    for (let gx = cg0; gx < cg1; gx++) row.push(saGrid[gy * gridW + gx].toFixed(1).padStart(5))
    console.log(`  oy=${(-R + gy * step).toString().padStart(3)}: ${row.join('')}`)
  }
  console.log(`  ox: ${Array.from({ length: cg1 - cg0 }, (_, i) => (-R + (cg0 + i) * step).toString().padStart(5)).join('')}`)
}

main()
