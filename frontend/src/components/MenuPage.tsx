import { useGameStore, TargetConfig } from '../store/gameStore'

const MOTIONS: TargetConfig['motion'][] = ['circle', 'figure8', 'line']

function TargetRow({ target, index, onChange, onRemove }: {
  target: TargetConfig
  index: number
  onChange: (i: number, t: TargetConfig) => void
  onRemove: (i: number) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <span style={{ color: '#0f0', fontFamily: 'monospace', fontSize: 11, width: 60 }}>
        T{index + 1}
      </span>

      <select value={target.motion} onChange={e => onChange(index, { ...target, motion: e.target.value as TargetConfig['motion'] })}
        style={selectStyle}>
        {MOTIONS.map(m => <option key={m} value={m}>{m}</option>)}
      </select>

      <input type="number" value={target.speed} onChange={e => onChange(index, { ...target, speed: Number(e.target.value) })}
        style={inputStyle} title="Speed km/h" />
      <span style={labelStyle}>km/h</span>

      <input type="number" value={target.appearanceDelay} onChange={e => onChange(index, { ...target, appearanceDelay: Number(e.target.value) })}
        style={{ ...inputStyle, width: 40 }} title="Appearance delay (sec)" />
      <span style={labelStyle}>delay</span>

      <button onClick={() => onRemove(index)} style={btnSmallStyle}>×</button>
    </div>
  )
}

export default function MenuPage() {
  const sceneName = useGameStore(s => s.sceneName)
  const targets = useGameStore(s => s.targets)
  const setScene = useGameStore(s => s.setScene)
  const setTargets = useGameStore(s => s.setTargets)
  const start = useGameStore(s => s.start)

  const updateTarget = (i: number, t: TargetConfig) => {
    const next = [...targets]
    next[i] = t
    setTargets(next)
  }

  const removeTarget = (i: number) => {
    setTargets(targets.filter((_, idx) => idx !== i))
  }

  const addTarget = () => {
    setTargets([...targets, {
      id: `t${Date.now()}`,
      type: 'drone',
      motion: 'circle',
      speed: 40,
      jitter: 0,
      appearanceDelay: 0,
    }])
  }

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#0a0a0a',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      color: '#0f0', fontFamily: 'monospace',
    }}>
      <h1 style={{ fontSize: 32, marginBottom: 4, letterSpacing: 4 }}>VECTORHUNTER</h1>
      <p style={{ fontSize: 11, color: '#0f06', marginBottom: 30 }}>AUTONOMOUS DRONE PERCEPTION SIMULATOR</p>

      <div style={{ width: 420, marginBottom: 20 }}>
        <label style={labelStyle}>SCENE</label>
        <select value={sceneName} onChange={e => setScene(e.target.value)} style={selectStyle}>
          <option value="openfield">OPEN FIELD</option>
        </select>
      </div>

      <div style={{ width: 420, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={labelStyle}>TARGETS ({targets.length})</span>
          <button onClick={addTarget} style={btnSmallStyle}>+ ADD</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 6, paddingLeft: 60 }}>
          <span style={{ ...labelStyle, width: 80 }}>MOTION</span>
          <span style={{ ...labelStyle, width: 50 }}>SPEED</span>
          <span style={{ ...labelStyle, width: 50 }}>DELAY</span>
        </div>

        {targets.map((t, i) => (
          <TargetRow key={t.id} target={t} index={i} onChange={updateTarget} onRemove={removeTarget} />
        ))}
      </div>

      <button onClick={start} style={{
        background: '#0f0', color: '#000', border: 'none', padding: '12px 48px',
        fontFamily: 'monospace', fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
        letterSpacing: 2, marginTop: 10,
      }}>
        START MISSION
      </button>

      <div style={{ position: 'absolute', bottom: 20, color: '#0f04', fontSize: 10, textAlign: 'center' }}>
        WASD FLY · M TOGGLE MOUSE · SPACE UP · C DOWN · SHIFT BOOST
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  background: '#111', color: '#0f0', border: '1px solid #0f03', padding: '6px 10px',
  fontFamily: 'monospace', fontSize: 12, width: '100%',
}

const inputStyle: React.CSSProperties = {
  background: '#111', color: '#0f0', border: '1px solid #0f03', padding: '4px 8px',
  fontFamily: 'monospace', fontSize: 12, width: 55, textAlign: 'center',
}

const labelStyle: React.CSSProperties = {
  color: '#0f08', fontSize: 10, fontFamily: 'monospace',
}

const btnSmallStyle: React.CSSProperties = {
  background: '#111', color: '#0f0', border: '1px solid #0f03', padding: '2px 10px',
  fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
}
