import { useTelemetryStore } from '../store/telemetryStore'
import { useTargetStore } from '../store/targetStore'
import { useDroneStore } from '../store/droneStore'
import { isRecording } from '../utils/recorder'
import { useDetectionStore } from '../store/detectionStore'

type PatchMethod = 'ncc' | 'xor'

export default function HUD() {
  const position = useDroneStore(s => s.position)
  const mouseCaptured = useDroneStore(s => s.mouseCaptured)
  const speed = useTelemetryStore(s => s.speed)
  const battery = useTelemetryStore(s => s.battery)
  const fps = useTelemetryStore(s => s.fps)
  const signal = useTelemetryStore(s => s.signal)
  const targets = useTargetStore(s => s.targets)
  const lockedTarget = useDetectionStore(s => s.lockedTarget)
  const tracked = useDetectionStore(s => s.tracked)
  const minArea = useDetectionStore(s => s.minArea)
  const setMinArea = useDetectionStore(s => s.setMinArea)
  const maxArea = useDetectionStore(s => s.maxArea)
  const setMaxArea = useDetectionStore(s => s.setMaxArea)
  const detectionFps = useDetectionStore(s => s.detectionFps)
  const setDetectionFps = useDetectionStore(s => s.setDetectionFps)
  const patchMethod = useDetectionStore(s => s.patchMethod)
  const setPatchMethod = useDetectionStore(s => s.setPatchMethod)
  const slowMode = useDetectionStore(s => s.slowMode)
  const toggleSlowMode = useDetectionStore(s => s.toggleSlowMode)

  const batteryColor = battery > 50 ? '#0f0' : battery > 20 ? '#fa0' : '#f00'
  const signalColor = signal > 60 ? '#0f0' : signal > 30 ? '#fa0' : '#f00'

  return (
    <>
      <div data-hud style={{
        position: 'absolute', top: 10, right: 10,
        background: '#000a', border: '1px solid #0f04', borderRadius: 4,
        padding: '8px 12px', fontFamily: 'monospace', fontSize: 11,
        color: '#0f0', lineHeight: 1.8, pointerEvents: 'auto',
      }}>
        <div>MOUSE <span style={{ float: 'right', color: mouseCaptured ? '#0f0' : '#f00' }}>{mouseCaptured ? 'LOCKED' : 'FREE'}</span></div>
        <div>X <span style={{ float: 'right' }}>{position[0].toFixed(1)}</span></div>
        <div>Y <span style={{ float: 'right' }}>{position[1].toFixed(1)}</span></div>
        <div>Z <span style={{ float: 'right' }}>{position[2].toFixed(1)}</span></div>
        <div>SPD <span style={{ float: 'right' }}>{(speed * 3.6).toFixed(1)}km/h</span></div>
        <div>BAT <span style={{ float: 'right', color: batteryColor }}>{battery.toFixed(0)}%</span></div>
        <div>FPS <span style={{ float: 'right' }}>{fps}</span></div>
        <div>SIG <span style={{ float: 'right', color: signalColor }}>{signal.toFixed(0)}%</span></div>
      </div>

      <div data-hud style={{
        position: 'absolute', bottom: 120, right: 10,
        background: '#000a', border: '1px solid #ff04', borderRadius: 4,
        padding: '6px 10px', fontFamily: 'monospace', fontSize: 10,
        color: '#ff0', lineHeight: 1.6, pointerEvents: 'auto',
        maxHeight: 300, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>DETECTION</div>
        <div>TRACKED <span style={{ float: 'right' }}>{tracked.length}</span></div>
        <div>
          MIN <span style={{ float: 'right' }}>
            {[4, 8, 16, 32, 64].map(v => (
              <span
                key={v}
                onClick={() => setMinArea(v)}
                style={{
                  cursor: 'pointer', marginLeft: 5,
                  color: minArea === v ? '#ff0' : '#ff04',
                  fontWeight: minArea === v ? 'bold' : 'normal',
                }}
              >{v}</span>
            ))}
          </span>
        </div>
        <div>
          MAX <span style={{ float: 'right' }}>
            {[16, 32, 64, 128, 196, 256].map(v => (
              <span
                key={v}
                onClick={() => setMaxArea(v)}
                style={{
                  cursor: 'pointer', marginLeft: 5,
                  color: maxArea === v ? '#ff0' : '#ff04',
                  fontWeight: maxArea === v ? 'bold' : 'normal',
                }}
              >{v}</span>
            ))}
          </span>
        </div>
        <div
          onClick={toggleSlowMode}
          style={{ cursor: 'pointer', color: slowMode ? '#f00' : '#ff04', fontWeight: slowMode ? 'bold' : 'normal' }}
        >SLOW <span style={{ float: 'right' }}>{slowMode ? '1 FPS' : 'OFF'}</span></div>
        <div>
          PATCH <span style={{ float: 'right' }}>
            {(['ncc', 'xor'] as PatchMethod[]).map(v => (
              <span
                key={v}
                onClick={() => setPatchMethod(v)}
                style={{
                  cursor: 'pointer', marginLeft: 5,
                  color: patchMethod === v ? '#f00' : '#ff04',
                  fontWeight: patchMethod === v ? 'bold' : 'normal',
                  textTransform: 'uppercase',
                }}
              >{v}</span>
            ))}
          </span>
        </div>
        <div>
          FPS <span style={{ float: 'right' }}>
            {[2, 4, 6, 8, 12, 16, 18, 20, 24].map(f => (
              <span
                key={f}
                onClick={() => setDetectionFps(f)}
                style={{
                  cursor: 'pointer', marginLeft: 5,
                  color: detectionFps === f ? '#ff0' : '#ff04',
                  fontWeight: detectionFps === f ? 'bold' : 'normal',
                }}
              >{f}</span>
            ))}
          </span>
        </div>

        <div style={{ overflowY: 'auto', height: 120, flexShrink: 0, marginTop: 4 }}>
        {tracked.filter(t => t.displayId !== null).map(b => {
          const isActive = (performance.now() - b.lastSeen) < 200
          const isLocked = b.displayId === lockedTarget
          return (
            <div key={b.internalId} style={{ color: isLocked ? '#f00' : !isActive ? '#ff04' : '#ff0' }}>
              T{b.displayId} <span style={{ float: 'right' }}>{Math.round(b.cx)}x{Math.round(b.cy)} a:{b.area} v:{Math.round(Math.sqrt(b.vx*b.vx+b.vy*b.vy))}</span>
            </div>
          )
        })}
        <div style={{ color: '#fff3', marginTop: 4 }}>noise: {tracked.filter(t => t.displayId === null).length}</div>
        {tracked.filter(t => t.displayId === null).slice(0, 8).map(b => (
          <div key={b.internalId} style={{ color: '#333', fontSize: 9 }}>
            #{b.internalId} {Math.round(b.cx)}x{Math.round(b.cy)} v:{Math.round(Math.sqrt(b.vx*b.vx+b.vy*b.vy))} r:{Math.round(b.residualSpeed)}
          </div>
        ))}
        {isRecording() && <div style={{ color: '#f00', marginTop: 4 }}>● REC</div>}
        </div>
      </div>

      <div data-hud style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 12, pointerEvents: 'auto',
      }}>
        {targets.map(t => (
          <div key={t.id} style={{
            background: '#000a', border: `1px solid ${t.color}4`, borderRadius: 4,
            padding: '4px 10px', fontFamily: 'monospace', fontSize: 10,
            color: t.color, lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 'bold' }}>{t.id.toUpperCase()}</div>
            <div>X {(t.position[0]).toFixed(1)}km/h</div>
            <div>Y {(t.position[1]).toFixed(1)}km/h</div>
            <div>Z {(t.position[2]).toFixed(1)}km/h</div>
            <div>SPD {(t.speed * 3.6).toFixed(1)}km/h</div>
            <div>ALT {t.altitude.toFixed(1)}m</div>
          </div>
        ))}
      </div>
    </>
  )
}