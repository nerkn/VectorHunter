import { BlobFinder, BlobCandidate } from './src/utils/blobFinder'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'

function readPNG(filePath: string): { pixels: Uint8Array; w: number; h: number } {
  const buf = fs.readFileSync(filePath)
  let w = 0, h = 0
  const chunks: Buffer[] = []
  let offset = 8
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)
    offset += 12 + len
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) }
    else if (type === 'IDAT') chunks.push(data)
    else if (type === 'IEND') break
  }
  const compressed = Buffer.concat(chunks)
  const raw = zlib.inflateSync(compressed)
  const pixels = new Uint8Array(w * h * 4)
  const bpp = 4, stride = w * bpp
  let srcOff = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[srcOff++]
    const rowStart = y * stride
    for (let x = 0; x < stride; x++) {
      let val = raw[srcOff++]
      if (filter === 1 && x >= bpp) val = (val + pixels[rowStart + x - bpp]) & 0xff
      else if (filter === 2 && y > 0) val = (val + pixels[rowStart + x - stride]) & 0xff
      else if (filter === 3) {
        const a = x >= bpp ? pixels[rowStart + x - bpp] : 0
        const b = y > 0 ? pixels[rowStart + x - stride] : 0
        val = (val + Math.floor((a + b) / 2)) & 0xff
      } else if (filter === 4) {
        const a = x >= bpp ? pixels[rowStart + x - bpp] : 0
        const b = y > 0 ? pixels[rowStart + x - stride] : 0
        const c = x >= bpp && y > 0 ? pixels[rowStart + x - bpp - stride] : 0
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        val = (val + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      pixels[rowStart + x] = val
    }
  }
  return { pixels, w, h }
}

function setPixel(buf: Uint8Array, w: number, x: number, y: number, r: number, g: number, b: number) {
  const i = (y * w + x) * 4
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b
}

function drawRects(srcPixels: Uint8Array, w: number, h: number, blobs: BlobCandidate[]): Uint8Array {
  const out = new Uint8Array(srcPixels)
  for (const b of blobs) {
    const x0 = Math.max(0, b.cx - Math.floor(b.w / 2))
    const y0 = Math.max(0, b.cy - Math.floor(b.h / 2))
    const x1 = Math.min(w - 1, b.cx + Math.floor(b.w / 2))
    const y1 = Math.min(h - 1, b.cy + Math.floor(b.h / 2))
    for (let x = x0; x <= x1; x++) { setPixel(out, w, x, y0, 0, 255, 0); setPixel(out, w, x, y1, 0, 255, 0) }
    for (let y = y0; y <= y1; y++) { setPixel(out, w, x0, y, 0, 255, 0); setPixel(out, w, x1, y, 0, 255, 0) }
    for (let d = -3; d <= 3; d++) { setPixel(out, w, b.cx + d, b.cy, 255, 0, 0); setPixel(out, w, b.cx, b.cy + d, 255, 0, 0) }
  }
  return out
}

function writePNG(filePath: string, pixels: Uint8Array, w: number, h: number) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4, di = y * (1 + w * 3) + 1 + x * 3
      raw[di] = pixels[si]; raw[di + 1] = pixels[si + 1]; raw[di + 2] = pixels[si + 2]
    }
  }
  const compressed = zlib.deflateSync(raw)
  const chunks: Buffer[] = [signature]
  chunks.push(makeChunk('IHDR', ihdr))
  chunks.push(makeChunk('IDAT', compressed))
  chunks.push(makeChunk('IEND', Buffer.alloc(0)))
  fs.writeFileSync(filePath, Buffer.concat(chunks))
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typeB = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([typeB, data])
  const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc32(crcData) >>> 0, 0)
  return Buffer.concat([len, typeB, data, crcB])
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) { crc ^= buf[i]; for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1 }
  return crc ^ 0xffffffff
}

const imgPath = process.argv[2]
if (!imgPath) { console.error('Usage: npx tsx finderEval.ts <image.png>'); process.exit(1) }

