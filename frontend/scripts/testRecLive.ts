import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { BlobTracker } from '../src/utils/blobTracker'

const dir = 'docs/frames'
const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()
const m = files[0].match(/(\d+)x(\d+)\.gray$/)!
const w = parseInt(m[1]), h = parseInt(m[2])
const tracker = new BlobTracker({ frameDt: 1/16 })

for (const f of files) {
  const buf = readFileSync(join(dir, f))
  const gray = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  tracker.setGrayImage(gray, w, h, 25)
  tracker.setAreaRange(4, 256)
  const tracked = tracker.update()
  const fi = parseInt(f.match(/frame_(\d+)/)![1])
  
  const withId = tracked.filter(t => t.displayId !== null)
  const big = tracked.filter(t => t.area > 20).sort((a,b) => b.area - a.area)[0]
  
  const parts = withId.map(t => `d${t.displayId}(#${t.internalId} ${t.cx},${t.cy} a=${t.area} miss=${t.missMs.toFixed(0)}ms)`)
  const bigInfo = big ? `big=#${big.internalId} ${big.cx},${big.cy} a=${big.area} hRes=${big.highResidualFrames} d=${big.displayId ?? '-'}` : 'no big'
  console.log(`f${fi}: ${parts.join(' ') || 'no displayId'} | ${bigInfo}`)
}
