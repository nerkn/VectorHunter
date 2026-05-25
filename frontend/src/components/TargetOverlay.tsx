import { useDetectionStore } from '../store/detectionStore'

interface Props {
  isMainXor: boolean
}

const PREDICT_DT = 0.15

export default function TargetOverlay({ isMainXor }: Props) {
  const tracked = useDetectionStore(s => s.tracked)
  const lockedTarget = useDetectionStore(s => s.lockedTarget)

  if (!isMainXor) return null

  const clamp = (v: number, min = 0, max = 320) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min

  const confirmed = tracked.filter(t => t.displayId !== null && (performance.now() - t.lastSeen) < 200)
  const noiseBlobs = tracked.filter(t => t.displayId === null && (performance.now() - t.lastSeen) < 200)

  return (
    <div style={{
      position: 'absolute', top: 10, left: 10,
      width: 320, height: 180,
      pointerEvents: 'none',
    }}>
      <svg width={320} height={180} style={{ position: 'absolute', top: 0, left: 0 }}>
        {noiseBlobs.map(t => (
          <rect key={t.internalId}
            x={clamp(t.bbox[0] / 2)} y={clamp(t.bbox[1] / 2)}
            width={clamp((t.bbox[2] - t.bbox[0]) / 2)} height={clamp((t.bbox[3] - t.bbox[1]) / 2)}
            stroke="#fff2" strokeWidth={0.5} fill="none"
          />
        ))}
        {confirmed.map(t => {
          const isLocked = t.displayId === lockedTarget
          const cx = t.cx / 2
          const cy = t.cy / 2
          const px = (t.cx + t.vx * PREDICT_DT) / 2
          const py = (t.cy + t.vy * PREDICT_DT) / 2
          return (
            <g key={t.internalId}>
              <rect
                x={clamp(t.bbox[0] / 2)} y={clamp(t.bbox[1] / 2)}
                width={clamp((t.bbox[2] - t.bbox[0]) / 2)} height={clamp((t.bbox[3] - t.bbox[1]) / 2)}
                stroke={isLocked ? '#f00' : '#ff0'} strokeWidth={isLocked ? 1.5 : 0.5} fill="none"
              />
              <line
                x1={cx} y1={cy} x2={px} y2={py}
                stroke={isLocked ? '#f00' : '#ff0'}
                strokeWidth={isLocked ? 2 : 1}
                opacity={0.6}
              />
              <circle
                cx={px} cy={py} r={isLocked ? 3 : 2}
                fill={isLocked ? '#f00' : '#ff0'}
                opacity={0.6}
              />
            </g>
          )
        })}
      </svg>
      {confirmed.map(t => {
        const isLocked = t.displayId === lockedTarget
        return (
          <div key={t.internalId}>
            <div style={{
              position: 'absolute',
              left: t.cx / 2,
              top: t.cy / 2,
              width: 0, height: 0,
            }}>
              <span style={{
                position: 'absolute',
                left: -6, top: -14,
                color: isLocked ? '#f00' : '#ff0',
                fontFamily: 'monospace', fontSize: isLocked ? 14 : 12,
                fontWeight: 'bold',
                textShadow: '0 0 3px #000',
              }}>{isLocked ? `▶T${t.displayId}` : `T${t.displayId}`}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
