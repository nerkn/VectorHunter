import { TrackedBlob } from './blobTracker'

interface RecordedFrame {
  time: number
  xorImage: ImageData
  tracked: TrackedBlob[]
}

interface Recording {
  version: number
  params: {
    minArea: number
    maxArea: number
    threshold: number
    detectionFps: number
  }
  frames: RecordedFrame[]
}

let recording: Recording | null = null

export function startRecording(params: Recording['params']) {
  recording = { version: 101, params, frames: [] }
}

export function recordFrame(
  gray: Uint8Array, w: number, h: number,
  tracked: TrackedBlob[]
) {
  if (!recording) return
  if (recording.frames.length >= 100) return

  const imageData = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const i4 = i * 4
    imageData.data[i4] = gray[i]
    imageData.data[i4 + 1] = gray[i]
    imageData.data[i4 + 2] = gray[i]
    imageData.data[i4 + 3] = 255
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