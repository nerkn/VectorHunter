export function dilate(binary: Uint8Array, w: number, h: number, radius: number = 1): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let found = false
      for (let dy = -radius; dy <= radius && !found; dy++) {
        for (let dx = -radius; dx <= radius && !found; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && binary[ny * w + nx]) {
            found = true
          }
        }
      }
      out[y * w + x] = found ? 1 : 0
    }
  }
  return out
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
