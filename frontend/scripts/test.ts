import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { TrackedBlob, BlobTracker } from '../src/utils/blobTracker'
import { FlowTracker } from '../src/strategy/FlowTracker'
import { HybridTracker } from '../src/strategy/HybridTracker'
import { DriftTracker } from '../src/strategy/DriftTracker'
import { DetectionStrategy, StrategyResult, StrategyName } from '../src/strategy/types'
import { WrappedBlobTracker } from '../src/strategy/WrappedBlobTracker'

const dir = process.argv.find(a => a.startsWith('--dir='))?.slice(6) || 'docs/frames'
const cmd = process.argv[2] || ''
const debug = process.argv.includes('--debug')
const checks = new Set((process.argv.find(a => a.startsWith('--check='))?.slice(8) || 'bench,compare,lifecycle').split(','))

function readGray(filename: string) {
  const match = filename.match(/(\d+)x(\d+)\.gray$/)
  if (!match) { console.error(`Bad filename: ${filename}`); process.exit(1) }
  const w = parseInt(match[1]), h = parseInt(match[2])
  const buf = readFileSync(join(dir, filename))
  return { w, h, data: new Uint8Array(buf) }
}

function loadRecording() {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  if (files.length === 0) { console.error('No recording.json found in', dir); process.exit(1) }
  const pick = files.includes('recording.json') ? 'recording.json' : files[files.length - 1]
  const raw = JSON.parse(readFileSync(join(dir, pick), 'utf-8'))
  return raw
}

function loadFrames() {
  const files = readdirSync(dir).filter(f => f.endsWith('.gray')).sort()
  if (files.length === 0) { console.error('No .gray files in', dir); process.exit(1) }
  return files.map(f => ({ filename: f, ...readGray(f) }))
}

function runStrategy(strategy: DetectionStrategy, frames: ReturnType<typeof loadFrames>, threshold = 25, minArea = 4, maxArea = 256) {
  const results: { frame: number; result: StrategyResult; ms: number }[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    strategy.setGrayImage(f.data, f.w, f.h, threshold)
    strategy.setAreaRange(minArea, maxArea)
    const t0 = performance.now()
    const result = strategy.update()
    const ms = performance.now() - t0
    results.push({ frame: i, result, ms })
  }
  return results
}

const STRATEGIES: { name: StrategyName; label: string; create: () => DetectionStrategy }[] = [
  { name: 'default', label: 'DEFAULT', create: () => new WrappedBlobTracker() },
  { name: 'flow', label: 'FLOW   ', create: () => new FlowTracker() },
  { name: 'hybrid', label: 'HYBRID ', create: () => new HybridTracker() },
  { name: 'drift', label: 'DRIFT  ', create: () => new DriftTracker() },
]

function cmdBench() {
  const frames = loadFrames()
  console.log(`Loaded ${frames.length} frames (${frames[0].w}x${frames[0].h})\n`)
  console.log('Strategy  | Total ms | Avg ms | Max ms | Targets found | Avg tracked')
  console.log('----------+----------+--------+--------+---------------+------------')

  for (const s of STRATEGIES) {
    const strategy = s.create()
    const results = runStrategy(strategy, frames)
    const totalMs = results.reduce((sum, r) => sum + r.ms, 0)
    const avgMs = totalMs / results.length
    const maxMs = Math.max(...results.map(r => r.ms))
    const totalTargets = results.reduce((sum, r) => sum + r.result.tracked.filter(t => t.displayId !== null).length, 0)
    const avgTracked = results.reduce((sum, r) => sum + r.result.tracked.length, 0) / results.length
    console.log(`${s.label} | ${totalMs.toFixed(0).padStart(8)} | ${avgMs.toFixed(2).padStart(6)} | ${maxMs.toFixed(2).padStart(6)} | ${String(totalTargets).padStart(13)} | ${avgTracked.toFixed(1).padStart(11)}`)
  }
}

function cmdCompare() {
  const rec = loadRecording()
  const frames = loadFrames()
  console.log(`Loaded ${frames.length} frames, comparing all strategies vs recording\n`)

  for (const s of STRATEGIES) {
    const strategy = s.create()
    const results = runStrategy(strategy, frames)
    console.log(`\n=== ${s.label} ===`)
    console.log('frame | rec d1 pos          | test tracked pos       | err')
    console.log('------+--------------------+------------------------+-----')

    let matches = 0, mismatches = 0, noDet = 0
    for (let i = 0; i < results.length; i++) {
      const recD1 = rec.frames[i]?.tracked.find((t: any) => t.displayId === 1)
      const test = results[i].result.tracked.filter((t: TrackedBlob) => t.displayId !== null).sort((a, b) => b.area - a.area)[0]
      const rs = recD1 ? `(${recD1.cx},${recD1.cy}) a=${recD1.area}` : '---'
      const ts = test ? `(${test.cx.toFixed(0)},${test.cy.toFixed(0)}) a=${test.area.toFixed(0)}` : '---'
      let err = '---'
      if (recD1 && test) {
        const d = Math.sqrt((test.cx - recD1.cx) ** 2 + (test.cy - recD1.cy) ** 2)
        err = d < 30 ? 'OK' : d.toFixed(0) + 'px'
        if (d < 30) matches++; else mismatches++
      } else if (!recD1 && !test) {
        err = 'OK'
        noDet++
      } else {
        if (recD1 && !test) mismatches++
      }
      console.log(`f${String(i).padStart(2)}   | ${rs.padEnd(19)}| ${ts.padEnd(23)}| ${err}`)
    }
    console.log(`${s.label}: ${matches} OK, ${mismatches} mismatch, ${noDet} no-detection`)
  }
}

