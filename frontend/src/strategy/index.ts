import { DetectionStrategy, StrategyName } from './types'
import { WrappedBlobTracker } from './WrappedBlobTracker'
import { FlowTracker } from './FlowTracker'
import { HybridTracker } from './HybridTracker'
import { DriftTracker } from './DriftTracker'
import { ShapeTracker } from './ShapeTracker'

export function createStrategy(name: StrategyName): DetectionStrategy {
  switch (name) {
    case 'default': return new WrappedBlobTracker()
    case 'flow': return new FlowTracker()
    case 'hybrid': return new HybridTracker()
    case 'drift': return new DriftTracker()
    case 'shape': return new ShapeTracker()
  }
}
