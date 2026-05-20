// @ts-nocheck

export interface DetectionBox {
  bbox: [number, number, number, number]
  class_id: number
  class_name: string
  confidence: number
  track_id?: number | null
}

export interface DetectionResult {
  camera_id: 'left' | 'right'
  detections: DetectionBox[]
}

export interface TelemetryMessage {
  timestamp: string
  altitude: number
  speed: number
  battery: number
  mode: string
  drone_position: [number, number, number]
  target_position?: [number, number, number]
}

export interface CommandMessage {
  command: 'takeoff' | 'land' | 'switch_mode' | 'lock_target'
  target_id?: number | null
}

export interface RecordControl {
  action: 'start' | 'stop'
  layout?: string
}