function cmdLifecycle() {
  const frames = loadFrames()
  console.log(`Loaded ${frames.length} frames\n`)

  for (const s of STRATEGIES) {
    const strategy = s.create()
    const results = runStrategy(strategy, frames)
    console.log(`\n=== ${s.label} ===`)

    let idSwitches = 0
    let oscillations = 0
    let totalFramesWithTargets = 0
    let totalBgSpeed = 0

    const displayIdMap = new Map<number, Set<number>>()
    for (const { frame, result } of results) {
      const withId = result.tracked.filter(t => t.displayId !== null)
      if (withId.length > 0) totalFramesWithTargets++
      totalBgSpeed += Math.sqrt(result.bgVx ** 2 + result.bgVy ** 2)

      for (const t of withId) {
        if (!displayIdMap.has(t.displayId!)) displayIdMap.set(t.displayId!, new Set())
        displayIdMap.get(t.displayId!)!.add(t.internalId)
      }
    }

    for (const [displayId, internalIds] of displayIdMap) {
      if (internalIds.size > 1) {
        console.log(`  displayId=${displayId}: used ${internalIds.size} different internalIds (#${[...internalIds].join(', #')})`)
        idSwitches += internalIds.size - 1
      }
    }

    const avgBgSpeed = totalFramesWithTargets > 0 ? totalBgSpeed / results.length : 0
    const maxTargets = Math.max(...results.map(r => r.result.tracked.filter(t => t.displayId !== null).length))
    console.log(`  frames with targets: ${totalFramesWithTargets}/${results.length}`)
    console.log(`  max simultaneous targets: ${maxTargets}`)
    console.log(`  id switches: ${idSwitches}`)
    console.log(`  avg bg speed: ${avgBgSpeed.toFixed(1)}`)
  }
}

function cmdDetail() {
  const frames = loadFrames()
  const strategyName = (process.argv.find(a => a.startsWith('--strategy='))?.slice(11) || 'default') as StrategyName
  const entry = STRATEGIES.find(s => s.name === strategyName)
  if (!entry) { console.error('Unknown strategy:', strategyName); process.exit(1) }

  const strategy = entry.create()
  const results = runStrategy(strategy, frames)

  console.log(`=== ${entry.label} detail ===\n`)
  for (const { frame, result, ms } of results) {
    const withId = result.result.tracked.filter(t => t.displayId !== null)
    const parts = withId.map(t => `d${t.displayId}(#${t.internalId} ${t.cx.toFixed(0)},${t.cy.toFixed(0)} a=${t.area.toFixed(0)})`)
    const bg = `bg=(${result.bgVx.toFixed(0)},${result.bgVy.toFixed(0)})`
    console.log(`f${String(frame).padStart(2)} ${ms.toFixed(1)}ms | ${parts.join(' ') || 'no target'} | ${bg} | noise=${result.tracked.filter(t => t.displayId === null).length}`)
  }
}

function cmdSessions() {
  const base = 'docs/frames'
  const entries = readdirSync(base, { withFileTypes: true })
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort().reverse()
  const rootGray = entries.filter(e => e.isFile() && e.name.endsWith('.gray')).length
  console.log('Available sessions:\n')
  for (const d of dirs) {
    const files = readdirSync(join(base, d))
    const grays = files.filter(f => f.endsWith('.gray')).length
    const jsons = files.filter(f => f.endsWith('.json'))
    const hasGt = jsons.some(f => {
      try { return 'groundTruth' in JSON.parse(readFileSync(join(base, d, f), 'utf-8')) } catch { return false }
    })
    console.log(`  ${d}  ${grays} frames  ${jsons.length > 0 ? '✓ rec' : '✗ rec'}  ${hasGt ? '✓ GT' : '✗ GT'}`)
  }
  if (rootGray > 0) {
    console.log(`  _root (legacy)  ${rootGray} frames`)
  }
  console.log(`\nUsage: npx tsx scripts/test.ts bench --dir=docs/frames/<session>`)
}

