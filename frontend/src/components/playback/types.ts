export interface GroundTruth {
  frames: { frame: number; targets: { cx: number; cy: number }[] }[]
}
