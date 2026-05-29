import { useGameStore, TargetConfig } from '../store/gameStore'
import { useDroneStore } from '../store/droneStore'
import { useDetectionStore } from '../store/detectionStore'
import { useTargetStore } from '../store/targetStore'
import { useFlightDirector } from '../store/flightDirector'
import { startRecording, stopRecording } from '../utils/recorder'
import { pipeline } from '../pipeline/FramePipeline'
import { StrategyName } from '../strategy/types'

declare global {
  interface Window {
    DEBUG: typeof debugApi
  }
}

const HEX = '0123456789ABCDEF'

function extractBlobHex(gray: Uint8Array, w: number, h: number, bbox: [number, number, number, number]): string {
  const pad = 2
  const [bx, by, bx2, by2] = bbox
  const x0 = Math.max(0, bx - pad)
  const y0 = Math.max(0, by - pad)
  const x1 = Math.min(w, bx2 + pad)
  const y1 = Math.min(h, by2 + pad)
  const lines: string[] = []
  for (let y = y0; y < y1; y++) {
    let row = ''
    for (let x = x0; x < x1; x++) {
      row += HEX[Math.min(15, gray[y * w + x] >> 4)]
    }
    lines.push(row)
  }
  return lines.join('\n')
}

function floodFillBlob(binary: Uint8Array, w: number, h: number, startX: number, startY: number, visited: Uint8Array) {
  const startPx = startY * w + startX
  if (visited[startPx] || !binary[startPx]) return null
  visited[startPx] = 1
  const queue = [startPx]
  let sumX = 0, sumY = 0, count = 0
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0
  let totalBrightness = 0
  let maxBrightness = 0

  while (queue.length > 0) {
    const px = queue.shift()!
    const x = px % w
    const y = (px - x) / w
    sumX += x
    sumY += y
    count++
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    const b = binary[px]
    totalBrightness += b
    if (b > maxBrightness) maxBrightness = b
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const npx = ny * w + nx
        if (visited[npx] || !binary[npx]) continue
        visited[npx] = 1
        queue.push(npx)
      }
    }
  }

  if (count === 0) return null
  return {
    cx: Math.round(sumX / count),
    cy: Math.round(sumY / count),
    area: count,
    avgBrightness: Math.round(totalBrightness / count),
    maxBrightness,
    bbox: [minX, minY, maxX + 1, maxY + 1] as [number, number, number, number],
  }
}

