import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useDroneStore } from '../store/droneStore'

interface Props {
  targetRef: React.RefObject<THREE.Group>
  renderTarget: THREE.WebGLRenderTarget
}

export default function TargetCam({ targetRef, renderTarget }: Props) {
  const ref = useRef<THREE.PerspectiveCamera>(null)
  const { scene } = useThree()

  useFrame(({ gl }) => {
    if (!ref.current || !targetRef.current) return

    const targetWorldPos = new THREE.Vector3()
    targetRef.current.getWorldPosition(targetWorldPos)

    const dronePos = new THREE.Vector3(...useDroneStore.getState().position)
    ref.current.position.copy(targetWorldPos)
    ref.current.lookAt(dronePos)

    gl.setRenderTarget(renderTarget)
    gl.render(scene, ref.current)
    gl.setRenderTarget(null)
  })

  return <perspectiveCamera ref={ref} fov={60} />
}
