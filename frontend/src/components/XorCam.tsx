import { useRef, useEffect } from 'react'
import * as THREE from 'three'

interface Props {
  leftRT: THREE.WebGLRenderTarget | null
  rightRT: THREE.WebGLRenderTarget | null
  renderer: THREE.WebGLRenderer | null
}

export default function XorCam({ leftRT, rightRT, renderer }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!leftRT || !rightRT || !renderer) return

    let running = true
    const w = leftRT.width
    const h = leftRT.height
    const leftPx = new Uint8Array(w * h * 4)
    const rightPx = new Uint8Array(w * h * 4)

    const loop = () => {
      if (!running) return

      renderer.readRenderTargetPixels(leftRT, 0, 0, w, h, leftPx)
      renderer.readRenderTargetPixels(rightRT, 0, 0, w, h, rightPx)

      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const img = ctx.createImageData(w, h)
          for (let i = 0; i < leftPx.length; i += 4) {
            img.data[i] = leftPx[i] ^ rightPx[i]
            img.data[i + 1] = leftPx[i + 1] ^ rightPx[i + 1]
            img.data[i + 2] = leftPx[i + 2] ^ rightPx[i + 2]
            img.data[i + 3] = 255
          }
          ctx.putImageData(img, 0, 0)
        }
      }

      requestAnimationFrame(loop)
    }
    loop()

    return () => { running = false }
  }, [leftRT, rightRT, renderer])

  return (
    <div style={{
      position: 'absolute', bottom: 50, right: 10,
      border: '1px solid #ff04', borderRadius: 3, overflow: 'hidden',
    }}>
      <div style={{
        background: '#000a', color: '#ff0', fontSize: 9, padding: '1px 6px',
        fontFamily: 'monospace',
      }}>XOR STEREO</div>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: 160, height: 120 }}
      />
    </div>
  )
}
