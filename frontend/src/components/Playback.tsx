import { useState, useRef, useCallback } from 'react'
import { Recording } from '../utils/recorder'

function exportRecording(rec: Recording) {
  const json = {
    params: rec.params,
    frames: rec.frames.map(f => ({
      time: f.time,
      rawBlobs: f.rawBlobs,
      tracked: f.tracked.map(t => ({
        internalId: t.internalId,
        displayId: t.displayId,
        cx: Math.round(t.cx),
        cy: Math.round(t.cy),
        vx: Math.round(t.vx),
        vy: Math.round(t.vy),
        area: t.area,
        framesSeen: t.framesSeen,
        lastSeen: t.lastSeen,
        missMs: Math.round(f.time - t.lastSeen),
      })),
    })),
  }
  console.log(JSON.stringify(json, null, 2))
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `recording_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  recording: Recording
  onClose: () => void
}

export default function Playback({ recording, onClose }: Props) {
  const [frameIdx, setFrameIdx] = useState(0)
  const [mousePos, setMousePos] = useState<{x: number, y: number} | null>(null)
  const canvasElRef = useRef<HTMLCanvasElement | null>(null)
  const total = recording.frames.length
  const frame = recording.frames[frameIdx]

  const drawXor = (canvas: HTMLCanvasElement | null) => {
    if (!canvas || !frame) return
    canvasElRef.current = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(frame.xorImage, 0, 0)

    for (const b of frame.rawBlobs) {
      ctx.strokeStyle = '#00ff0066'
      ctx.strokeRect(b.bbox[0], b.bbox[1], b.bbox[2] - b.bbox[0], b.bbox[3] - b.bbox[1])
      ctx.fillStyle = '#00ff0066'
      ctx.beginPath()
      ctx.arc(b.cx, b.cy, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    for (const t of frame.tracked) {
      const isActive = (frame.time - t.lastSeen) < 200
      const color = t.merged ? '#ff0000' : t.displayId !== null ? '#ffff00' : '#ffffff44'
      ctx.strokeStyle = color
      ctx.strokeRect(t.bbox[0], t.bbox[1], t.bbox[2] - t.bbox[0], t.bbox[3] - t.bbox[1])

      if (t.displayId !== null) {
        ctx.fillStyle = color
        ctx.font = '12px monospace'
        ctx.fillText(`T${t.displayId}`, t.cx + 4, t.cy - 4)
      }

      if (isActive) {
        const dt = 0.15
        const px = t.cx + t.vx * dt
        const py = t.cy + t.vy * dt
        ctx.beginPath()
        ctx.moveTo(t.cx, t.cy)
        ctx.lineTo(px, py)
        ctx.strokeStyle = t.merged ? '#ff000088' : '#ffff0088'
        ctx.stroke()
      }
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: '#000e', zIndex: 100, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#0f0',
    }}>
      <div style={{ position: 'absolute', top: 10, right: 10, cursor: 'pointer', fontSize: 20 }} onClick={onClose}>✕</div>

      <div style={{ fontSize: 12, marginBottom: 8 }}>
        PARAMS: min={recording.params.minArea} max={recording.params.maxArea} thr={recording.params.threshold} grid={recording.params.gridSize} fps={recording.params.detectionFps}
      </div>

      <canvas
        ref={drawXor}
        width={frame?.xorImage.width ?? 640}
        height={frame?.xorImage.height ?? 480}
        style={{ border: '1px solid #0f04', imageRendering: 'pixelated', cursor: 'crosshair' }}
        onMouseMove={e => {
          const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
          const scaleX = (frame?.xorImage.width ?? 640) / rect.width
          const scaleY = (frame?.xorImage.height ?? 480) / rect.height
          setMousePos({
            x: Math.round((e.clientX - rect.left) * scaleX),
            y: Math.round((e.clientY - rect.top) * scaleY),
          })
        }}
        onMouseLeave={() => setMousePos(null)}
      />

      <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
      {mousePos && <div style={{ fontSize: 11, color: '#0f08', marginTop: 2 }}>{mousePos.x}, {mousePos.y}</div>}
        <button onClick={() => setFrameIdx(Math.max(0, frameIdx - 1))} style={btnStyle}>◀</button>
        <span style={{ fontSize: 12 }}>{frameIdx + 1} / {total}</span>
        <button onClick={() => setFrameIdx(Math.min(total - 1, frameIdx + 1))} style={btnStyle}>▶</button>
        <span style={{ fontSize: 10, color: '#0f08', marginLeft: 20 }}>← → arrow keys</span>
        <button onClick={() => exportRecording(recording)} style={{ ...btnStyle, marginLeft: 20 }}>EXPORT JSON</button>
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: '#0f08', maxHeight: 120, overflowY: 'auto', width: 640 }}>
        {frame && frame.tracked.map(t => (
          <div key={t.internalId} style={{ color: t.merged ? '#f00' : t.displayId !== null ? '#ff0' : '#fff4' }}>
            {t.displayId !== null ? `T${t.displayId}` : `#${t.internalId}`}
            {' '} pos={Math.round(t.cx)}x{Math.round(t.cy)} vel={Math.round(t.vx)}x{Math.round(t.vy)} area={t.area}
            miss={((frame.time - t.lastSeen) / 1000).toFixed(2)}s
          </div>
        ))}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: '#111', color: '#0f0', border: '1px solid #0f04',
  padding: '4px 16px', fontFamily: 'monospace', fontSize: 14, cursor: 'pointer',
}
