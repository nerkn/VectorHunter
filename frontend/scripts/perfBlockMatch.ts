import { readFileSync } from 'fs'
import { join } from 'path'

function readGray(filename: string) {
  const match = filename.match(/(\d+)x(\d+)\.gray$/)
  const w = parseInt(match[1]), h = parseInt(match[2])
  const buf = readFileSync(join('docs/frames', filename))
  return { w, h, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) }
}

// Simulate block match: 8x8 ref, search 30x30 area
const f6 = readGray('frame_0006_640x480.gray')
const f7 = readGray('frame_0007_640x480.gray')

const blockSize = 8
const halfBlock = Math.floor(blockSize / 2)
const searchR = 30

// Extract 8x8 ref block from frame 6 at target (442, 230)
const refCx = 442, refCy = 230
const ref = new Uint8Array(blockSize * blockSize)
for (let dy = 0; dy < blockSize; dy++) {
  for (let dx = 0; dx < blockSize; dx++) {
    const px = refCx - halfBlock + dx
    const py = refCy - halfBlock + dy
    if (px >= 0 && px < f6.w && py >= 0 && py < f6.h)
      ref[dy * blockSize + dx] = f6.data[py * f6.w + px]
  }
}

console.log('8x8 ref block from (442,230) frame 6:')
console.log(`  bright pixels: ${Array.from(ref).filter(v => v > 25).length}/64`)

// Search frame 7 around predicted (440, 219) ± 30
const predX = 440, predY = 219
let brightCount = 0
let blockEvals = 0
let totalSADops = 0

let best = { x: 0, y: 0, sad: Infinity }

const t0 = performance.now()
for (let iter = 0; iter < 1000; iter++) {
  best = { x: 0, y: 0, sad: Infinity }
  for (let y = predY - searchR; y <= predY + searchR; y++) {
    for (let x = predX - searchR; x <= predX + searchR; x++) {
      if (x < 0 || x >= f7.w || y < 0 || y >= f7.h) continue
      if (f7.data[y * f7.w + x] <= 25) continue
      
      if (iter === 0) brightCount++
      
      let sad = 0
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const px = x - halfBlock + dx
          const py = y - halfBlock + dy
          let val = 0
          if (px >= 0 && px < f7.w && py >= 0 && py < f7.h)
            val = f7.data[py * f7.w + px]
          sad += Math.abs(ref[dy * blockSize + dx] - val)
        }
      }
      
      if (iter === 0) { blockEvals++; totalSADops += 64 }
      
      if (sad < best.sad) best = { x, y, sad }
    }
  }
}
const elapsed = performance.now() - t0

console.log(`\nSearch area ${searchR*2}x${searchR*2} = ${(searchR*2)**2} pixels`)
console.log(`Bright pixels (thr>25): ${brightCount}`)
console.log(`Block evals: ${blockEvals}`)
console.log(`SAD ops: ${totalSADops} (${totalSADops} additions)`)
console.log(`\nBest match: (${best.x}, ${best.y}) sad=${best.sad}`)
console.log(`Actual target: (425, 240) and (448, 241)`)
console.log(`\nPerf: ${(elapsed/1000).toFixed(3)}ms per frame (${(1000/elapsed*1000).toFixed(0)} fps)`)
