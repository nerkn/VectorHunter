import { TrackedBlob } from '../utils/blobTracker'

export interface StrategyResult {
  tracked: TrackedBlob[]
  bgVx: number
  bgVy: number
}

export interface DetectionStrategy {
  setGrayImage(gray: Uint8Array, w: number, h: number, threshold: number): void
  setAreaRange(min: number, max: number): void
  update(): StrategyResult
  getByDisplayId(displayId: number): TrackedBlob | undefined
  reset(): void
  setDebug?(on: boolean): void
}

export type StrategyName = 'default' | 'flow' | 'hybrid' | 'drift' | 'shape'
