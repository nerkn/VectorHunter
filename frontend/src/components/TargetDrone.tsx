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

const CIRCLE_RADIUS = 25
const FIGURE8_HALF_PERIOD = 2.5
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
    const t = time.current

    let px: number, py: number, pz: number, hdg: number
    const wobbleY = Math.sin(t * 1.5) * 1.5

    if (behavior === 'circle') {
      const omega = speedMs / CIRCLE_RADIUS
      const angle = omega * t
      px = startPosition[0] + CIRCLE_RADIUS * Math.cos(angle)
      pz = startPosition[2] + CIRCLE_RADIUS * Math.sin(angle)
      hdg = angle + Math.PI / 2
    } else if (behavior === 'figure8') {
      const omega = Math.PI / FIGURE8_HALF_PERIOD
      px = startPosition[0] + CIRCLE_RADIUS * Math.sin(t * omega)
      pz = startPosition[2] + CIRCLE_RADIUS * Math.sin(t * omega * 2) / 2
      hdg = Math.atan2(
        CIRCLE_RADIUS * Math.cos(t * omega) * omega,
        CIRCLE_RADIUS * Math.cos(t * omega * 2) * omega
      )
    } else {
      px = pos.current.x
      pz = pos.current.z
      const dx = px - startPosition[0]
      const dz = pz - startPosition[2]
      const dist = Math.sqrt(dx * dx + dz * dz)
      const dotForward = dx * Math.sin(heading.current) + dz * Math.cos(heading.current)
      if (dist > LINE_HALF_LENGTH && dotForward > 0) {
        heading.current += 1.5 * dt
      } else if (dist > LINE_HALF_LENGTH * 0.95 && dotForward > 0) {
        heading.current += 1.5 * dt * ((dist - LINE_HALF_LENGTH * 0.95) / (LINE_HALF_LENGTH * 0.05))
      }
      hdg = heading.current
      _vel.set(Math.sin(hdg), 0, Math.cos(hdg)).multiplyScalar(speedMs)
      pos.current.add(_vel.clone().multiplyScalar(dt))
      px = pos.current.x
      pz = pos.current.z
    }

    py = startPosition[1] + wobbleY

    if (behavior !== 'line') {
      pos.current.set(px, py, pz)
    } else {
      pos.current.set(px, py, pz)
    }
    heading.current = hdg

    group.position.set(pos.current.x, pos.current.y, pos.current.z)
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