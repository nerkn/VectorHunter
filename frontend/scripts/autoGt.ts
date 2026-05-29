import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BlobFinder } from '../src/utils/blobFinder'

const dir = process.argv[2]
if (!dir) { console.error('Usage: npx tsx scripts/autoGt.ts docs/frames/<session>'); process.exit(1) }

const rec = JSON.parse(readFileSync(join(dir, 'recording.json'), 'utf8'))
const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()
if (files.length === 0) { console.error('No .gray files'); process.exit(1) }
const wMatch = files[0].match(/(\d+)x(\d+)/)
const W = parseInt(wMatch![1]), H = parseInt(wMatch![2])

const bf = new BlobFinder()
const positions: { frame: number; cx: number; cy: number }[] = []

for (let i = 0; i < files.length; i++) {
  const data = new Uint8Array(readFileSync(join(dir, files[i])))
  bf.setGray(data, W, H)
  const blobs = bf.nearbyBlobMerge({ threshold: 25, mergeDistance: 2, nmsDistance: 15, minArea: 4, maxArea: 500 })
  const big = blobs.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a), { cx: 0, cy: 0, w: 0, h: 0, confidence: 0 })
  if (big.w * big.h > 20) {
    positions.push({ frame: i, cx: big.cx, cy: big.cy })
  }
}

if (positions.length < 3) {
  console.log('Too few positions found:', positions.length)
  process.exit(1)
}

const first = positions[0]
const last = positions[positions.length - 1]
const disp = Math.sqrt((last.cx - first.cx) ** 2 + (last.cy - first.cy) ** 2)
console.log(`Largest blob track: ${positions.length} frames, (${first.cx},${first.cy})→(${last.cx},${last.cy}) disp=${disp.toFixed(0)}px`)

if (disp < 10) {
  console.log('Displacement too small — no moving target detected')
  process.exit(1)
}

const gtFrames = positions.map(p => ({
  frame: p.frame,
  targets: [{ cx: p.cx, cy: p.cy }],
}))

rec.groundTruth = { frames: gtFrames }
writeFileSync(join(dir, 'recording.json'), JSON.stringify(rec, null, 2))
console.log(`Wrote ${gtFrames.length} GT frames to ${join(dir, 'recording.json')}`)
