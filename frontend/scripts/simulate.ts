import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { BlobTracker, TrackedBlob } from '../src/utils/blobTracker'

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

const threshold = 25
const tracker = new BlobTracker({
  searchRadius: 30,
  minArea: 8,
  maxArea: 256,
  frameDt: 1 / 24,
  maxNoiseObjects: 15,
  residualThreshold: 25,
  demotionFrames: 10,
  jerkDemotionFrames: 10,
  jerkThreshold: 120,
  velocitySmoothing: 0.5,
  maxMissingMs: 300,
})

let movingBlobTrail: { frame: number; cx: number; cy: number; area: number; displayId: number | null; id: number }[] = []

for (let fi = 0; fi < files.length; fi++) {
  const { w, h, data } = readGray(files[fi])
  tracker.setGrayImage(data, w, h, threshold)
  const result = tracker.update()

  if (fi === 0) {
    const bigBlobs = result.filter(t => t.area >= 30)
    for (const b of bigBlobs) b._debug = false
  }

  const targets = result.filter(t => t.displayId !== null)
  const noise = result.filter(t => t.displayId === null)
  const moving = result.filter(t => {
    const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy)
    return speed > 50 && t.area >= 15
  })

  console.log(`\n=== Frame ${fi} (${files[fi]}) ===`)
  console.log(`  total=${result.length} targets=${targets.length} noise=${noise.length} moving(area>=15,speed>50)=${moving.length}`)

  if (targets.length > 0) {
    for (const t of targets) {
      const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy)
      console.log(`  TARGET id=${t.internalId} display=${t.displayId} pos=(${t.cx},${t.cy}) vel=(${t.vx.toFixed(0)},${t.vy.toFixed(0)}) speed=${speed.toFixed(0)} area=${t.area} hrf=${t.highResidualFrames} lrf=${t.lowResidualFrames} miss=${t.missMs.toFixed(0)} fs=${t.framesSeen} avgA=${t.avgArea.toFixed(0)}`)
    }
  }

  for (const t of noise) {
    const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy)
    if (t.area >= 10 || speed > 20) {
      console.log(`  NOISE id=${t.internalId} pos=(${t.cx},${t.cy}) vel=(${t.vx.toFixed(0)},${t.vy.toFixed(0)}) speed=${speed.toFixed(0)} area=${t.area} hrf=${t.highResidualFrames} lrf=${t.lowResidualFrames} miss=${t.missMs.toFixed(0)} fs=${t.framesSeen}`)
    }
  }

  for (const t of moving) {
    movingBlobTrail.push({ frame: fi, cx: t.cx, cy: t.cy, area: t.area, displayId: t.displayId, id: t.internalId })
  }

  const droneTrackId = movingBlobTrail.length > 0 ? movingBlobTrail[movingBlobTrail.length - 1].id : null
  const drone = droneTrackId != null ? result.find(t => t.internalId === droneTrackId) : undefined
  if (drone && fi > 0) {
    const dt = 1 / 24
    const predCx = drone.cx
    const predCy = drone.cy
    const [bx0, by0, bx1, by1] = drone.bbox
    const halfW = Math.max(8, Math.round((bx1 - bx0) / 2))
    const halfH = Math.max(5, Math.round((by1 - by0) / 2))
    const grid = tracker.findSliceMatchGrid(predCx, predCy, 30, halfW, halfH, drone)
    const top20 = grid.slice(0, 20)
    console.log(`  GRID for id=${drone.internalId} cur=(${drone.cx},${drone.cy}) vel=(${drone.vx.toFixed(0)},${drone.vy.toFixed(0)}) halfW=${halfW} halfH=${halfH} candidates=${grid.length}`)
    const validGrid = grid.filter(g => g.blockSad >= 0)
    const minSlice = validGrid.length > 0 ? validGrid.reduce((m, g) => Math.min(m, g.sliceScore), Infinity) : 0
    const maxSlice = validGrid.length > 0 ? validGrid.reduce((m, g) => Math.max(m, g.sliceScore), 0) : 1
    const minBlock = validGrid.length > 0 ? validGrid.reduce((m, g) => Math.min(m, g.blockSad), Infinity) : 0
    const maxBlock = validGrid.length > 0 ? validGrid.reduce((m, g) => Math.max(m, g.blockSad), 0) : 1
    const sliceRange = maxSlice - minSlice || 1
    const blockRange = maxBlock - minBlock || 1
    const scored = validGrid.map(g => {
      const dx = g.x - predCx
      const dy = g.y - predCy
      const dist = Math.sqrt(dx * dx + dy * dy)
      return {
        ...g,
        dist,
        score: (g.sliceScore - minSlice) / sliceRange + (g.blockSad - minBlock) / blockRange + dist / 42
      }
    }).sort((a, b) => a.score - b.score)
    for (const g of scored.slice(0, 20)) {
      const dx = g.x - predCx
      const dy = g.y - predCy
      console.log(`    (${g.x},${g.y}) d=(${dx >= 0 ? '+' : ''}${dx},${dy >= 0 ? '+' : ''}${dy}) dist=${g.dist.toFixed(1)} score=${g.score.toFixed(2)} slice=${g.sliceScore} block=${g.blockSad}`)
    }
  }
}

console.log('\n\n=== MOVING BLOB TRAIL ===')
for (const p of movingBlobTrail) {
  const tag = p.displayId !== null ? `T${p.displayId}` : 'NOISE'
  console.log(`  f${p.frame}: id=${p.id} ${tag} pos=(${p.cx},${p.cy}) area=${p.area}`)
}

console.log('\n\n=== FINAL STATE ===')
const final = tracker.getTracked()
for (const t of final) {
  const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy)
  const tag = t.displayId !== null ? `T${t.displayId}` : 'NOISE'
  console.log(`  ${tag} id=${t.internalId} pos=(${t.cx},${t.cy}) vel=(${t.vx.toFixed(0)},${t.vy.toFixed(0)}) speed=${speed.toFixed(0)} area=${t.area} hrf=${t.highResidualFrames} lrf=${t.lowResidualFrames} miss=${t.missMs.toFixed(0)} fs=${t.framesSeen} born=${t.born.toFixed(0)}`)
}
