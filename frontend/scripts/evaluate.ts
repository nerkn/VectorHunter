import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { BlobFinder } from '../src/utils/blobFinder'
import { FlowTracker } from '../src/strategy/FlowTracker'
import { HybridTracker } from '../src/strategy/HybridTracker'
import { DriftTracker } from '../src/strategy/DriftTracker'
import { WrappedBlobTracker } from '../src/strategy/WrappedBlobTracker'
import { DetectionStrategy, StrategyResult } from '../src/strategy/types'

const dir = process.argv.find(a => a.startsWith('--dir='))?.slice(6) || 'docs/frames'

function readGray(filename: string) {
  const match = filename.match(/(\d+)x(\d+)\.gray$/)!
  const w = parseInt(match[1]), h = parseInt(match[2])
  return { w, h, data: new Uint8Array(readFileSync(join(dir, filename))) }
}

function loadRecording() {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  const pick = files.includes('recording.json') ? 'recording.json' : files[files.length - 1]
  return JSON.parse(readFileSync(join(dir, pick), 'utf-8'))
}

function cmdQ1() {
  const rec = loadRecording()
  const gt = new Map((rec.groundTruth?.frames || []).map((f: any) => [f.frame, f.targets[0]]))
  const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()
  const bf = new BlobFinder()
  const thresholds = [15, 20, 25, 30, 35]

  console.log('=== Q1: Blob Detection Accuracy ===\n')

  for (const thr of thresholds) {
    let gtHits = 0
    let totalBlobs = 0
    let gtFrames = 0

    for (let i = 0; i < files.length; i++) {
      const { w, h, data } = readGray(files[i])
      bf.setGray(data, w, h)
      const blobs = bf.nearbyBlobMerge({ threshold: thr, mergeDistance: 2, nmsDistance: 15, minArea: 4, maxArea: 256 })
      totalBlobs += blobs.length

      const gtPt = gt.get(i)
      if (gtPt) {
        gtFrames++
        let bestD = Infinity
        for (const b of blobs) {
          const d = Math.sqrt((b.cx - gtPt.cx) ** 2 + (b.cy - gtPt.cy) ** 2)
          if (d < bestD) bestD = d
        }
        if (bestD < 15) gtHits++
      }
    }

    const avgBlobs = (totalBlobs / files.length).toFixed(1)
    console.log(`thr=${thr}: GT hit ${gtHits}/${gtFrames} | avg blobs/frame: ${avgBlobs}`)
  }

  console.log('\nPer-frame detail (thr=25):')
  console.log('frame | GT pos      | blobs | nearest         | dist  | top5 blobs')
  console.log('------+-------------+-------+-----------------+-------+------------------------------------------')

  for (let i = 0; i < files.length; i++) {
    const { w, h, data } = readGray(files[i])
    bf.setGray(data, w, h)
    const blobs = bf.nearbyBlobMerge({ threshold: 25, mergeDistance: 2, nmsDistance: 15, minArea: 4, maxArea: 256 })
    const gtPt = gt.get(i)

    const gtStr = gtPt ? `(${gtPt.cx},${gtPt.cy})` : '---'

    let nearest = '---'
    let dist = '---'
    if (gtPt) {
      let bestD = Infinity
      let bestB: any = null
      for (const b of blobs) {
        const d = Math.sqrt((b.cx - gtPt.cx) ** 2 + (b.cy - gtPt.cy) ** 2)
        if (d < bestD) { bestD = d; bestB = b }
      }
      if (bestB) {
        nearest = `(${bestB.cx},${bestB.cy}) a=${bestB.w * bestB.h}`
        dist = bestD < 15 ? `${bestD.toFixed(0)}px ✓` : `${bestD.toFixed(0)}px ✗`
      }
    }

    const top5 = blobs.slice(0, 5).map(b => `(${b.cx},${b.cy} a=${b.w * b.h})`).join(' ')
    console.log(`f${String(i).padStart(2)}   | ${gtStr.padEnd(12)}| ${String(blobs.length).padEnd(6)}| ${nearest.padEnd(16)}| ${dist.padEnd(6)}| ${top5}`)
  }
}

