import { useRef, forwardRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTargetStore } from '../store/targetStore'
import { useGameStore } from '../store/gameStore'
import { useDetectionStore } from '../store/detectionStore'

type Behavior = 'circle' | 'figure8' | 'line'

const D = 0.55 * 0.707
const rotorPositions: [number, number, number][] = [
  [D, 0.08, D], [-D, 0.08, D], [D, 0.08, -D], [-D, 0.08, -D],
]

function Rotor({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, rawDt) => { if (ref.current && useGameStore.getState().phase === 'playing') ref.current.rotation.y += (useDetectionStore.getState().slowMode ? 1/60 : rawDt) * 40 })
  return (
    <mesh ref={ref} position={position}>
      <cylinderGeometry args={[0.3, 0.3, 0.02, 16]} />
      <meshStandardMaterial color="#222" transparent opacity={0.6} />
    </mesh>
  )
}

interface Props {
  id: string
  behavior: Behavior
  color: string
  startPosition: [number, number, number]
  speed: number
}

const CIRCLE_MAX_HEADING = Math.PI / 3  // 60°. Heading oscillates ±60° for figure8, stays <60° for circle
const CIRCLE_TURN_RATE = 0.5         // rad/s. At 11 m/s → radius 22m, diameter 44m. At 40 m/s → radius 80m.
const FIGURE8_HALF_PERIOD = 2.5 // seconds for one lobe (full cycle = 10s)
const LINE_HALF_LENGTH = 120

const _vel = new THREE.Vector3()

const TargetDrone = forwardRef<THREE.Group, Props>(({ id, behavior, color, startPosition, speed }, fwdRef) => {
  const localRef = useRef<THREE.Group>(null)
  const heading = useRef(0)
  const pos = useRef(new THREE.Vector3(...startPosition))
  const time = useRef(0)
  const initialized = useRef(false)

  const speedMs = speed

  useFrame((_, rawDt) => {
    if (useGameStore.getState().phase !== 'playing') return
    const dt = useDetectionStore.getState().slowMode ? 1 / 60 : rawDt
    const group = localRef.current
    if (!group) return

    if (!initialized.current) {
      pos.current.set(...startPosition)
      initialized.current = true
    }

    time.current += dt

    let turnRate = 0
    if (behavior === 'circle') {
      // Constant-turn circle: heading increases at fixed rate.
      // Speed = 11 m/s, turnRate = 0.5 → radius = 22m, circumference ≈ 138m, one lap ≈ 12.5s
      turnRate = CIRCLE_TURN_RATE
    } else if (behavior === 'figure8') {
      // Figure8: heading oscillates ±60° creating left-right weaving
      // This creates a figure8 pattern as the target weaves left and right
      const omega = Math.PI / FIGURE8_HALF_PERIOD
      heading.current = Math.sin(time.current * omega) * CIRCLE_MAX_HEADING
      turnRate = 0
    } else {
      const dx = pos.current.x - startPosition[0]
      const dz = pos.current.z - startPosition[2]
      const dist = Math.sqrt(dx * dx + dz * dz)
      const dotForward = dx * Math.sin(heading.current) + dz * Math.cos(heading.current)
      if (dist > LINE_HALF_LENGTH && dotForward > 0) {
        turnRate = CIRCLE_TURN_RATE * 3
      }
    }

    heading.current += turnRate * dt

    _vel.set(Math.sin(heading.current), 0, Math.cos(heading.current)).multiplyScalar(speedMs)
    pos.current.add(_vel.clone().multiplyScalar(dt))

    const wobbleY = startPosition[1] + Math.sin(time.current * 1.5) * 2
    group.position.set(pos.current.x, wobbleY, pos.current.z)
    group.rotation.y = heading.current

    useTargetStore.getState().updateTarget(id, {
      position: [group.position.x, group.position.y, group.position.z],
      speed: speedMs,
      altitude: group.position.y,
    })
  })

  return (
    <group ref={(node) => {
      (localRef as React.MutableRefObject<THREE.Group | null>).current = node
      if (typeof fwdRef === 'function') fwdRef(node)
      else if (fwdRef) (fwdRef as React.MutableRefObject<THREE.Group | null>).current = node
    }}>
      <mesh>
        <boxGeometry args={[0.5, 0.12, 0.5]} />
        <meshStandardMaterial color={color} metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[1.3, 0.04, 0.06]} />
        <meshStandardMaterial color="#444" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh rotation={[0, -Math.PI / 4, 0]}>
        <boxGeometry args={[1.3, 0.04, 0.06]} />
        <meshStandardMaterial color="#444" metalness={0.5} roughness={0.4} />
      </mesh>
      {rotorPositions.map((p, i) => <Rotor key={i} position={p} />)}
      <pointLight position={[0, -0.2, 0]} color={color} intensity={0.5} distance={5} />
    </group>
  )
})

export default TargetDrone