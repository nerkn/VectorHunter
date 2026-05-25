import { BlobTracker } from '../utils/blobTracker'
import { recordFrame } from '../utils/recorder'
import { useDetectionStore } from '../store/detectionStore'
import { useGameStore } from '../store/gameStore'

export class FramePipeline {
  private leftPx: Uint8Array = new Uint8Array(0)
  private rightPx: Uint8Array = new Uint8Array(0)
  private grayXor: Uint8Array = new Uint8Array(0)

  private w = 0
  private h = 0
  private dirty = false
  private running = false
  private rafId = 0
  private lastRun = 0

  private tracker = new BlobTracker()

  private debugMode = false

  start() {
    if (this.running) return
    this.running = true
    this.loop(performance.now())
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  setDebugMode(v: boolean) {
    this.debugMode = v
  }

  getTracker() { return this.tracker }
  getGrayXor() { return this.grayXor }
  getWidth() { return this.w }
  getHeight() { return this.h }

  feed(left: Uint8Array, right: Uint8Array, w: number, h: number) {
    const n4 = w * h * 4
    const n = w * h
    if (this.leftPx.length !== n4) {
      this.leftPx = new Uint8Array(n4)
      this.rightPx = new Uint8Array(n4)
      this.grayXor = new Uint8Array(n)
      this.w = w
      this.h = h
    }
    this.leftPx.set(left)
    this.rightPx.set(right)

    const n2 = w * h
    for (let i = 0; i < n2; i++) {
      const i4 = i * 4
      const r = this.leftPx[i4] ^ this.rightPx[i4]
      const g = this.leftPx[i4 + 1] ^ this.rightPx[i4 + 1]
      const b = this.leftPx[i4 + 2] ^ this.rightPx[i4 + 2]
      this.grayXor[i] = (r + g + b) / 3
    }
    this.dirty = true
  }

  private loop = (now: number) => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.loop)

    if (useDetectionStore.getState().playback) return
    if (useGameStore.getState().phase !== 'playing') return

    const { detectionFps, threshold, minArea, maxArea, slowMode } = useDetectionStore.getState()
    const effectiveFps = slowMode ? 1 : detectionFps
    const interval = this.debugMode ? 0 : (effectiveFps > 0 ? 1000 / effectiveFps : 1000)
    if (!this.debugMode && !slowMode && now - this.lastRun < interval) return
    if (!this.dirty) return
    this.dirty = false
    this.lastRun = now

    this.tracker.setGrayImage(this.grayXor, this.w, this.h, threshold)
    this.tracker.setAreaRange(minArea, maxArea)
    const tracked = this.tracker.update()

    recordFrame(this.grayXor, this.w, this.h, tracked)
    useDetectionStore.getState().setDetectionResult(tracked)
  }

  reset() {
    this.tracker.reset()
    this.dirty = false
  }
}

export const pipeline = new FramePipeline()
