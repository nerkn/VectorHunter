import { useRef, forwardRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTargetStore } from '../store/targetStore'
import { useGameStore } from '../store/gameStore'

type Behavior = 'circle' | 'figure8' | 'line'

const D = 0.55 * 0.707
const rotorPositions: [number, number, number][] = [
  [D, 0.08, D], [-D, 0.08, D], [D, 0.08, -D], [-D, 0.08, -D],
]

function Rotor({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => { if (ref.current && useGameStore.getState().phase === 'playing') ref.current.rotation.y += dt * 40 })
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

const CIRCLE_TURN_RATE = 0.5
const FIGURE8_TURN_PERIOD = 4
const LINE_HALF_LENGTH = 60

const _dir = new THREE.Vector3()
const _vel = new THREE.Vector3()

const TargetDrone = forwardRef<THREE.Group, Props>(({ id, behavior, color, startPosition, speed }, fwdRef) => {
  const localRef = useRef<THREE.Group>(null)
  const heading = useRef(0)
  const pos = useRef(new THREE.Vector3(...startPosition))
  const time = useRef(0)
  const initialized = useRef(false)

  const speedMs = speed / 3.6

  useFrame((_, dt) => {
    if (useGameStore.getState().phase !== 'playing') return
    const group = localRef.current
    if (!group) return

    if (!initialized.current) {
      pos.current.set(...startPosition)
      initialized.current = true
    }

    time.current += dt

    let turnRate = 0
    if (behavior === 'circle') {
      turnRate = CIRCLE_TURN_RATE
    } else if (behavior === 'figure8') {
      turnRate = Math.sin(time.current * (2 * Math.PI / FIGURE8_TURN_PERIOD)) * CIRCLE_TURN_RATE * 2
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
