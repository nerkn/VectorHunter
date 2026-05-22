import { create } from 'zustand'
import { TrackedBlob, BlobTracker } from '../utils/blobTracker'
import { Recording } from '../utils/recorder'

interface DetectionState {
  tracked: TrackedBlob[]
  threshold: number
  minArea: number
  maxArea: number
  detectionFps: number
  lockedTarget: number | null
  tracker: BlobTracker | null
  playback: Recording | null
  setDetectionResult: (tracked: TrackedBlob[]) => void
  setTracker: (tracker: BlobTracker) => void
  setPlayback: (rec: Recording | null) => void
  setThreshold: (val: number) => void
  setMinArea: (val: number) => void
  setMaxArea: (val: number) => void
  setDetectionFps: (fps: number) => void
  lockTarget: (displayId: number | null) => void
}

export const useDetectionStore = create<DetectionState>((set) => ({
  tracked: [],
  threshold: 25,
  minArea: 4,
  maxArea: 256,
  detectionFps: 16,
  lockedTarget: null,
  tracker: null,
  playback: null,
  setPlayback: (rec) => set({ playback: rec }),
  setDetectionResult: (tracked) => set({ tracked }),
  setTracker: (tracker) => set({ tracker }),
  setThreshold: (val) => set({ threshold: val }),
  setMinArea: (val) => set({ minArea: val }),
  setMaxArea: (val) => set({ maxArea: val }),
  setDetectionFps: (fps) => set({ detectionFps: fps }),
  lockTarget: (displayId) => set({ lockedTarget: displayId }),
}))