function cmdQ2() {
  const rec = loadRecording()
  const gt = new Map((rec.groundTruth?.frames || []).map((f: any) => [f.frame, f.targets[0]]))
  const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()

  const strategies: { name: string; create: () => DetectionStrategy }[] = [
    { name: 'DEFAULT', create: () => new WrappedBlobTracker() },
    
    
    { name: 'FLOW', create: () => new FlowTracker() },
    { name: 'HYBRID', create: () => new HybridTracker() },
    { name: 'DRIFT', create: () => new DriftTracker() },
  ]

  console.log('=== Q2: Tracking Accuracy + bgVel ===\n')

  for (const s of strategies) {
    const strat = s.create()
    let totalErr = 0
    let errCount = 0
    let misses = 0
    let bgSpeeds: number[] = []

    console.log(`--- ${s.name} ---`)
    console.log('frame | GT pos      | best track pos  | err   | bgVel          | all tracks')
    console.log('------+-------------+-----------------+-------+----------------+------------------------------------')

    for (let i = 0; i < files.length; i++) {
      const { w, h, data } = readGray(files[i])
      strat.setGrayImage(data, w, h, 25)
      strat.setAreaRange(4, 256)
      const result = strat.update()
      const gtPt = gt.get(i)

      const bgSpeed = Math.sqrt(result.bgVx ** 2 + result.bgVy ** 2)
      bgSpeeds.push(bgSpeed)

      const gtStr = gtPt ? `(${gtPt.cx},${gtPt.cy})` : '---'
      const bgStr = `(${result.bgVx.toFixed(0)},${result.bgVy.toFixed(0)}) s=${bgSpeed.toFixed(0)}`

      if (gtPt) {
        let bestD = Infinity
        let bestT: any = null
        for (const t of result.tracked) {
          const d = Math.sqrt((t.cx - gtPt.cx) ** 2 + (t.cy - gtPt.cy) ** 2)
          if (d < bestD) { bestD = d; bestT = t }
        }

        const posStr = bestT ? `(${Math.round(bestT.cx)},${Math.round(bestT.cy)}) d=${bestT.displayId ?? '-'}` : 'MISS'
        const errStr = bestT ? (bestD < 30 ? `${bestD.toFixed(0)}px ✓` : `${bestD.toFixed(0)}px ✗`) : 'MISS'
        totalErr += bestD
        errCount++
        if (!bestT) misses++

        const tracked = result.tracked.map((t: any) =>
          (t.displayId !== null ? `T${t.displayId}` : '#') + `(${Math.round(t.cx)},${Math.round(t.cy)})`
        ).join(' ')

        console.log(`f${String(i).padStart(2)}   | ${gtStr.padEnd(12)}| ${posStr.padEnd(16)}| ${errStr.padEnd(6)}| ${bgStr.padEnd(15)}| ${tracked}`)
      } else {
        console.log(`f${String(i).padStart(2)}   | ${gtStr.padEnd(12)}| ${'---'.padEnd(16)}| ${'---'.padEnd(6)}| ${bgStr.padEnd(15)}|`)
      }
    }

    const avgErr = errCount > 0 ? (totalErr / errCount).toFixed(1) : '---'
    const avgBg = bgSpeeds.length > 0 ? (bgSpeeds.reduce((s, v) => s + v, 0) / bgSpeeds.length).toFixed(1) : '---'
    console.log(`\nAvg tracking error: ${avgErr}px | Misses: ${misses} | Avg bgSpeed: ${avgBg}\n`)
  }
}

function cmdQ3() {
  const rec = loadRecording()
  const gt = new Map((rec.groundTruth?.frames || []).map((f: any) => [f.frame, f.targets[0]]))
  const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()
  const strategies: { name: string; create: () => DetectionStrategy }[] = [
    { name: 'DEFAULT', create: () => new WrappedBlobTracker() },
    
    
    { name: 'FLOW', create: () => new FlowTracker() },
    { name: 'HYBRID', create: () => new HybridTracker() },
    { name: 'DRIFT', create: () => new DriftTracker() },
  ]

  console.log('=== Q3: Noise vs Target Classification ===\n')

  for (const s of strategies) {
    const strat = s.create()
    let truePositives = 0
    let falsePositives = 0
    let falseNegatives = 0
    let trueNegatives = 0

    for (let i = 0; i < files.length; i++) {
      const { w, h, data } = readGray(files[i])
      strat.setGrayImage(data, w, h, 25)
      strat.setAreaRange(4, 256)
      const result = strat.update()
      const gtPt = gt.get(i)

      const promoted = result.tracked.filter((t: any) => t.displayId !== null)
      const noise = result.tracked.filter((t: any) => t.displayId === null)

      if (gtPt) {
        const hasMatch = promoted.some((t: any) => Math.sqrt((t.cx - gtPt.cx) ** 2 + (t.cy - gtPt.cy) ** 2) < 30)
        if (hasMatch) truePositives++
        else falseNegatives++

        const falseTargets = promoted.filter((t: any) => Math.sqrt((t.cx - gtPt.cx) ** 2 + (t.cy - gtPt.cy) ** 2) >= 30)
        falsePositives += falseTargets.length
        trueNegatives += noise.length
      } else {
        falsePositives += promoted.length
        trueNegatives += noise.length
      }
    }

    const precision = (truePositives + falsePositives) > 0 ? (truePositives / (truePositives + falsePositives) * 100).toFixed(0) : '---'
    const recall = (truePositives + falseNegatives) > 0 ? (truePositives / (truePositives + falseNegatives) * 100).toFixed(0) : '---'
    const f1 = precision !== '---' && recall !== '---' ? (2 * truePositives / (2 * truePositives + falsePositives + falseNegatives) * 100).toFixed(0) : '---'

    console.log(`${s.name}: TP=${truePositives} FP=${falsePositives} FN=${falseNegatives} | Precision=${precision}% Recall=${recall}% F1=${f1}%`)
  }
}

const cmd = process.argv[2] || ''
if (cmd === 'q1') cmdQ1()
else if (cmd === 'q2') cmdQ2()
else if (cmd === 'q3') cmdQ3()
else console.log('Usage: npx tsx scripts/evaluate.ts <q1|q2|q3> [--dir=path]')
