import { useState, useRef } from 'react'
import { Recording } from '../utils/recorder'

function exportRecording(rec: Recording) {
  const json = {
    params: rec.params,
    frames: rec.frames.map(f => ({
      time: f.time,
      tracked: f.tracked.map(t => ({
        internalId: t.internalId,
        displayId: t.displayId,
        cx: Math.round(t.cx),
        cy: Math.round(t.cy),
        vx: Math.round(t.vx),
        vy: Math.round(t.vy),
        area: t.area,
        framesSeen: t.framesSeen,
        missMs: Math.round(t.missMs),
        residualSpeed: Math.round(t.residualSpeed),
        highJerkFrames: t.highJerkFrames,
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
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const total = recording.frames.length
  const frame = recording.frames[frameIdx]

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

      <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
        {mousePos && <div style={{ fontSize: 11, color: '#0f08', marginTop: 2 }}>{mousePos.x}, {mousePos.y}</div>}
        <button onClick={() => setFrameIdx(Math.max(0, frameIdx - 1))} style={btnStyle}>◀</button>
        <span style={{ fontSize: 12 }}>{frameIdx + 1} / {total}</span>
        <button onClick={() => setFrameIdx(Math.min(total - 1, frameIdx + 1))} style={btnStyle}>▶</button>
        <span style={{ fontSize: 10, color: '#0f08', marginLeft: 20 }}>← → arrow keys</span>
        <button onClick={() => exportRecording(recording)} style={{ ...btnStyle, marginLeft: 20 }}>EXPORT JSON</button>
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
  background: '#111', color: '#0f0', border: '1px solid #0f04',
  padding: '4px 16px', fontFamily: 'monospace', fontSize: 14, cursor: 'pointer',
}
