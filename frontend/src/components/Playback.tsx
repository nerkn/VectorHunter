import { useState, useRef, useEffect } from 'react'
import { Recording } from '../utils/recorder'

const HEX = '0123456789ABCDEF'

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

function saveGrayFrame(rec: Recording, idx: number) {
  const fr = rec.frames[idx]
  if (!fr) return
  const w = fr.xorImage.width
  const h = fr.xorImage.height
  const gray = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    gray[i] = fr.xorImage.data[i * 4]
  }
  const filename = `frame_${String(idx).padStart(4, '0')}_${w}x${h}.gray`
  fetch('/save-gray', {
    method: 'POST',
    headers: { 'x-filename': filename },
    body: gray,
  }).then(() => console.log('saved', filename))
}

function saveRecordingJson(rec: Recording) {
  const json = {
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
  const data = new TextEncoder().encode(JSON.stringify(json, null, 2))
  const filename = `recording_${Date.now()}.json`
  fetch('/save-gray', {
    method: 'POST',
    headers: { 'x-filename': filename },
    body: data,
  }).then(() => console.log('saved', filename))
}

function saveAllFrames(rec: Recording) {
  const w = rec.frames[0]?.xorImage.width ?? 640
  const h = rec.frames[0]?.xorImage.height ?? 480
  
  for (let i = 0; i < rec.frames.length; i++) {
    const fr = rec.frames[i]
    const gray = new Uint8Array(w * h)
    for (let j = 0; j < w * h; j++) {
      gray[j] = fr.xorImage.data[j * 4]
    }
    const filename = `frame_${String(i).padStart(4, '0')}_${w}x${h}.gray`
    fetch('/save-gray', {
      method: 'POST',
      headers: { 'x-filename': filename },
      body: gray,
    }).then(() => console.log('saved', filename))
  }
  
  saveRecordingJson(rec)
}

interface Props {
  recording: Recording
  onClose: () => void
}

export default function Playback({ recording, onClose }: Props) {
  const [frameIdx, setFrameIdx] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hoverCoord, setHoverCoord] = useState<string>('')
  const [copiedFlash, setCopiedFlash] = useState(false)
  const total = recording.frames.length
  const frame = recording.frames[frameIdx]

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
    if (!canvasRef.current || !frame) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    ctx.putImageData(frame.xorImage, 0, 0)

    for (const t of frame.tracked) {
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
  }, [frame, frameIdx])

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
        width={frame?.xorImage.width ?? 640}
        height={frame?.xorImage.height ?? 480}
        style={{ border: copiedFlash ? '2px solid #ff0' : '1px solid #0f04', imageRendering: 'pixelated', cursor: 'crosshair' }}
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect()
          const sx = (e.currentTarget.width) / r.width
          const sy = (e.currentTarget.height) / r.height
          const px = Math.floor((e.clientX - r.left) * sx)
          const py = Math.floor((e.clientY - r.top) * sy)
          if (frame) {
            const i = (py * frame.xorImage.width + px) * 4
            const v = frame.xorImage.data[i]
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
          navigator.clipboard.writeText(`${px},${py}`)
          setCopiedFlash(true)
          setTimeout(() => setCopiedFlash(false), 200)
        }}
      />

      <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={() => setFrameIdx(Math.max(0, frameIdx - 1))} style={btnStyle}>◀</button>
        <span style={{ fontSize: 12 }}>{frameIdx + 1} / {total}</span>
        <button onClick={() => setFrameIdx(Math.min(total - 1, frameIdx + 1))} style={btnStyle}>▶</button>
        <span style={{ fontSize: 10, color: '#0f08', marginLeft: 20 }}>← → arrow keys</span>
        <span style={{ fontSize: 12, color: hoverCoord ? '#0ff' : '#0f04', marginLeft: 20, minWidth: 120 }}>{hoverCoord || 'hover for coords'}</span>
        <button onClick={() => saveRecordingJson(recording)} style={{ ...btnStyle, marginLeft: 20 }}>SAVE JSON</button>
        <button onClick={() => saveGrayFrame(recording, frameIdx)} style={{ ...btnStyle, marginLeft: 8 }}>SAVE IMAGE</button>
        <button onClick={() => saveAllFrames(recording)} style={{ ...btnStyle, marginLeft: 8 }}>SAVE ALL</button>
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: '#0f08', maxHeight: 200, overflowY: 'auto', width: 640 }}>
        {frame && frame.tracked.map(t => (
          <div key={t.internalId} style={{ color: t.displayId !== null ? '#ff0' : '#fff4' }}>
            {t.displayId !== null ? `T${t.displayId}` : `#${t.internalId}`}
            {' '} pos={Math.round(t.cx)}x{Math.round(t.cy)} vel={Math.round(t.vx)}x{Math.round(t.vy)} area={t.area} r:{Math.round(t.residualSpeed)} hj:{t.highJerkFrames}
            miss={t.missMs.toFixed(0)}ms
          </div>
        ))}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: '#004400', border: '1px solid #0f04', color: '#0f0',
  padding: '4px 12px', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer',
}