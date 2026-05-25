import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sky } from '@react-three/drei'
import * as THREE from 'three'
import { useDroneStore } from '../store/droneStore'
import { useTargetStore } from '../store/targetStore'
import { useDetectionStore } from '../store/detectionStore'
import { useGameStore } from '../store/gameStore'
import { getTerrainHeight } from '../utils/terrain'
import Terrain from './Terrain'
import DroneModel from './DroneModel'
import FollowCamera from './FollowCamera'
import OnboardCamera from './OnboardCamera'
import TargetDrone from './TargetDrone'
import TargetCam from './TargetCam'

export default function Scene({ onFrames, paused }: { onFrames: (frames: Record<string, THREE.WebGLRenderTarget>) => void, paused: boolean }) {
  const update = useDroneStore(s => s.update)
  const setPosition = useDroneStore(s => s.setPosition)
  const targets = useTargetStore(s => s.targets)
  const activateTarget = useTargetStore(s => s.activateTarget)
  const gameTargets = useGameStore(s => s.targets)

  const leftRT = useMemo(() => new THREE.WebGLRenderTarget(640, 480), [])
  const rightRT = useMemo(() => new THREE.WebGLRenderTarget(640, 480), [])
  const overviewRT = useMemo(() => new THREE.WebGLRenderTarget(640, 360), [])
  const targetRT = useMemo(() => new THREE.WebGLRenderTarget(640, 480), [])

  const alphaRef = useRef<THREE.Group>(null)
  const startTime = useRef(0)
  const initialized = useRef(false)

  const gameTargetIds = useGameStore(s => s.targets.map(t => t.id + ':' + t.motion + ':' + t.speed).join(','))
  const gamePhase = useGameStore(s => s.phase)

  useEffect(() => {
    if (gamePhase === 'playing') {
      const configs = useGameStore.getState().targets
      if (configs.length === 0) return
      useTargetStore.getState().initFromConfig(configs)
      startTime.current = performance.now() / 1000
      initialized.current = true
    }
  }, [gameTargetIds, gamePhase])

  useFrame((_, dt) => {
    if (!initialized.current || paused) return
    const scaledDt = useDetectionStore.getState().slowMode ? 1 / 60 : Math.min(dt, 0.05)
    update(scaledDt)

    const pos = useDroneStore.getState().position
    const groundY = getTerrainHeight(pos[0], pos[2]) + 1.5
    if (pos[1] < groundY) {
      setPosition([pos[0], groundY, pos[2]])
    }

    const elapsed = performance.now() / 1000 - startTime.current
    for (const t of useTargetStore.getState().targets) {
      if (!t.active && t.appearanceDelay > 0 && elapsed >= t.appearanceDelay) {
        activateTarget(t.id)
      }
    }

    onFrames({ left: leftRT, right: rightRT, overview: overviewRT, target: targetRT })
  })

  return (
    <>
      <Sky sunPosition={[100, 60, 100]} turbidity={8} rayleigh={2} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 100, 50]} intensity={1.2} castShadow />
      <hemisphereLight args={['#87CEEB', '#3d4f2f', 0.3]} />
      <fog attach="fog" args={['#c9dfe8', 80, 350]} />

      <Terrain />
      <DroneModel />
      <FollowCamera />

      <OnboardCamera offset={[-0.25, -0.05, -0.6]} renderTarget={leftRT} />
      <OnboardCamera offset={[0.25, -0.05, -0.6]} renderTarget={rightRT} />

      {targets.filter(t => t.active).map((t, i) => {
        const config = gameTargets.find(g => g.id === t.id)
        return (
          <TargetDrone
            key={t.id}
            id={t.id}
            behavior={t.behavior}
            color={t.color}
            startPosition={[40 - i * 30, 20 + i * 5, i * 20]}
            speed={config?.speed ?? 40}
            ref={i === 0 ? alphaRef : undefined}
          />
        )
      })}
      <TargetCam targetRef={alphaRef as React.RefObject<THREE.Group>} renderTarget={targetRT} />
    </>
  )
}