import { useEffect, useRef } from 'react'
import { detectBlobs, thresholdImage } from '../utils/blobDetector'
import { BlobTracker } from '../utils/blobTracker'
import { useDetectionStore } from '../store/detectionStore'
import { useCamFrameStore } from '../store/camFrameStore'
import { recordFrame } from '../utils/recorder'

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

      const { detectionFps } = useDetectionStore.getState()
      const interval = detectionFps > 0 ? 1000 / detectionFps : 1000
      if (now - lastRun < interval) return
      lastRun = now

      const { config } = useDetectionStore.getState()
      const frameData = useCamFrameStore.getState().xorFrame
      if (!frameData) return

      const binary = thresholdImage(frameData.pixels, frameData.w, frameData.h, config.threshold)
      tracker.setBinaryImage(binary, frameData.w, frameData.h)

      const rawBlobs = detectBlobs(frameData.pixels, frameData.w, frameData.h, config, [])
      tracker.setAreaRange(config.minArea, config.maxArea)
      const tracked = tracker.update(rawBlobs)

      recordFrame(frameData.pixels, frameData.w, frameData.h, rawBlobs, tracked)

      useDetectionStore.getState().setDetectionResult(rawBlobs, tracked)
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      trackerRef.current = null
    }
  }, [])
}
