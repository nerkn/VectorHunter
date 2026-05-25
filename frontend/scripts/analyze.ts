import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join, parse } from 'path'

const dir = process.argv[2] || 'docs/frames'
const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()

if (files.length === 0) {
  console.log('No .gray files found in', dir)
  process.exit(1)
}

function readGray(filename: string): { w: number; h: number; data: Uint8Array } {
  const match = filename.match(/(\d+)x(\d+)\.gray$/)
  if (!match) {
    console.error(`Filename must contain WxH: ${filename}`)
    process.exit(1)
  }
  const w = parseInt(match[1])
  const h = parseInt(match[2])
  const buf = readFileSync(join(dir, filename))
  return { w, h, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) }
}

function threshold(gray: Uint8Array, t: number): Uint8Array {
  const out = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] > t ? 1 : 0
  return out
}

function floodFillAll(binary: Uint8Array, w: number, h: number, minArea: number) {
  const visited = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  const blobs: { cx: number; cy: number; area: number; minX: number; minY: number; maxX: number; maxY: number }[] = []

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = y * w + x
      if (visited[px] || !binary[px]) continue
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
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
            const npx = ny * w + nx
            if (visited[npx] || !binary[npx]) continue
            visited[npx] = 1
            queue[tail++] = npx
          }
        }
      }

      if (count >= minArea) {
        blobs.push({ cx: Math.round(sumX / count), cy: Math.round(sumY / count), area: count, minX, minY, maxX, maxY })
      }
    }
  }
  return blobs
}

function extractSliceH(gray: Uint8Array, w: number, h: number, cx: number, cy: number, halfW: number): number[] {
  const slice: number[] = []
  for (let i = -halfW; i <= halfW; i++) {
    const x = cx + i
    if (x < 0 || x >= w || cy < 0 || cy >= h) { slice.push(0); continue }
    slice.push(gray[cy * w + x])
  }
  return slice
}

function extractSliceV(gray: Uint8Array, w: number, h: number, cx: number, cy: number, halfH: number): number[] {
  const slice: number[] = []
  for (let i = -halfH; i <= halfH; i++) {
    const y = cy + i
    if (y < 0 || y >= h || cx < 0 || cx >= w) { slice.push(0); continue }
    slice.push(gray[y * w + cx])
  }
  return slice
}

function sliceSad(a: number[], b: number[]): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) sum += Math.abs(a[i] - b[i])
  return sum
}

function renderAscii(gray: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): string {
  const HEX = '0123456789ABCDEF'
  const lines: string[] = []
  for (let y = y0; y < y1; y++) {
    let row = ''
    for (let x = x0; x < x1; x++) {
      if (x < 0 || x >= w || y < 0 || y >= h) { row += '.'; continue }
      row += HEX[Math.min(15, gray[y * w + x] >> 4)]
    }
    lines.push(row)
  }
  return lines.join('\n')
}

const command = process.argv[3] || 'blobs'

