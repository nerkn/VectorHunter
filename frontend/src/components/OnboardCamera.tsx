import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useDroneStore } from '../store/droneStore'

interface Props {
  offset: [number, number, number]
  renderTarget: THREE.WebGLRenderTarget
}

export default function OnboardCamera({ offset, renderTarget }: Props) {
  const ref = useRef<THREE.PerspectiveCamera>(null)
  const { scene } = useThree()

  useFrame(({ gl }) => {
    if (!ref.current) return
    const { position, yaw } = useDroneStore.getState()
    const worldPos = new THREE.Vector3(...offset)
    worldPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    worldPos.add(new THREE.Vector3(...position))
    ref.current.position.copy(worldPos)

    const lookDir = new THREE.Vector3(0, 0, -1)
    lookDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    ref.current.lookAt(worldPos.clone().add(lookDir))

    gl.setRenderTarget(renderTarget)
    gl.render(scene, ref.current)
    gl.setRenderTarget(null)
  })

  return <perspectiveCamera ref={ref} fov={60} />
}