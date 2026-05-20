import { TrackedBlob } from './blobTracker'

interface RecordedFrame {
  time: number
  xorImage: ImageData
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
  pixels: Uint8Array, w: number, h: number,
  tracked: TrackedBlob[]
) {
  if (!recording) return
  if (recording.frames.length >= 100) return

  const imageData = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    imageData.data[i * 4] = pixels[i * 4]
    imageData.data[i * 4 + 1] = pixels[i * 4 + 1]
    imageData.data[i * 4 + 2] = pixels[i * 4 + 2]
    imageData.data[i * 4 + 3] = 255
  }

  recording.frames.push({
    time: performance.now(),
    xorImage: imageData,
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
