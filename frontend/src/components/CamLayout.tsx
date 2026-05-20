import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useCamFrameStore } from '../store/camFrameStore'
import { useGameStore } from '../store/gameStore'

interface Props {
  frames: Record<string, THREE.WebGLRenderTarget> | null
  renderer: THREE.WebGLRenderer | null
  onMainChange?: (main: string) => void
}

const CAM_LABELS: Record<string, string> = {
  overview: 'OVERVIEW',
  left: 'LEFT CAM',
  right: 'RIGHT CAM',
  target: 'TARGET CAM',
  xor: 'XOR STEREO',
}

export default function CamLayout({ frames, renderer, onMainChange }: Props) {
  const [main, setMain] = useState<string>('overview')
  const changeMain = (id: string) => {
    setMain(id)
    onMainChange?.(id)
  }
  const thumbnails = useRef<Record<string, HTMLCanvasElement | null>>({})

  const drawFeeds = useCallback(() => {
    if (!frames || !renderer) return

    for (const [id, rt] of Object.entries(frames)) {
      const canvas = thumbnails.current[id]
      if (!canvas) continue
      const ctx = canvas.getContext('2d')
      if (!ctx) continue

      const w = rt.width
      const h = rt.height
      const pixels = new Uint8Array(w * h * 4)
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels)

      const imageData = new ImageData(w, h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const srcIdx = ((h - 1 - y) * w + x) * 4
          const dstIdx = (y * w + x) * 4
          imageData.data[dstIdx] = pixels[srcIdx]
          imageData.data[dstIdx + 1] = pixels[srcIdx + 1]
          imageData.data[dstIdx + 2] = pixels[srcIdx + 2]
          imageData.data[dstIdx + 3] = pixels[srcIdx + 3]
        }
      }
      canvas.width = w
      canvas.height = h
      ctx.putImageData(imageData, 0, 0)
    }

    const xorCanvas = thumbnails.current['xor']
    if (xorCanvas && frames.left && frames.right) {
      const ctx = xorCanvas.getContext('2d')
      if (ctx) {
        const w = frames.left.width
        const h = frames.left.height
        const leftPx = new Uint8Array(w * h * 4)
        const rightPx = new Uint8Array(w * h * 4)
        renderer.readRenderTargetPixels(frames.left, 0, 0, w, h, leftPx)
        renderer.readRenderTargetPixels(frames.right, 0, 0, w, h, rightPx)

        const img = ctx.createImageData(w, h)
        for (let i = 0; i < leftPx.length; i += 4) {
          img.data[i] = leftPx[i] ^ rightPx[i]
          img.data[i + 1] = leftPx[i + 1] ^ rightPx[i + 1]
          img.data[i + 2] = leftPx[i + 2] ^ rightPx[i + 2]
          img.data[i + 3] = 255
        }
        xorCanvas.width = w
        xorCanvas.height = h
        ctx.putImageData(img, 0, 0)

        useCamFrameStore.getState().setXorFrame({
          pixels: new Uint8Array(img.data),
          w, h,
        })
      }
    }
  }, [frames, renderer])

  useEffect(() => {
    let running = true
    const loop = () => {
      if (running) {
        if (useGameStore.getState().phase === 'playing') drawFeeds()
        requestAnimationFrame(loop)
      }
    }
    loop()
    return () => { running = false }
  }, [drawFeeds])

  const allCams = frames ? [...Object.keys(frames), 'xor'] : []
  const pips = allCams.filter(id => id !== main)

  return (
    <>
      <div data-hud
        onClick={() => changeMain(main)}
        style={{
          position: 'absolute', top: 10, left: 10,
          border: `1px solid ${main === 'xor' ? '#ff08' : '#0f08'}`, borderRadius: 4, overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <div style={{
          background: '#000a', color: main === 'xor' ? '#ff0' : '#0f0', fontSize: 10, padding: '2px 8px',
          fontFamily: 'monospace',
        }}>{CAM_LABELS[main]}</div>
        <canvas
          ref={el => { if (el) thumbnails.current[main] = el }}
          style={{ display: 'block', width: 320, height: 180 }}
        />
      </div>

      <div data-hud style={{
        position: 'absolute', bottom: 50, left: 10,
        display: 'flex', gap: 8,
      }}>
        {pips.map(id => (
          <div
            key={id}
            onClick={() => changeMain(id)}
            style={{
              border: `1px solid ${id === 'xor' ? '#ff04' : '#0f04'}`, borderRadius: 3, overflow: 'hidden',
              cursor: 'pointer', opacity: 0.8,
            }}
          >
            <div style={{
              background: '#000a', color: id === 'xor' ? '#ff0' : '#0f0', fontSize: 9, padding: '1px 6px',
              fontFamily: 'monospace',
            }}>{CAM_LABELS[id]}</div>
            <canvas
              ref={el => { if (el) thumbnails.current[id] = el }}
              style={{ display: 'block', width: 100, height: 60 }}
            />
          </div>
        ))}
      </div>
    </>
  )
}
