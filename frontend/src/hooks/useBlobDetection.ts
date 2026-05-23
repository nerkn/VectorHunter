import { useEffect, useRef } from 'react'
import { thresholdImage } from '../utils/blobDetector'
import { BlobTracker } from '../utils/blobTracker'
import { useDetectionStore } from '../store/detectionStore'
import { useGameStore } from '../store/gameStore'
import { useCamFrameStore } from '../store/camFrameStore'
import { recordFrame } from '../utils/recorder'

let debugMode = false
export function setDebugMode(v: boolean) {
  debugMode = v
}

export function useBlobDetection() {
  const trackerRef = useRef<BlobTracker | null>(null)

  useEffect(() => {
    const tracker = new BlobTracker()
    trackerRef.current = tracker
    useDetectionStore.getState().setTracker(tracker)

    let rafId = 0
    let lastRun = 0

    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop)

      if (useDetectionStore.getState().playback) return
      if (useGameStore.getState().phase !== 'playing') return

      const { detectionFps, threshold, minArea, maxArea, slowMode } = useDetectionStore.getState()
      const effectiveFps = slowMode ? 1 : detectionFps
      const interval = debugMode ? 0 : (effectiveFps > 0 ? 1000 / effectiveFps : 1000)
      if (!debugMode && !slowMode && now - lastRun < interval) return
      lastRun = now

      const frameData = useCamFrameStore.getState().xorFrame
      if (!frameData) return

      const binary = thresholdImage(frameData.pixels, frameData.w, frameData.h, threshold)
      tracker.setBinaryImage(binary, frameData.w, frameData.h, frameData.pixels)
      tracker.setAreaRange(minArea, maxArea)
      const tracked = tracker.update()

      recordFrame(frameData.pixels, frameData.w, frameData.h, tracked)
      useDetectionStore.getState().setDetectionResult(tracked)
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      trackerRef.current = null
    }
  }, [])
}
