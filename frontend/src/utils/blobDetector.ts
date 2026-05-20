export interface Blob {
  id: number
  cx: number
  cy: number
  area: number
  bbox: [number, number, number, number]
  compactness: number
}

export type GridSize = 2 | 4 | 8 | 16 | 32 | 64

interface BlobDetectorConfig {
  gridSize: GridSize
  threshold: number
  minArea: number
  maxArea: number
  roiEnabled: boolean
  roiSize: number
  minCompactness: number
}

const DEFAULT_CONFIG: BlobDetectorConfig = {
  gridSize: 16,
  threshold: 30,
  minArea: 5,
  maxArea: 128,
  roiEnabled: false,
  roiSize: 64,
  minCompactness: 0,
}

export function thresholdImage(pixels: Uint8Array, w: number, h: number, threshold: number): Uint8Array {
  const binary = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = pixels[i * 4]
    const g = pixels[i * 4 + 1]
    const b = pixels[i * 4 + 2]
    binary[i] = (r + g + b) / 3 > threshold ? 1 : 0
  }
  return binary
}

function gridScan(
  binary: Uint8Array, w: number, h: number, gridSize: number
): { cx: number; cy: number; count: number }[] {
  const cellsX = Math.floor(w / gridSize)
  const cellsY = Math.floor(h / gridSize)
  const cells: { cx: number; cy: number; count: number }[] = []

  for (let gy = 0; gy < cellsY; gy++) {
    for (let gx = 0; gx < cellsX; gx++) {
      let count = 0
      let sumX = 0
      let sumY = 0
      for (let dy = 0; dy < gridSize; dy++) {
        for (let dx = 0; dx < gridSize; dx++) {
          const px = gx * gridSize + dx
          const py = gy * gridSize + dy
          if (px < w && py < h && binary[py * w + px]) {
            count++
            sumX += px
            sumY += py
          }
        }
      }
      if (count > 0) {
        cells.push({ cx: sumX / count, cy: sumY / count, count })
      }
    }
  }
  return cells
}

function clusterCells(
  cells: { cx: number; cy: number; count: number }[],
  gridSize: number,
  minArea: number,
  maxArea: number
): Blob[] {
  if (cells.length === 0) return []

  const visited = new Set<number>()
  const blobs: Blob[] = []
  let blobId = 1

  for (let i = 0; i < cells.length; i++) {
    if (visited.has(i)) continue
    visited.add(i)

    const cluster: typeof cells = [cells[i]]
    const queue = [i]

    while (queue.length > 0) {
      const current = queue.shift()!
      for (let j = 0; j < cells.length; j++) {
        if (visited.has(j)) continue
        const dx = Math.abs(cells[current].cx - cells[j].cx)
        const dy = Math.abs(cells[current].cy - cells[j].cy)
        if (dx < gridSize * 1.5 && dy < gridSize * 1.5) {
          visited.add(j)
          cluster.push(cells[j])
          queue.push(j)
        }
      }
    }

    let totalWeight = 0
    let cx = 0
    let cy = 0
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0

    for (const cell of cluster) {
      cx += cell.cx * cell.count
      cy += cell.cy * cell.count
      totalWeight += cell.count
      minX = Math.min(minX, cell.cx - gridSize / 2)
      minY = Math.min(minY, cell.cy - gridSize / 2)
      maxX = Math.max(maxX, cell.cx + gridSize / 2)
      maxY = Math.max(maxY, cell.cy + gridSize / 2)
    }

    const area = Math.round(totalWeight)
    if (area >= minArea && area <= maxArea) {
      blobs.push({
        id: blobId++,
        cx: Math.round(cx / totalWeight),
        cy: Math.round(cy / totalWeight),
        area,
        bbox: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)],
        compactness: 0,
      })
    }
  }

  return blobs
}

function filterByDensity(blobs: Blob[], binary: Uint8Array, w: number, h: number, minCompactness: number): Blob[] {
  if (minCompactness <= 0) return blobs
  return blobs.filter(b => b.compactness >= minCompactness)
}

export function detectBlobs(
  pixels: Uint8Array,
  w: number,
  h: number,
  config: BlobDetectorConfig = DEFAULT_CONFIG,
  previousBlobs: Blob[] = []
): Blob[] {
  const binary = thresholdImage(pixels, w, h, config.threshold)

  if (config.roiEnabled && previousBlobs.length > 0) {
    const roiResults: Blob[] = []
    const fullBlobs = filterByDensity(
      clusterCells(gridScan(binary, w, h, config.gridSize), config.gridSize, config.minArea, config.maxArea),
      binary, w, h, config.minCompactness
    )
    for (const prev of previousBlobs) {
      const half = config.roiSize / 2
      const found = fullBlobs.filter(b =>
        Math.abs(b.cx - prev.cx) < half && Math.abs(b.cy - prev.cy) < half
      )
      roiResults.push(...found)
    }
    return roiResults.length > 0 ? roiResults : fullBlobs
  }

  const cells = gridScan(binary, w, h, config.gridSize)
  return filterByDensity(
    clusterCells(cells, config.gridSize, config.minArea, config.maxArea),
    binary, w, h, config.minCompactness
  )
}

export { DEFAULT_CONFIG }
export type { BlobDetectorConfig }