function cmdGt() {
  const rec = loadRecording()
  if (!rec.groundTruth || rec.groundTruth.frames.length === 0) {
    console.error('No ground truth in recording.json. Annotate in Playback first.')
    process.exit(1)
  }
  const gtFrames = new Map<number, { cx: number; cy: number }[]>()
  for (const f of rec.groundTruth.frames) {
    gtFrames.set(f.frame, f.targets)
  }

  const frames = loadFrames()
  console.log(`Loaded ${frames.length} frames, ${gtFrames.size} with ground truth\n`)

  const threshold = parseFloat(process.argv.find(a => a.startsWith('--thr='))?.slice(6) || '30')

  console.log(`Strategy  | Found | Missed | Wrong | Avg err | Max err | Avg ms`)
  console.log(`----------+-------+--------+-------+---------+---------+-------`)

  for (const s of STRATEGIES) {
    const strategy = s.create()
    if (debug && strategy.setDebug) strategy.setDebug(true)
    const results = runStrategy(strategy, frames)
    let found = 0
    let missed = 0
    let wrong = 0
    let totalErr = 0
    let maxErr = 0
    let errCount = 0

    for (let i = 0; i < results.length; i++) {
      const gtTargets = gtFrames.get(i)
      if (!gtTargets) continue
      const gtFirst = gtTargets[0]
      if (!gtFirst) continue

      const tracked = results[i].result.tracked
      const withId = tracked.filter(t => t.displayId !== null)

      let bestDist = Infinity
      let bestMatch: TrackedBlob | null = null
      for (const t of withId) {
        const d = Math.sqrt((t.cx - gtFirst.cx) ** 2 + (t.cy - gtFirst.cy) ** 2)
        if (d < bestDist) {
          bestDist = d
          bestMatch = t
        }
      }

      if (bestMatch && bestDist < threshold) {
        found++
        totalErr += bestDist
        errCount++
        if (bestDist > maxErr) maxErr = bestDist
      } else if (withId.length > 0) {
        wrong++
        totalErr += bestDist
        errCount++
        if (bestDist > maxErr) maxErr = bestDist
      } else {
        missed++
      }
    }

    const avgErr = errCount > 0 ? totalErr / errCount : 0
    const avgMs = results.reduce((s, r) => s + r.ms, 0) / results.length
    console.log(`${s.label} | ${String(found).padStart(5)} | ${String(missed).padStart(6)} | ${String(wrong).padStart(5)} | ${avgErr.toFixed(1).padStart(7)} | ${maxErr.toFixed(1).padStart(7)} | ${avgMs.toFixed(1)}`)
  }

  console.log(`\nPer-frame detail (threshold=${threshold}px):\n`)
  console.log('frame | GT pos           | DEFAULT          | FLOW             | HYBRID')
  console.log('------+-----------------+------------------+------------------+------------------')

  const allResults: Map<string, { frame: number; result: StrategyResult; ms: number }[]> = new Map()
  for (const s of STRATEGIES) {
    const strategy = s.create()
    allResults.set(s.name, runStrategy(strategy, frames))
  }

  for (let i = 0; i < frames.length; i++) {
    const gtTargets = gtFrames.get(i)
    const gtFirst = gtTargets ? gtTargets[0] : null
    const gtStr = gtFirst ? `(${gtFirst.cx},${gtFirst.cy})` : '---'

    const parts: string[] = []
    for (const s of STRATEGIES) {
      const res = allResults.get(s.name)![i]
      const withId = res.result.tracked.filter(t => t.displayId !== null)
      if (!gtFirst || withId.length === 0) {
        parts.push('---')
        continue
      }
      let bestDist = Infinity
      let bestMatch: TrackedBlob | null = null
      for (const t of withId) {
        const d = Math.sqrt((t.cx - gtFirst.cx) ** 2 + (t.cy - gtFirst.cy) ** 2)
        if (d < bestDist) { bestDist = d; bestMatch = t }
      }
      if (bestMatch && bestDist < threshold) {
        parts.push(`${bestMatch.cx},${bestMatch.cy} ✓${bestDist.toFixed(0)}`)
      } else if (bestMatch) {
        parts.push(`${bestMatch.cx},${bestMatch.cy} ✗${bestDist.toFixed(0)}`)
      } else {
        parts.push('---')
      }
    }

    console.log(`f${String(i).padStart(2)}   | ${gtStr.padEnd(16)}| ${parts[0].padEnd(17)}| ${parts[1].padEnd(17)}| ${parts[2]}`)
  }
}

function cmdHelp() {
  console.log(`Usage: npx tsx scripts/test.ts <command> [--dir=path] [--strategy=name]

Commands:
  sessions   List saved sessions (frame count, GT status)
  bench      Benchmark all strategies: timing, target counts
  compare    Compare all strategies vs recording JSON
  lifecycle  Track identity, bg velocity, id switches
  detail     Per-frame detail for one strategy (--strategy=name)

Options:
  --dir=path          Gray frames directory (default: docs/frames)
  --strategy=name     Strategy for detail command (default|simple|correlation|flow)

Strategies:
  default     Original BlobTracker (median bgVel + slice-match)
  flow        Block-matching optical flow (raw flow bgVel)
  hybrid      Flow detection + raw flow bgVel + strict classification
`)
}

if (cmd === 'sessions') cmdSessions()
else if (cmd === 'gt') cmdGt()
else if (cmd === 'bench') cmdBench()
else if (cmd === 'compare') cmdCompare()
else if (cmd === 'lifecycle') cmdLifecycle()
else if (cmd === 'detail') cmdDetail()
else cmdHelp()
