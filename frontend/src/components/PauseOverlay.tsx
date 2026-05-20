import { useGameStore } from '../store/gameStore'
import { useTargetStore } from '../store/targetStore'

export default function PauseOverlay() {
  const phase = useGameStore(s => s.phase)
  const resume = useGameStore(s => s.resume)
  const quit = useGameStore(s => s.quit)
  const targets = useTargetStore(s => s.targets)

  if (phase !== 'paused') return null

  const activeTargets = targets.filter(t => t.active).length
  const pendingTargets = targets.filter(t => !t.active).length
  const allGone = activeTargets === 0 && pendingTargets === 0

  return (
    <div style={{
      position: 'absolute', inset: 0, background: '#000a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100,
    }}>
      <div style={{
        background: '#111', border: '1px solid #0f04', borderRadius: 6,
        padding: '30px 40px', fontFamily: 'monospace', color: '#0f0',
        textAlign: 'center', minWidth: 300,
      }}>
        <h2 style={{ margin: '0 0 16px', letterSpacing: 2 }}>MISSION PAUSED</h2>

        <div style={{ fontSize: 11, color: '#0f08', marginBottom: 20 }}>
          <div>TARGETS ACTIVE: {activeTargets}</div>
          {pendingTargets > 0 && <div>PENDING: {pendingTargets}</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={resume} style={btnStyle('#0f0', '#000')}>
            RESUME MISSION
          </button>

          {allGone && (
            <button onClick={quit} style={btnStyle('#ff0', '#000')}>
              RETURN TO MENU
            </button>
          )}

          <button onClick={quit} style={btnStyle('#f00', '#000')}>
            ABORT MISSION
          </button>
        </div>
      </div>
    </div>
  )
}

function btnStyle(color: string, bg: string): React.CSSProperties {
  return {
    background: bg, color, border: `1px solid ${color}`, padding: '10px 20px',
    fontFamily: 'monospace', fontSize: 13, cursor: 'pointer', letterSpacing: 1,
  }
}
