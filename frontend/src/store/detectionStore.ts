import { create } from 'zustand'
import { Blob, GridSize, BlobDetectorConfig, DEFAULT_CONFIG } from '../utils/blobDetector'
import { TrackedBlob, BlobTracker } from '../utils/blobTracker'
import { Recording } from '../utils/recorder'

interface DetectionState {
  blobs: Blob[]
  tracked: TrackedBlob[]
  gridSize: GridSize
  threshold: number
  minArea: number
  maxArea: number
  roiEnabled: boolean
  detectionFps: number
  config: BlobDetectorConfig
  lockedTarget: number | null
  tracker: BlobTracker | null
  playback: Recording | null
  setDetectionResult: (blobs: Blob[], tracked: TrackedBlob[]) => void
  setTracker: (tracker: BlobTracker) => void
  setPlayback: (rec: Recording | null) => void
  setGridSize: (size: GridSize) => void
  setThreshold: (val: number) => void
  setMinArea: (val: number) => void
  setMaxArea: (val: number) => void
  toggleRoi: () => void
  setDetectionFps: (fps: number) => void
  lockTarget: (displayId: number | null) => void
}

export const useDetectionStore = create<DetectionState>((set, get) => ({
  blobs: [],
  tracked: [],
  gridSize: 16,
  threshold: 30,
  minArea: 5,
  maxArea: 128,
  roiEnabled: false,
  detectionFps: 8,
  lockedTarget: null,
  tracker: null,
  playback: null,
  setPlayback: (rec) => set({ playback: rec }),
  config: DEFAULT_CONFIG,
  setDetectionResult: (blobs, tracked) => set({ blobs, tracked }),
  setTracker: (tracker) => set({ tracker }),
  setGridSize: (size) => set((state) => ({
    gridSize: size,
    config: { ...state.config, gridSize: size },
  })),
  setThreshold: (val) => set((state) => ({
    threshold: val,
    config: { ...state.config, threshold: val },
  })),
  setMinArea: (val) => set((state) => ({
    minArea: val,
    config: { ...state.config, minArea: val },
  })),
  setMaxArea: (val) => set((state) => ({
    maxArea: val,
    config: { ...state.config, maxArea: val },
  })),
  toggleRoi: () => set((state) => {
    const roiEnabled = !state.roiEnabled
    return { roiEnabled, config: { ...state.config, roiEnabled } }
  }),
  setDetectionFps: (fps) => set({ detectionFps: fps }),
  lockTarget: (displayId) => set({ lockedTarget: displayId }),
}))