if (command === 'blobs') {
  const thr = parseInt(process.argv[4]) || 25
  const minArea = parseInt(process.argv[5]) || 4

  for (const f of files) {
    const { w, h, data } = readGray(f)
    const bin = threshold(data, thr)
    const blobs = floodFillAll(bin, w, h, minArea)
    console.log(`\n${f} (${w}x${h}, thr=${thr}): ${blobs.length} blobs`)
    for (const b of blobs) {
      console.log(`  pos=${b.cx}x${b.cy} area=${b.area} bbox=[${b.minX},${b.minY},${b.maxX + 1},${b.maxY + 1}]`)
    }
  }
} else if (command === 'slice') {
  const cx = parseInt(process.argv[4]) || 0
  const cy = parseInt(process.argv[5]) || 0
  const halfW = parseInt(process.argv[6]) || 10
  const halfH = parseInt(process.argv[7]) || 3

  for (const f of files) {
    const { w, h, data } = readGray(f)
    const sH = extractSliceH(data, w, h, cx, cy, halfW)
    const sV = extractSliceV(data, w, h, cx, cy, halfH)
    console.log(`\n${f} slices at (${cx},${cy}) halfW=${halfW} halfH=${halfH}:`)
    console.log(`  H: [${sH.join(',')}]`)
    console.log(`  V: [${sV.join(',')}]`)
  }
} else if (command === 'match') {
  const cx = parseInt(process.argv[4]) || 0
  const cy = parseInt(process.argv[5]) || 0
  const halfW = parseInt(process.argv[6]) || 10
  const halfH = parseInt(process.argv[7]) || 3
  const radius = parseInt(process.argv[8]) || 30
  const thr = parseInt(process.argv[9]) || 25

  if (files.length < 2) {
    console.log('Need at least 2 .gray files for match')
    process.exit(1)
  }

  const ref = readGray(files[0])
  const refH = extractSliceH(ref.data, ref.w, ref.h, cx, cy, halfW)
  const refV = extractSliceV(ref.data, ref.w, ref.h, cx, cy, halfH)

  for (let fi = 1; fi < files.length; fi++) {
    const { w, h, data } = readGray(files[fi])
    const bin = threshold(data, thr)
    let bestScore = Infinity
    let bestX = cx, bestY = cy

    for (let y = Math.max(0, cy - radius); y < Math.min(h, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x < Math.min(w, cx + radius); x++) {
        if (!bin[y * w + x]) continue
        const cH = extractSliceH(data, w, h, x, y, halfW)
        const cV = extractSliceV(data, w, h, x, y, halfH)
        const score = sliceSad(refH, cH) + sliceSad(refV, cV)
        if (score < bestScore) { bestScore = score; bestX = x; bestY = y }
      }
    }

    const cH = extractSliceH(data, w, h, bestX, bestY, halfW)
    const cV = extractSliceV(data, w, h, bestX, bestY, halfH)
    console.log(`\n${files[fi]}: best=(${bestX},${bestY}) score=${bestScore}`)
    console.log(`  ref H: [${refH.join(',')}]`)
    console.log(`  cand H: [${cH.join(',')}]`)
    console.log(`  ref V: [${refV.join(',')}]`)
    console.log(`  cand V: [${cV.join(',')}]`)
  }
} else if (command === 'view') {
  const cx = parseInt(process.argv[4]) || 0
  const cy = parseInt(process.argv[5]) || 0
  const halfW = parseInt(process.argv[6]) || 15
  const halfH = parseInt(process.argv[7]) || 10

  for (const f of files) {
    const { w, h, data } = readGray(f)
    const x0 = Math.max(0, cx - halfW)
    const y0 = Math.max(0, cy - halfH)
    const x1 = Math.min(w, cx + halfW)
    const y1 = Math.min(h, cy + halfH)
    console.log(`\n${f} region (${x0},${y0})-(${x1},${y1}):`)
    console.log(renderAscii(data, w, h, x0, y0, x1, y1))
  }
} else if (command === 'stats') {
  for (const f of files) {
    const { w, h, data } = readGray(f)
    let max = 0, sum = 0, nonzero = 0
    for (let i = 0; i < data.length; i++) {
      if (data[i] > max) max = data[i]
      sum += data[i]
      if (data[i] > 0) nonzero++
    }
    console.log(`${f}: max=${max} avg=${(sum / data.length).toFixed(1)} nonzero=${nonzero}/${data.length} (${(nonzero / data.length * 100).toFixed(1)}%)`)
  }
} else {
  console.log(`Usage: npx tsx scripts/analyze.ts <dir> <command> [args...]
Commands:
  blobs [threshold=25] [minArea=4]    - find blobs in all frames
  slice <cx> <cy> [halfW=10] [halfH=3] - extract slices at position
  match <cx> <cy> [halfW=10] [halfH=3] [radius=30] [threshold=25] - slice match across frames
  view <cx> <cy> [halfW=15] [halfH=10] - ascii render region
  stats                              - per-frame statistics`)
}
