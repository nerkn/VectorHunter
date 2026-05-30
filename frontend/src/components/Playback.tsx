import { useState, useRef, useEffect } from 'react'
import { Recording } from '../utils/recorder'

const HEX = '0123456789ABCDEF'

let saveFolder = ''

function newSaveFolder(): string {
  saveFolder = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return saveFolder
}

function extractBlobHex(imageData: ImageData, bbox: [number, number, number, number]): string {
  const pad = 2
  const [bx, by, bx2, by2] = bbox
  const w = imageData.width
  const h = imageData.height
  const d = imageData.data
  const x0 = Math.max(0, bx - pad)
  const y0 = Math.max(0, by - pad)
  const x1 = Math.min(w, bx2 + pad)
  const y1 = Math.min(h, by2 + pad)
  const lines: string[] = []
  for (let y = y0; y < y1; y++) {
    let row = ''
    for (let x = x0; x < x1; x++) {
      const idx = (y * w + x) * 4
      const brightness = Math.max(d[idx], d[idx + 1], d[idx + 2])
      row += HEX[Math.min(15, brightness >> 4)]
    }
    lines.push(row)
  }
  return lines.join('\n')
}

async function postFile(filename: string, body: Uint8Array, folder: string) {
  const headers: Record<string, string> = { 'x-filename': filename, 'x-folder': folder }
  await fetch('/save-gray', { method: 'POST', headers, body: body as unknown as Blob })
}

function saveGrayFrame(rec: Recording, idx: number, folder: string) {
  const fr = rec.frames[idx]
  if (!fr) return
  const w = fr.xorImage.width
  const h = fr.xorImage.height
  const gray = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = fr.xorImage.data[i * 4]
  }
  const filename = `frame_${String(idx).padStart(4, '0')}_${w}x${h}.gray`
  postFile(filename, gray, folder).then(() => console.log('saved', folder + '/' + filename))
}

function saveRecordingJson(rec: Recording, folder: string, groundTruth?: GroundTruth) {
  const json: any = {
    version: rec.version,
    params: rec.params,
    frames: rec.frames.map(f => ({
      time: f.time,
      tracked: f.tracked.map(t => ({
        ...t,
        cx: Math.round(t.cx),
        cy: Math.round(t.cy),
        vx: Math.round(t.vx),
        vy: Math.round(t.vy),
        missMs: Math.round(t.missMs),
        residualSpeed: Math.round(t.residualSpeed),
        avgArea: Math.round(t.avgArea),
        blobHex: extractBlobHex(f.xorImage, t.bbox),
      })),
    })),
  }
  if (groundTruth && groundTruth.frames.length > 0) {
    json.groundTruth = groundTruth
  }
  const data = new TextEncoder().encode(JSON.stringify(json, null, 2))
  postFile('recording.json', data, folder).then(() => console.log('saved', folder + '/recording.json'))
}

function saveAllFrames(rec: Recording, groundTruth?: GroundTruth) {
  const folder = newSaveFolder()
  const w = rec.frames[0]?.xorImage.width ?? 640
  const h = rec.frames[0]?.xorImage.height ?? 480

  for (let i = 0; i < rec.frames.length; i++) {
    const fr = rec.frames[i]
    const gray = new Uint8Array(w * h)
    for (let j = 0; j < w * h; j++) {
      gray[j] = fr.xorImage.data[j * 4]
    }
    const filename = `frame_${String(i).padStart(4, '0')}_${w}x${h}.gray`
    postFile(filename, gray, folder).then(() => console.log('saved', folder + '/' + filename))
  }

  saveRecordingJson(rec, folder, groundTruth)
  saveFolder = ''
}

interface Props {
  recording: Recording
  onClose: () => void
}

interface GroundTruth {
  frames: { frame: number; targets: { cx: number; cy: number }[] }[]
}

async function loadSession(session: string): Promise<{ rec: Recording; gt: GroundTruth } | null> {
  try {
    const listRes = await fetch(`/save-gray/list?session=${encodeURIComponent(session)}`)
    const files: string[] = await listRes.json()
    const jsonFile = files.find(f => f === 'recording.json') || files.find(f => f.endsWith('.json'))
    if (!jsonFile) return null
    const jsonRes = await fetch(`/save-gray/file?session=${encodeURIComponent(session)}&file=${encodeURIComponent(jsonFile)}`)
    const json = await jsonRes.json()
    const frames: Recording['frames'] = []
    for (let i = 0; i < json.frames.length; i++) {
      const grayFile = files.find(f => f.match(new RegExp(`frame_${String(i).padStart(4, '0')}_.*\\.gray$`)))
      if (!grayFile) continue
      const grayRes = await fetch(`/save-gray/file?session=${encodeURIComponent(session)}&file=${encodeURIComponent(grayFile)}`)
      const grayBuf = new Uint8Array(await grayRes.arrayBuffer())
      const match = grayFile.match(/(\d+)x(\d+)\.gray$/)
      const w = match ? parseInt(match[1]) : 640
      const h = match ? parseInt(match[2]) : 480
      const imageData = new ImageData(w, h)
      for (let j = 0; j < w * h; j++) {
        imageData.data[j * 4] = grayBuf[j]
        imageData.data[j * 4 + 1] = grayBuf[j]
        imageData.data[j * 4 + 2] = grayBuf[j]
        imageData.data[j * 4 + 3] = 255
      }
      frames.push({
        time: json.frames[i]?.time ?? 0,
        xorImage: imageData,
        tracked: json.frames[i]?.tracked ?? [],
      })
    }
    const gt: GroundTruth = json.groundTruth || { frames: [] }
    return { rec: { version: json.version, params: json.params, frames }, gt }
  } catch (e) {
    console.error('loadSession failed', e)
    return null
  }
}

