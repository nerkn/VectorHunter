import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { BlobTracker, TrackedBlob } from '../src/utils/blobTracker'

const dir = process.argv.find(a => a.startsWith('--dir='))?.slice(6) || 'docs/frames'
const cmd = process.argv[2] || ''

function readGray(filename: string) {
  const match = filename.match(/(\d+)x(\d+)\.gray$/)
  if (!match) { console.error(`Bad filename: ${filename}`); process.exit(1) }
  const w = parseInt(match[1]), h = parseInt(match[2])
  const buf = readFileSync(join(dir, filename))
  return { w, h, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) }
}

function loadRecording() {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  if (files.length === 0) { console.error('No recording.json found in', dir); process.exit(1) }
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf-8'))
}

function runTracker(threshold = 25, minArea = 4, maxArea = 256) {
  const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()
  if (files.length === 0) { console.error('No .gray files in', dir); process.exit(1) }
  const m = files[0].match(/(\d+)x(\d+)\.gray$/)!
  const w = parseInt(m[1]), h = parseInt(m[2])
  const tracker = new BlobTracker({ frameDt: 1 / 24 })
  const results: { frame: number; tracked: TrackedBlob[] }[] = []

  for (let i = 0; i < files.length; i++) {
    const { w, h, data } = readGray(files[i])
    tracker.setGrayImage(data, w, h, threshold)
    tracker.setAreaRange(minArea, maxArea)
    const tracked = tracker.update()
    results.push({ frame: i, tracked })
  }
  return { results, files }
}

// --- commands ---

function cmdCompare() {
  const rec = loadRecording()
  const { results } = runTracker()

  console.log('frame | rec d1 pos          | test tracked pos       | err')
  console.log('------+--------------------+------------------------+-----')

  for (let i = 0; i < results.length; i++) {
    const recD1 = rec.frames[i]?.tracked.find((t: any) => t.displayId === 1)
    const test = results[i].tracked.filter(t => t.displayId !== null).sort((a, b) => b.area - a.area)[0]

    const rs = recD1 ? `(${recD1.cx},${recD1.cy}) a=${recD1.area}` : '---'
    const ts = test ? `(${test.cx.toFixed(0)},${test.cy.toFixed(0)}) a=${test.area.toFixed(0)}` : '---'
    let err = '---'
    if (recD1 && test) {
      const d = Math.sqrt((test.cx - recD1.cx) ** 2 + (test.cy - recD1.cy) ** 2)
      err = d < 30 ? 'OK' : d.toFixed(0) + 'px'
    }
    console.log(`f${String(i).padStart(2)}   | ${rs.padEnd(19)}| ${ts.padEnd(23)}| ${err}`)
  }
}

function cmdLive() {
  const { results } = runTracker()
  for (const { frame, tracked } of results) {
    const withId = tracked.filter(t => t.displayId !== null)
    const big = tracked.sort((a, b) => b.area - a.area)[0]
    const parts = withId.map(t => `d${t.displayId}(#${t.internalId} ${t.cx.toFixed(0)},${t.cy.toFixed(0)} a=${t.area.toFixed(0)})`)
    const bigInfo = big ? `big=#${big.internalId} ${big.cx.toFixed(0)},${big.cy.toFixed(0)} a=${big.area.toFixed(0)} hRes=${big.highResidualFrames} d=${big.displayId ?? '-'}` : 'none'
    console.log(`f${frame}: ${parts.join(' ') || 'no displayId'} | ${bigInfo}`)
  }
}

function cmdTrace() {
  const { results } = runTracker()
  for (const { frame, tracked } of results) {
    const withId = tracked.filter(t => t.displayId !== null)
    for (const t of withId) {
      const speed = Math.sqrt(t.vx ** 2 + t.vy ** 2)
      console.log(`f${frame} d${t.displayId} #${t.internalId} pos=(${t.cx.toFixed(0)},${t.cy.toFixed(0)}) vel=(${t.vx.toFixed(0)},${t.vy.toFixed(0)}) speed=${speed.toFixed(0)} area=${t.area.toFixed(0)} miss=${t.missMs.toFixed(0)}ms seen=${t.framesSeen}`)
    }
  }
}

function cmdHelp() {
  console.log(`Usage: npx tsx scripts/test.ts <command> [--dir=path]

Commands:
  compare   Compare tracker output against recording JSON
  live      Run tracker on gray frames, show display IDs
  trace     Per-frame detail of all tracked objects

Prerequisites:
  - Gray frame images and recording JSON in docs/frames/
  - Use "SAVE ALL" in the playback UI to generate test data
`)
}

if (cmd === 'compare') cmdCompare()
else if (cmd === 'live') cmdLive()
else if (cmd === 'trace') cmdTrace()
else cmdHelp()