const { pixels, w, h } = readPNG(path.resolve(imgPath))
const finder = new BlobFinder({ minArea: 4, maxArea: 256 })
finder.setImage(pixels, w, h)

interface Run { name: string; fn: () => BlobCandidate[] }
const runs: Run[] = [
  { name: 'dilateAndFloodFill_default', fn: () => finder.dilateAndFloodFill() },
  { name: 'dilateAndFloodFill_tuned', fn: () => finder.dilateAndFloodFill({ threshold: 15, dilateRadius: 2, nmsDistance: 15 }) },

  { name: 'hysteresisThreshold_default', fn: () => finder.hysteresisThreshold() },
  { name: 'hysteresisThreshold_tuned', fn: () => finder.hysteresisThreshold({ hysteresisLow: 10, hysteresisHigh: 25, nmsDistance: 20 }) },

  { name: 'nearbyBlobMerge_default', fn: () => finder.nearbyBlobMerge() },
  { name: 'nearbyBlobMerge_tuned', fn: () => finder.nearbyBlobMerge({ threshold: 15, mergeDistance: 8, nmsDistance: 15 }) },

  { name: 'dbscan_default', fn: () => finder.dbscan() },
  { name: 'dbscan_tuned', fn: () => finder.dbscan({ threshold: 15, dbscanEps: 5, dbscanMinPts: 3, nmsDistance: 15 }) },

  { name: 'gaussianBlurPeak_default', fn: () => finder.gaussianBlurPeak() },
  { name: 'gaussianBlurPeak_tuned', fn: () => finder.gaussianBlurPeak({ threshold: 15, blurRadius: 3, peakMinDistance: 5, nmsDistance: 10 }) },

  { name: 'integralImage_default', fn: () => finder.integralImage() },
  { name: 'integralImage_tuned', fn: () => finder.integralImage({ integralWindowSize: 15, projectionThreshold: 20, nmsDistance: 15 }) },

  { name: 'projection_default', fn: () => finder.projection() },
  { name: 'projection_tuned', fn: () => finder.projection({ projectionThreshold: 20, threshold: 15, nmsDistance: 15 }) },

  { name: 'maxPooling_default', fn: () => finder.maxPooling() },
  { name: 'maxPooling_tuned', fn: () => finder.maxPooling({ poolSize: 4, threshold: 15, nmsDistance: 10 }) },
]

const results: Record<string, BlobCandidate[]> = {}
const rows: { name: string; ms: number; count: number }[] = []

for (const r of runs) {
  const t0 = performance.now()
  const blobs = r.fn()
  const ms = performance.now() - t0
  results[r.name] = blobs
  rows.push({ name: r.name, ms: Math.round(ms * 100) / 100, count: blobs.length })
}

console.log()
console.log(`Image: ${w}x${h}  Auto-threshold: ${finder.getAutoThreshold().toFixed(1)}`)

const nameW = 34
const msW = 8
const countW = 7
const sep = '| ' + '-'.repeat(nameW) + ' | ' + '-'.repeat(msW) + ' | ' + '-'.repeat(countW) + ' |'
console.log(sep)
console.log('| ' + 'Method'.padEnd(nameW) + ' | ' + 'ms'.padStart(msW) + ' | ' + 'Pts'.padStart(countW) + ' |')
console.log(sep)
for (const r of rows) {
  console.log('| ' + r.name.padEnd(nameW) + ' | ' + r.ms.toFixed(2).padStart(msW) + ' | ' + String(r.count).padStart(countW) + ' |')
}
console.log(sep)

const dir = path.dirname(path.resolve(imgPath))
const baseName = path.basename(imgPath, path.extname(imgPath))

const outFile = path.join(dir, 'finderEvalResults.json')
fs.writeFileSync(outFile, JSON.stringify(results, null, 2))
console.log(`\nResults: ${outFile}`)

console.log('\nWriting images...')
for (const r of runs) {
  const annotated = drawRects(pixels, w, h, results[r.name])
  const outPath = path.join(dir, `${baseName}_${r.name}.png`)
  writePNG(outPath, annotated, w, h)
}
console.log(`Done. ${runs.length} images in ${dir}/`)
