import { useMemo } from 'react'
import * as THREE from 'three'
import { getTerrainHeight, TERRAIN_SIZE } from '../utils/terrain'

const SEGMENTS = 128

export default function Terrain() {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      pos.setY(i, getTerrainHeight(x, z))
    }
    geo.computeVertexNormals()
    return geo
  }, [])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color="#3d4f2f" flatShading />
    </mesh>
  )
}
