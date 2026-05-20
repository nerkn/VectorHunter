import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useDroneStore } from '../store/droneStore'
import { useGameStore } from '../store/gameStore'

function Rotor({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (ref.current && useGameStore.getState().phase === 'playing') ref.current.rotation.y += dt * 40
  })
  return (
    <mesh ref={ref} position={position}>
      <cylinderGeometry args={[0.3, 0.3, 0.02, 16]} />
      <meshStandardMaterial color="#222" transparent opacity={0.6} />
    </mesh>
  )
}

const ROTOR_D = 0.55 * 0.707
const ROTOR_Y = 0.08

const rotorPositions: [number, number, number][] = [
  [ROTOR_D, ROTOR_Y, ROTOR_D],
  [-ROTOR_D, ROTOR_Y, ROTOR_D],
  [ROTOR_D, ROTOR_Y, -ROTOR_D],
  [-ROTOR_D, ROTOR_Y, -ROTOR_D],
]

export default function DroneModel() {
  const ref = useRef<THREE.Group>(null)

  useFrame(() => {
    if (!ref.current) return
    if (useGameStore.getState().phase !== 'playing') return
    const { position, yaw, velocity } = useDroneStore.getState()

    ref.current.position.set(...position)

    const tiltFactor = 0.02
    const roll = -velocity[0] * tiltFactor
    const tiltPitch = velocity[2] * tiltFactor

    ref.current.rotation.set(tiltPitch, yaw, roll)
  })

  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[0.5, 0.12, 0.5]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.3} />
      </mesh>

      <mesh rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[1.3, 0.04, 0.06]} />
        <meshStandardMaterial color="#444" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh rotation={[0, -Math.PI / 4, 0]}>
        <boxGeometry args={[1.3, 0.04, 0.06]} />
        <meshStandardMaterial color="#444" metalness={0.5} roughness={0.4} />
      </mesh>

      {rotorPositions.map((pos, i) => (
        <Rotor key={i} position={pos} />
      ))}

      <mesh position={[0, -0.1, 0.2]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color="#111" metalness={0.5} />
      </mesh>

      <pointLight position={[0, -0.2, 0]} color="#00ff44" intensity={0.3} distance={3} />
    </group>
  )
}
