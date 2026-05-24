import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { pipeline } from '../pipeline/FramePipeline'

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

  const camPixelsRef = useRef<Uint8Array>(new Uint8Array(0))
  const leftPxRef = useRef<Uint8Array>(new Uint8Array(0))
  const rightPxRef = useRef<Uint8Array>(new Uint8Array(0))
  const xorImageDataRef = useRef<ImageData | null>(null)
  const thumbImageDataRef = useRef<Record<string, ImageData>>({})

  const drawFeeds = useCallback(() => {
    if (!frames || !renderer) return

    let maxW = 0, maxH = 0
    for (const rt of Object.values(frames)) {
      if (rt.width > maxW) maxW = rt.width
      if (rt.height > maxH) maxH = rt.height
    }
    const n4 = maxW * maxH * 4
    if (camPixelsRef.current.length !== n4) {
      camPixelsRef.current = new Uint8Array(n4)
    }

    const px = camPixelsRef.current

    if (frames.left && frames.right) {
      const w = frames.left.width
      const h = frames.left.height
      const lr4 = w * h * 4
      if (leftPxRef.current.length !== lr4) {
        leftPxRef.current = new Uint8Array(lr4)
        rightPxRef.current = new Uint8Array(lr4)
      }
      renderer.readRenderTargetPixels(frames.left, 0, 0, w, h, leftPxRef.current)
      renderer.readRenderTargetPixels(frames.right, 0, 0, w, h, rightPxRef.current)
      pipeline.feed(leftPxRef.current, rightPxRef.current, w, h)
    }

    for (const [id, rt] of Object.entries(frames)) {
      const canvas = thumbnails.current[id]
      if (!canvas) continue
      const ctx = canvas.getContext('2d')
      if (!ctx) continue

      const w = rt.width
      const h = rt.height

      if (id === 'left') {
        px.set(leftPxRef.current.subarray(0, w * h * 4))
      } else if (id === 'right') {
        px.set(rightPxRef.current.subarray(0, w * h * 4))
      } else {
        renderer.readRenderTargetPixels(rt, 0, 0, w, h, px)
      }

      if (!thumbImageDataRef.current[id] || thumbImageDataRef.current[id].width !== w || thumbImageDataRef.current[id].height !== h) {
        thumbImageDataRef.current[id] = new ImageData(w, h)
      }
      const imageData = thumbImageDataRef.current[id]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const srcIdx = ((h - 1 - y) * w + x) * 4
          const dstIdx = (y * w + x) * 4
          imageData.data[dstIdx] = px[srcIdx]
          imageData.data[dstIdx + 1] = px[srcIdx + 1]
          imageData.data[dstIdx + 2] = px[srcIdx + 2]
          imageData.data[dstIdx + 3] = px[srcIdx + 3]
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
        const gray = pipeline.getGrayXor()

        if (!xorImageDataRef.current || xorImageDataRef.current.width !== w || xorImageDataRef.current.height !== h) {
          xorImageDataRef.current = new ImageData(w, h)
        }
        const imgData = xorImageDataRef.current.data
        for (let i = 0; i < w * h; i++) {
          const i4 = i * 4
          const v = gray.length > i ? gray[i] : 0
          imgData[i4] = v
          imgData[i4 + 1] = v
          imgData[i4 + 2] = v
          imgData[i4 + 3] = 255
        }
        xorCanvas.width = w
        xorCanvas.height = h
        ctx.putImageData(xorImageDataRef.current, 0, 0)
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
