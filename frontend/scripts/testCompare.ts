import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { BlobTracker } from '../src/utils/blobTracker'

const dir = 'docs/frames'
const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()
const m = files[0].match(/(\d+)x(\d+)\.gray$/)!
const w = parseInt(m[1]), h = parseInt(m[2])

// Load recording for "ground truth" (what the live tracker produced)
const rec = JSON.parse(readFileSync('docs/frames/recording_1779794724310.json', 'utf-8'))

const tracker = new BlobTracker({ frameDt: 1/16 })

console.log('frame | live-rec d1 pos      | test tracked pos         | match?')
console.log('------+-----------------------+--------------------------+-------')

for (let i = 0; i < files.length; i++) {
  const f = files[i]
  const buf = readFileSync(join(dir, f))
  const gray = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  tracker.setGrayImage(gray, w, h, 25)
  tracker.setAreaRange(4, 256)
  const tracked = tracker.update()

  // Recording's d1
  const recFrame = rec.frames[i]
  const recD1 = recFrame.tracked.find((t: any) => t.displayId === 1)

  // Test's biggest tracked with displayId
  const testTracked = tracked.filter(t => t.displayId !== null).sort((a, b) => b.area - a.area)[0]

  const recStr = recD1 ? `(${recD1.cx},${recD1.cy}) a=${recD1.area}` : '---'
  const testStr = testTracked ? `(${testTracked.cx.toFixed(0)},${testTracked.cy.toFixed(0)}) a=${testTracked.area.toFixed(0)} d${testTracked.displayId}` : '---'

  let match = '---'
  if (recD1 && testTracked) {
    const err = Math.sqrt((testTracked.cx - recD1.cx) ** 2 + (testTracked.cy - recD1.cy) ** 2)
    match = err < 30 ? 'OK' : `err=${err.toFixed(0)}`
  }

  console.log(`f${String(i).padStart(2)}   | ${recStr.padEnd(22)}| ${testStr.padEnd(25)}| ${match}`)
}
