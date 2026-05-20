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
