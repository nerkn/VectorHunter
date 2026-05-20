const TERRAIN_SIZE = 500

export function getTerrainHeight(x: number, z: number): number {
  let h = 0
  h += Math.sin(x * 0.01 + 0.3) * Math.cos(z * 0.01) * 8
  h += Math.sin(x * 0.025 + 1.5) * Math.cos(z * 0.02 + 0.7) * 4
  h += Math.sin(x * 0.06 + 3.0) * Math.cos(z * 0.05 + 2.0) * 2
  h += Math.sin(x * 0.12) * Math.cos(z * 0.12) * 0.8
  return h
}

export { TERRAIN_SIZE }