export default function Playback({ recording, onClose }: Props) {
  const [frameIdx, setFrameIdx] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hoverCoord, setHoverCoord] = useState<string>('')
  const [copiedFlash, setCopiedFlash] = useState(false)
  const [sessions, setSessions] = useState<string[]>([])
  const [selectedSession, setSelectedSession] = useState('')
  const [loadedRec, setLoadedRec] = useState<Recording | null>(null)
  const [annotateMode, setAnnotateMode] = useState(false)
  const [groundTruth, setGroundTruth] = useState<GroundTruth>({ frames: [] })
  const total = recording.frames.length
  const frame = recording.frames[frameIdx]
  const activeRec = loadedRec || recording
  const activeTotal = activeRec.frames.length
  const activeFrame = activeRec.frames[frameIdx]

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setFrameIdx(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setFrameIdx(i => Math.min(total - 1, i + 1))
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [total, onClose])

  useEffect(() => {
    if (!canvasRef.current || !activeFrame) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    ctx.putImageData(activeFrame.xorImage, 0, 0)

    for (const t of activeFrame.tracked) {
      const isTarget = t.displayId !== null
      const color = isTarget ? '#ffff00' : '#ffffff44'
      ctx.strokeStyle = color
      ctx.strokeRect(t.bbox[0], t.bbox[1], t.bbox[2] - t.bbox[0], t.bbox[3] - t.bbox[1])

      if (isTarget) {
        ctx.fillStyle = '#ffff00'
        ctx.font = '12px monospace'
        ctx.fillText(`T${t.displayId}`, t.cx + 4, t.cy - 4)

        const dt = 0.15
        const px = t.cx + t.vx * dt
        const py = t.cy + t.vy * dt
        ctx.beginPath()
        ctx.moveTo(t.cx, t.cy)
        ctx.lineTo(px, py)
        ctx.strokeStyle = '#ffff0088'
        ctx.stroke()
      } else {
        ctx.fillStyle = '#ffffff44'
        ctx.beginPath()
        ctx.arc(t.cx, t.cy, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const gtFrame = groundTruth.frames.find(f => f.frame === frameIdx)
    if (gtFrame) {
      for (const t of gtFrame.targets) {
        ctx.strokeStyle = '#ff00ff'
        ctx.lineWidth = 2
        ctx.strokeRect(t.cx - 6, t.cy - 6, 12, 12)
        ctx.beginPath()
        ctx.moveTo(t.cx - 8, t.cy)
        ctx.lineTo(t.cx + 8, t.cy)
        ctx.moveTo(t.cx, t.cy - 8)
        ctx.lineTo(t.cx, t.cy + 8)
        ctx.strokeStyle = '#ff00ff88'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.lineWidth = 1
    }
  }, [activeFrame, frameIdx, groundTruth])

  useEffect(() => {
    fetch('/save-gray/sessions').then(r => r.json()).then(setSessions).catch(() => {})
  }, [])

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: '#000e', zIndex: 100, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#0f0',
    }}>
      <div style={{ position: 'absolute', top: 10, right: 10, cursor: 'pointer', fontSize: 20 }} onClick={onClose}>✕</div>

      <div style={{ fontSize: 12, marginBottom: 8 }}>
        PARAMS: min={recording.params.minArea} max={recording.params.maxArea} thr={recording.params.threshold} fps={recording.params.detectionFps}
      </div>

      <canvas
        ref={canvasRef}
        width={activeFrame?.xorImage.width ?? 640}
        height={activeFrame?.xorImage.height ?? 480}
        style={{ border: copiedFlash ? '2px solid #ff0' : '1px solid #0f04', imageRendering: 'pixelated', cursor: annotateMode ? 'crosshair' : 'default' }}
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect()
          const sx = (e.currentTarget.width) / r.width
          const sy = (e.currentTarget.height) / r.height
          const px = Math.floor((e.clientX - r.left) * sx)
          const py = Math.floor((e.clientY - r.top) * sy)
          if (activeFrame) {
            const i = (py * activeFrame.xorImage.width + px) * 4
            const v = activeFrame.xorImage.data[i]
            setHoverCoord(`${px}x${py} v=${v}`)
          }
        }}
        onMouseLeave={() => setHoverCoord('')}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect()
          const sx = (e.currentTarget.width) / r.width
          const sy = (e.currentTarget.height) / r.height
          const px = Math.floor((e.clientX - r.left) * sx)
          const py = Math.floor((e.clientY - r.top) * sy)
          if (annotateMode) {
            setGroundTruth(prev => {
              const frames = [...prev.frames]
              const existing = frames.find(f => f.frame === frameIdx)
              if (existing) {
                existing.targets.push({ cx: px, cy: py })
              } else {
                frames.push({ frame: frameIdx, targets: [{ cx: px, cy: py }] })
              }
              return { frames }
            })
          } else {
            navigator.clipboard.writeText(`${px},${py}`)
            setCopiedFlash(true)
            setTimeout(() => setCopiedFlash(false), 200)
          }
        }}
        onContextMenu={e => {
          e.preventDefault()
          if (!annotateMode) return
          setGroundTruth(prev => {
            const frames = prev.frames.map(f => {
              if (f.frame !== frameIdx) return f
              return { ...f, targets: f.targets.slice(0, -1) }
            }).filter(f => f.targets.length > 0)
            return { frames }
          })
        }}
      />

      <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={() => setFrameIdx(Math.max(0, frameIdx - 1))} style={btnStyle}>◀</button>
        <span style={{ fontSize: 12 }}>{frameIdx + 1} / {activeTotal}</span>
        <button onClick={() => setFrameIdx(Math.min(activeTotal - 1, frameIdx + 1))} style={btnStyle}>▶</button>
        <span style={{ fontSize: 10, color: '#0f08', marginLeft: 20 }}>← → arrow keys</span>
        <span style={{ fontSize: 12, color: hoverCoord ? '#0ff' : '#0f04', marginLeft: 20, minWidth: 120 }}>{hoverCoord || 'hover for coords'}</span>
        <button onClick={() => { const f = saveFolder || newSaveFolder(); saveRecordingJson(recording, f, groundTruth) }} style={{ ...btnStyle, marginLeft: 20 }}>SAVE JSON</button>
        <button onClick={() => { const f = saveFolder || newSaveFolder(); saveGrayFrame(recording, frameIdx, f) }} style={{ ...btnStyle, marginLeft: 8 }}>SAVE IMAGE</button>
        <button onClick={() => saveAllFrames(recording, groundTruth)} style={{ ...btnStyle, marginLeft: 8 }}>SAVE ALL</button>
        <button onClick={async () => {
          const r = await fetch('/save-gray/sessions')
          setSessions(await r.json())
        }} style={{ ...btnStyle, marginLeft: 20 }}>LOAD</button>
        {sessions.length > 0 && (
          <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)} style={{ ...btnStyle, marginLeft: 4 }}>
            <option value="">pick session...</option>
            {sessions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {selectedSession && (
          <button onClick={async () => {
            const result = await loadSession(selectedSession)
            if (result) { setLoadedRec(result.rec); setGroundTruth(result.gt); setFrameIdx(0) }
          }} style={{ ...btnStyle, marginLeft: 4 }}>GO</button>
        )}
        {loadedRec && (
          <button onClick={() => { setLoadedRec(null); setFrameIdx(0) }} style={{ ...btnStyle, marginLeft: 4, color: '#f80' }}>CLEAR</button>
        )}
        <button
          onClick={() => setAnnotateMode(!annotateMode)}
          style={{ ...btnStyle, marginLeft: 20, color: annotateMode ? '#f0f' : '#fff4' }}
        >{annotateMode ? 'ANNOTATING' : 'ANNOTATE'}</button>
        {annotateMode && groundTruth.frames.length > 0 && (
          <span style={{ fontSize: 10, color: '#f0f', marginLeft: 8 }}>{groundTruth.frames.reduce((s, f) => s + f.targets.length, 0)} pts</span>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: '#0f08', maxHeight: 200, overflowY: 'auto', width: 640 }}>
        {activeFrame && activeFrame.tracked.map(t => (
          <div key={t.internalId} style={{ color: t.displayId !== null ? '#ff0' : '#fff4' }}>
            {t.displayId !== null ? `T${t.displayId}` : `#${t.internalId}`}
            {' '} pos={Math.round(t.cx)}x{Math.round(t.cy)} vel={Math.round(t.vx)}x{Math.round(t.vy)} area={t.area} r:{Math.round(t.residualSpeed)} jerk={t.highJerkFrames}
            seen={t.framesSeen} 
            miss={t.missMs.toFixed(0)}ms
          </div>
        ))}
        {groundTruth.frames.find(f => f.frame === frameIdx) && (
          <div style={{ color: '#f0f' }}>
            GT: {groundTruth.frames.find(f => f.frame === frameIdx)!.targets.map(t => `(${t.cx},${t.cy})`).join(' ')}
          </div>
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: '#004400', border: '1px solid #0f04', color: '#0f0',
  padding: '4px 12px', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer',
}