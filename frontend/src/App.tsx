import { useState, useCallback, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import './debug/debugApi'
import Scene from './components/Scene'
import CamLayout from './components/CamLayout'
import HUD from './components/HUD'
import MenuPage from './components/MenuPage'
import PauseOverlay from './components/PauseOverlay'
import TargetOverlay from './components/TargetOverlay'
import Playback from './components/Playback'
import { useFlightControls } from './hooks/useFlightControls'
import { useTelemetry } from './hooks/useTelemetry'
import { pipeline } from './pipeline/FramePipeline'
import { useGameStore } from './store/gameStore'
import { useDetectionStore } from './store/detectionStore'

function Inner() {
  useFlightControls()
  useTelemetry()
  useEffect(() => {
    pipeline.start()
    useDetectionStore.getState().setTracker(pipeline.getTracker())
    return () => pipeline.stop()
  }, [])
  return null
}

function RendererBridge({ onRenderer }: { onRenderer: (gl: THREE.WebGLRenderer) => void }) {
  const { gl } = useThree()
  onRenderer(gl)
  return null
}

export default function App() {
  const phase = useGameStore(s => s.phase)
  const pause = useGameStore(s => s.setPhase)
  const [mainCam, setMainCam] = useState('overview')
  const [frames, setFrames] = useState<Record<string, THREE.WebGLRenderTarget> | null>(null)
  const [renderer, setRenderer] = useState<THREE.WebGLRenderer | null>(null)
  const playback = useDetectionStore(s => s.playback)

  const handleFrames = useCallback((newFrames: Record<string, THREE.WebGLRenderTarget>) => {
    setFrames(newFrames)
  }, [])

  if (phase === 'menu') {
    return <MenuPage />
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Canvas camera={{ fov: 60, near: 0.1, far: 1000 }} shadows="basic">
        <RendererBridge onRenderer={setRenderer} />
        <Inner />
        <Scene onFrames={handleFrames} paused={phase === 'paused'} />
      </Canvas>
      <CamLayout frames={frames} renderer={renderer} onMainChange={setMainCam} />
      <TargetOverlay isMainXor={mainCam === 'xor'} />
      <HUD />
      <button
        data-hud
        onClick={() => pause('paused')}
        style={{
          position: 'absolute', top: 200, left: 10,
          background: '#000a', border: '1px solid #ff08', borderRadius: 3,
          padding: '4px 12px', color: '#ff0', fontFamily: 'monospace', fontSize: 10,
          cursor: 'pointer',
        }}
      >
        PAUSE
      </button>
      <PauseOverlay />
      {playback && <Playback recording={playback} onClose={() => {
        useDetectionStore.getState().setPlayback(null)
        if (useGameStore.getState().phase === 'paused') useGameStore.getState().resume()
      }} />}
      <div style={{
        position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
        color: '#ffffff44', fontFamily: 'monospace', fontSize: 11, textAlign: 'center',
        pointerEvents: 'none', userSelect: 'none',
      }}>
        M TOGGLE MOUSE · WASD FLY · SPACE UP · C DOWN · SHIFT BOOST · ESC PAUSE
      </div>
    </div>
  )
}
