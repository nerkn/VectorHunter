import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useDroneStore } from '../store/droneStore'

const OFFSET = new THREE.Vector3(0, 4, 10)
const LERP_SPEED = 4
const LOOK_HEIGHT = 1

export default function FollowCamera() {
  const { camera } = useThree()

  useFrame((_, dt) => {
    const { position, yaw, pitch } = useDroneStore.getState()

    const offset = OFFSET.clone()
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    offset.y += pitch * -3

    const targetPos = new THREE.Vector3(...position).add(offset)
    camera.position.lerp(targetPos, 1 - Math.exp(-LERP_SPEED * dt))

    const lookTarget = new THREE.Vector3(...position)
    lookTarget.y += LOOK_HEIGHT
    camera.lookAt(lookTarget)
  })

  return null
}
