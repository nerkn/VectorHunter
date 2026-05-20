import { TrackedBlob } from './blobTracker'

interface RecordedFrame {
  time: number
  tracked: TrackedBlob[]
}

interface Recording {
  params: {
    minArea: number
    maxArea: number
    threshold: number
    gridSize: number
    detectionFps: number
  }
  frames: RecordedFrame[]
}

let recording: Recording | null = null

export function startRecording(params: Recording['params']) {
  recording = { params, frames: [] }
}

export function recordFrame(
  _pixels: Uint8Array, _w: number, _h: number,
  tracked: TrackedBlob[]
) {
  if (!recording) return
  if (recording.frames.length >= 100) return

  recording.frames.push({
    time: performance.now(),
    tracked: tracked.map(t => ({ ...t })),
  })
}

export function isRecording(): boolean {
  return recording !== null
}

export function getRecording(): Recording | null {
  return recording
}

export function stopRecording(): Recording | null {
  const r = recording
  recording = null
  return r
}

export type { Recording, RecordedFrame }
