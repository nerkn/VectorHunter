import { BlobTracker, TrackedBlob } from '../utils/blobTracker'
import { DetectionStrategy, StrategyResult } from './types'

export class WrappedBlobTracker implements DetectionStrategy {
  private inner = new BlobTracker()

  setGrayImage(gray: Uint8Array, w: number, h: number, threshold: number) {
    this.inner.setGrayImage(gray, w, h, threshold)
  }

  setAreaRange(min: number, max: number) {
    this.inner.setAreaRange(min, max)
  }

  update(): StrategyResult {
    const tracked = this.inner.update()
    const noise = tracked.filter(t => t.displayId === null && t.framesSeen >= 5 && t.area >= 10)
    let bgVx = 0, bgVy = 0
    if (noise.length >= 2) {
      const vxs = noise.map(t => t.vx)
      const vys = noise.map(t => t.vy)
      bgVx = vxs.reduce((s, v) => s + v, 0) / vxs.length
      bgVy = vys.reduce((s, v) => s + v, 0) / vys.length
    }
    return { tracked, bgVx, bgVy }
  }

  getByDisplayId(displayId: number): TrackedBlob | undefined {
    return this.inner.getByDisplayId(displayId)
  }

  reset() {
    this.inner.reset()
  }
}