const debugApi = {
  getState() {
    const game = useGameStore.getState()
    const drone = useDroneStore.getState()
    const detection = useDetectionStore.getState()
    const targets = useTargetStore.getState().targets
    const fd = useFlightDirector.getState()
    const gameTargets = game.targets
    return {
      phase: game.phase,
      drone: {
        position: drone.position,
        velocity: drone.velocity,
        yaw: drone.yaw,
        pitch: drone.pitch,
        input: drone.input,
      },
      gameTargets: gameTargets.map(t => ({ id: t.id, motion: t.motion, speed: t.speed, appearanceDelay: t.appearanceDelay })),
      targets: targets.map(t => ({
        id: t.id,
        position: t.position,
        speed: t.speed,
        altitude: t.altitude,
        active: t.active,
        behavior: t.behavior,
      })),
      detection: {
        tracked: detection.tracked.length,
        lockedTarget: detection.lockedTarget,
        params: {
          threshold: detection.threshold,
          minArea: detection.minArea,
          maxArea: detection.maxArea,
          detectionFps: detection.detectionFps,
        },
      },
      flightDirector: {
        command: fd.command,
        targetDisplayId: fd.targetDisplayId,
      },
    }
  },

  getTrackedDetail() {
    const detection = useDetectionStore.getState()
    const gray = pipeline.getGrayXor()
    const w = pipeline.getWidth()
    const h = pipeline.getHeight()
    return detection.tracked.map(t => {
      const hex = gray.length > 0 ? extractBlobHex(gray, w, h, t.bbox) : ''
      const flat = hex.replace(/\n/g, '')
      const nonzero = flat.replace(/0/g, '').length
      return {
        internalId: t.internalId,
        displayId: t.displayId,
        cx: Math.round(t.cx),
        cy: Math.round(t.cy),
        vx: Math.round(t.vx),
        vy: Math.round(t.vy),
        area: t.area,
        bbox: t.bbox,
        framesSeen: t.framesSeen,
        missMs: Math.round(t.missMs),
        residualSpeed: Math.round(t.residualSpeed),
        highJerkFrames: t.highJerkFrames,
        avgArea: Math.round(t.avgArea),
        hexCols: hex.split('\n')[0]?.length || 0,
        hexRows: hex.split('\n').length,
        hexFill: `${nonzero}/${flat.length}(${flat.length ? Math.round(nonzero / flat.length * 100) : 0}%)`,
        blobHex: hex,
      }
    })
  },

  analyzeXor(threshold?: number) {
    const gray = pipeline.getGrayXor()
    const w = pipeline.getWidth()
    const h = pipeline.getHeight()
    if (gray.length === 0) return { error: 'No XOR frame available' }

    const thr = threshold ?? useDetectionStore.getState().threshold
    const binary = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      binary[i] = gray[i] > thr ? 1 : 0
    }

    const visited = new Uint8Array(w * h)
    const blobs: any[] = []

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = y * w + x
        if (visited[px] || !binary[px]) continue
        const blob = floodFillBlob(binary, w, h, x, y, visited)
        if (blob && blob.area >= 3) {
          const hex = extractBlobHex(gray, w, h, blob.bbox)
          const flat = hex.replace(/\n/g, '')
          const nonzero = flat.replace(/0/g, '').length
          blobs.push({
            cx: blob.cx,
            cy: blob.cy,
            area: blob.area,
            bbox: blob.bbox,
            avgBrightness: blob.avgBrightness,
            maxBrightness: blob.maxBrightness,
            hexFill: `${nonzero}/${flat.length}(${Math.round(nonzero / flat.length * 100)}%)`,
            blobHex: hex,
          })
        }
      }
    }

    blobs.sort((a, b) => b.area - a.area)
    return { threshold: thr, totalBlobs: blobs.length, blobs }
  },

  startGame(targets: TargetConfig[]) {
    if (targets) useGameStore.getState().setTargets(targets)
    useGameStore.getState().start()
    const configs = useGameStore.getState().targets
    useTargetStore.getState().initFromConfig(configs)
  },

  initTargets() {
    const configs = useGameStore.getState().targets
    useTargetStore.getState().initFromConfig(configs)
  },

  pause() { useGameStore.getState().setPhase('paused') },
  resume() { useGameStore.getState().setPhase('playing') },
  reset() {
    useGameStore.getState().quit()
    useDroneStore.getState().setInput('forward', false)
    useDroneStore.getState().setInput('boost', false)
    useDroneStore.getState().setInput('up', false)
    useDroneStore.getState().setInput('down', false)
    useDroneStore.getState().setPosition([0, 20, 0])
    useDroneStore.getState().setInput('backward', false)
    useDroneStore.setState({ yaw: 0, pitch: 0 })
    pipeline.reset()
    useDetectionStore.getState().setDetectionResult([])
    useFlightDirector.getState().setCommand('idle', null)
    useDetectionStore.getState().lockTarget(null)
  },

  stepFrames(n: number): Promise<string> {
    return new Promise((resolve) => {
      useGameStore.getState().setPhase('playing')
      let count = 0
      const interval = setInterval(() => {
        count++
        if (count >= n) {
          clearInterval(interval)
          useGameStore.getState().setPhase('paused')
          resolve('stepped ' + n + ' frames, now paused')
        }
      }, 50) // 50ms = ~20fps detection rate
    })
  },

  progress_step(n: number): Promise<string> {
    return new Promise((resolve) => {
      if (n > 0) {
        useGameStore.getState().setPhase('playing')
        let count = 0
        const interval = setInterval(() => {
          count++
          if (count >= n) {
            clearInterval(interval)
            useGameStore.getState().setPhase('paused')
            const tracked = useDetectionStore.getState().tracked
            const confirmed = tracked.filter(t => t.displayId !== null)
            const xor = debugApi.analyzeXor()
            resolve(JSON.stringify({stepped: n, confirmed: confirmed.length, xorBlobs: xor.blobs?.length ?? 0}))
          }
        }, 50)
      } else {
        useGameStore.getState().setPhase('playing')
        resolve('continuous mode')
      }
    })
  },

  stepAndResume(n: number): Promise<string> {
    return new Promise((resolve) => {
      useGameStore.getState().setPhase('playing')
      let count = 0
      const interval = setInterval(() => {
        count++
        if (count >= n) {
          clearInterval(interval)
          resolve('stepped ' + n + ' frames, still playing')
        }
      }, 50)
    })
  },

  xorStats() {
    const gray = pipeline.getGrayXor()
    const w = pipeline.getWidth()
    const h = pipeline.getHeight()
    if (gray.length === 0) return { error: 'no xor frame' }
    let max = 0, sum = 0, nonzero = 0
    const hotPixels: {x:number,y:number,v:number}[] = []
    for (let i = 0; i < gray.length; i++) {
      const v = gray[i]
      if (v > max) max = v
      sum += v
      if (v > 0) nonzero++
      if (v > 50) {
        hotPixels.push({x: i % w, y: Math.floor(i / w), v: Math.round(v)})
      }
    }
    const total = w * h
    // cluster hot pixels
    const clusters: {cx:number,cy:number,count:number,maxV:number}[] = []
    const visited = new Set<number>()
    for (const p of hotPixels) {
      const key = p.y * w + p.x
      if (visited.has(key)) continue
      visited.add(key)
      const group = [p]
      for (const q of hotPixels) {
        if (Math.abs(q.x - p.x) < 30 && Math.abs(q.y - p.y) < 30 && q !== p) {
          group.push(q)
          visited.add(q.y * w + q.x)
        }
      }
      const cx = Math.round(group.reduce((s,q)=>s+q.x,0)/group.length)
      const cy = Math.round(group.reduce((s,q)=>s+q.y,0)/group.length)
      clusters.push({cx, cy, count: group.length, maxV: Math.max(...group.map(q=>q.v))})
    }
    clusters.sort((a,b) => b.count - a.count)
    return {
      w, h, maxPixel: Math.round(max), avgPixel: (sum/total).toFixed(2),
      nonzero, total, nonzeroPct: (nonzero/total*100).toFixed(2)+'%',
      hotPixelsAbove50: hotPixels.length,
      clusters: clusters.slice(0, 10),
    }
  },

  getCamFrame() {
    const gray = pipeline.getGrayXor()
    const w = pipeline.getWidth()
    const h = pipeline.getHeight()
    if (gray.length === 0) return null
    const pixels = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const i4 = i * 4
      pixels[i4] = gray[i]
      pixels[i4 + 1] = gray[i]
      pixels[i4 + 2] = gray[i]
      pixels[i4 + 3] = 255
    }
    return { pixels, w, h }
  },

  setDebugMode(v: boolean) {
    pipeline.setDebugMode(v)
  },

  setPhase(phase: string) {
    useGameStore.getState().setPhase(phase as any)
  },

  gpsHuntDemo(maxTimeMs?: number) {
    const timeout = maxTimeMs ?? 60000
    useGameStore.getState().setPhase('playing')

    return new Promise<string>((resolve) => {
      const startTime = performance.now()
      let phase = 'approach'

      const check = () => {
        const elapsed = performance.now() - startTime
        if (elapsed > timeout) {
          pipeline.setDebugMode(false)
          useDroneStore.getState().setInput('forward', false)
          useDroneStore.getState().setInput('boost', false)
          resolve('TIMEOUT after ' + Math.round(elapsed) + 'ms. Targets: ' + useTargetStore.getState().targets.filter(t=>t.active).length)
          return
        }

        const targets = useTargetStore.getState().targets.filter(t => t.active)
        if (targets.length === 0) {
          pipeline.setDebugMode(false)
          resolve('TARGET DESTROYED in ' + Math.round(elapsed) + 'ms')
          return
        }

        const tgt = targets[0]
        debugApi.aimAtTarget(tgt.id)

        const dp = useDroneStore.getState().position
        const dist = Math.sqrt(
          (tgt.position[0] - dp[0])**2 +
          (tgt.position[1] - dp[1])**2 +
          (tgt.position[2] - dp[2])**2
        )

        if (phase === 'approach') {
          useDroneStore.getState().setInput('forward', true)
          useDroneStore.getState().setInput('boost', true)
          if (dist < 20) {
            useDroneStore.getState().setInput('boost', false)
            phase = 'collide'
          }
        }

        if (phase === 'collide') {
          useDroneStore.getState().setInput('forward', true)
          useDroneStore.getState().setPosition([tgt.position[0] - 1, tgt.position[1] + 0.5, tgt.position[2]])
        }

        setTimeout(check, 100)
      }
      setTimeout(check, 500)
    })
  },

  autoHunt(maxTimeMs?: number) {
    const timeout = maxTimeMs ?? 60000
    pipeline.setDebugMode(true)
    useGameStore.getState().setPhase('playing')

    return new Promise<string>((resolve) => {
      const startTime = performance.now()
      let phase: 'hunt' | 'select' | 'track' | 'approach' | 'done' = 'hunt'
      let selectedId: number | null = null

      const RESIDUAL_THRESHOLD = 12
      const MIN_AREA = 6
      const STANCE_AREA = 400

      const done = (msg: string) => {
        pipeline.setDebugMode(false)
        useDroneStore.getState().setInput('forward', false)
        useDroneStore.getState().setInput('boost', false)
        resolve(msg)
      }

      const check = () => {
        const elapsed = performance.now() - startTime
        if (elapsed > timeout) {
          done('TIMEOUT after ' + Math.round(elapsed / 1000) + 's')
          return
        }

        const targets = useTargetStore.getState().targets.filter(t => t.active)
        if (targets.length === 0) {
          done('TARGET DESTROYED in ' + Math.round(elapsed / 1000) + 's')
          return
        }

        const tracked = useDetectionStore.getState().tracked
        const confirmed = tracked.filter(t => t.displayId !== null)

        if (phase === 'hunt') {
          useDroneStore.getState().setInput('forward', true)
          useDroneStore.getState().setInput('boost', true)
          const candidates = confirmed.filter(t => t.residualSpeed > RESIDUAL_THRESHOLD && t.area >= MIN_AREA)
          if (candidates.length > 0) {
            phase = 'select'
          }
        }

        if (phase === 'select') {
          useDroneStore.getState().setInput('boost', false)
          const candidates = confirmed.filter(t => t.residualSpeed > RESIDUAL_THRESHOLD && t.area >= MIN_AREA)
          if (candidates.length > 0) {
            candidates.sort((a, b) => (b.residualSpeed * b.area) - (a.residualSpeed * a.area))
            const best = candidates[0]
            selectedId = best.displayId
            useDetectionStore.getState().lockTarget(selectedId)
            useFlightDirector.getState().setCommand('lock', selectedId)
            phase = 'track'
          } else {
            phase = 'hunt'
          }
        }

        if (phase === 'track') {
          if (selectedId === null) { phase = 'hunt'; return }
          const blob = tracked.find(t => t.displayId === selectedId)
          if (!blob || blob.missMs > 3000) {
            useDetectionStore.getState().lockTarget(null)
            useFlightDirector.getState().setCommand('idle', null)
            selectedId = null
            phase = 'hunt'
            return
          }
          if (blob.area > STANCE_AREA) {
            useFlightDirector.getState().setCommand('approach', selectedId)
            phase = 'approach'
          }
        }

        if (phase === 'approach') {
          if (selectedId === null) { phase = 'hunt'; return }
          const blob = tracked.find(t => t.displayId === selectedId)
          if (!blob || blob.missMs > 3000) {
            useDetectionStore.getState().lockTarget(null)
            useFlightDirector.getState().setCommand('idle', null)
            selectedId = null
            phase = 'hunt'
            return
          }
          if (blob.area > STANCE_AREA * 2) {
            useFlightDirector.getState().setCommand('fire', selectedId)
          }
        }

        setTimeout(check, 50)
      }

      setTimeout(check, 200)
    })
  },

  setPitch(rad: number) { useDroneStore.setState({ pitch: rad }) },
  setPosition(pos: [number, number, number]) { useDroneStore.setState({ position: pos }) },
  setInput(flags: Record<string, boolean>) {
    for (const [key, val] of Object.entries(flags)) {
      useDroneStore.getState().setInput(key, val)
    }
  },

  lockTarget(displayId: number) { useDetectionStore.getState().lockTarget(displayId) },
  unlockTarget() { useDetectionStore.getState().lockTarget(null) },
  setCommand(cmd: string, displayId: number | null) {
    useFlightDirector.getState().setCommand(cmd as any, displayId)
  },
  setParams(params: Record<string, number>) {
    const d = useDetectionStore.getState()
    if (params.threshold !== undefined) d.setThreshold(params.threshold)
    if (params.minArea !== undefined) d.setMinArea(params.minArea)
    if (params.maxArea !== undefined) d.setMaxArea(params.maxArea)
    if (params.detectionFps !== undefined) d.setDetectionFps(params.detectionFps)
  },

  setPatchMethod(method: 'ncc' | 'xor') {
    useDetectionStore.getState().setPatchMethod(method)
  },

  setStrategy(name: StrategyName) {
    useDetectionStore.getState().setStrategy(name)
  },

  startRecording() { startRecording(useDetectionStore.getState() as any) },
  stopRecording() {
    const rec = stopRecording()
    return rec ? JSON.stringify(rec) : null
  },

  pressKey(code: string) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
  },
  releaseKey(code: string) {
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
  },

  aimAtTarget(targetId?: string) {
    const targets = useTargetStore.getState().targets
    const t = targetId
      ? targets.find(x => x.id === targetId)
      : targets.find(x => x.active)
    if (!t) return 'no active target'
    const drone = useDroneStore.getState()
    const dx = t.position[0] - drone.position[0]
    const dz = t.position[2] - drone.position[2]
    const ny = Math.atan2(-dx, -dz)
    useDroneStore.setState({ yaw: ny })
    const dy = t.position[1] - drone.position[1]
    const horizDist = Math.sqrt(dx * dx + dz * dz)
    const np = Math.atan2(-dy, horizDist)
    useDroneStore.setState({ pitch: np })
    return `aimed yaw=${ny.toFixed(2)} pitch=${np.toFixed(2)} dist=${horizDist.toFixed(0)}`
  },

  flyTo(pos: [number, number, number]) {
    useDroneStore.getState().setPosition(pos)
  },

  preset_circle(speed?: number) {
    const s = speed ?? 11
    useGameStore.getState().setTargets([{ id: 'alpha', type: 'drone', motion: 'circle', speed: s, jitter: 0, appearanceDelay: 0 }])
    useGameStore.getState().start()
    useTargetStore.getState().initFromConfig(useGameStore.getState().targets)
  },
  preset_figure8() {
    useGameStore.getState().setTargets([{ id: 'alpha', type: 'drone', motion: 'figure8', speed: 8, jitter: 0, appearanceDelay: 0 }])
    useGameStore.getState().start()
    useTargetStore.getState().initFromConfig(useGameStore.getState().targets)
  },
  preset_multi() {
    debugApi.startGame([
      { id: 'alpha', type: 'drone', motion: 'circle', speed: 40, jitter: 0, appearanceDelay: 0 },
      { id: 'bravo', type: 'drone', motion: 'figure8', speed: 30, jitter: 0, appearanceDelay: 0 },
    ])
  },

  snapshot() {
    const st = debugApi.getState()
    const tr = debugApi.getTrackedDetail()
    const ax = debugApi.analyzeXor()
    const confirmed = tr.filter(t => t.displayId !== null)
    const noise = tr.filter(t => t.displayId === null)
    const gray = pipeline.getGrayXor()
    const w = pipeline.getWidth()
    const h = pipeline.getHeight()
    return {
      phase: st.phase,
      drone: {
        pos: st.drone.position.map((v: number) => Math.round(v)),
        yaw: st.drone.yaw.toFixed(2),
        pitch: st.drone.pitch.toFixed(2),
      },
      target: st.targets[0] ? {
        pos: st.targets[0].position.map((v: number) => Math.round(v)),
        active: st.targets[0].active,
      } : null,
      tracked: confirmed.map(t => ({
        id: 'T' + t.displayId,
        cx: t.cx, cy: t.cy,
        area: t.area,
        missMs: t.missMs,
        res: t.residualSpeed,
        fill: t.hexFill,
      })),
      noise: noise.length,
      xorBlobs: ax.blobs?.length ?? 0,
      xorFrame: gray.length > 0 ? {w, h, hasPixels: true} : null,
      cmd: st.flightDirector.command,
      locked: st.detection.lockedTarget,
    }
  },
}

window.DEBUG = debugApi