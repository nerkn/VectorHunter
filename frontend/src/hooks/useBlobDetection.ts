import { useEffect, useRef } from 'react'
import { thresholdImage } from '../utils/blobDetector'
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

      const { detectionFps, threshold, minArea, maxArea } = useDetectionStore.getState()
      const interval = detectionFps > 0 ? 1000 / detectionFps : 1000
      if (now - lastRun < interval) return
      lastRun = now

      const frameData = useCamFrameStore.getState().xorFrame
      if (!frameData) return

      const binary = thresholdImage(frameData.pixels, frameData.w, frameData.h, threshold)
      tracker.setBinaryImage(binary, frameData.w, frameData.h)
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
