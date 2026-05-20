import { create } from 'zustand'
import { useDetectionStore } from './detectionStore'
import { useDroneStore } from './droneStore'

type FlightCommand = 'idle' | 'lock' | 'approach' | 'fire'

interface DirectorState {
  command: FlightCommand
  targetDisplayId: number | null
  standoffArea: number
  searchTimeout: number
  searchStartTime: number | null
  setCommand: (cmd: FlightCommand, displayId?: number | null, standoffArea?: number) => void
  update: () => void
}

const KP_YAW = 0.0005
const KP_PITCH = 0.00005
const MAX_YAW_DELTA = 0.04
const MAX_PITCH_DELTA = 0.005
const PREDICT_DT = 0.15
const SEARCH_DURATION = 2000
const IMAGE_CX = 320
const IMAGE_CY = 240
const DEFAULT_STANDOFF_AREA = 200

export const useFlightDirector = create<DirectorState>((set, get) => ({
  command: 'idle',
  targetDisplayId: null,
  standoffArea: DEFAULT_STANDOFF_AREA,
  searchTimeout: 2000,
  searchStartTime: null,
  setCommand: (cmd, displayId, standoffArea) => set({
    command: cmd,
    targetDisplayId: displayId ?? null,
    standoffArea: standoffArea ?? DEFAULT_STANDOFF_AREA,
    searchStartTime: cmd !== 'idle' ? performance.now() : null,
  }),
  update: () => {
    const { command, targetDisplayId, searchStartTime, standoffArea } = get()
    if (command === 'idle' || targetDisplayId === null) return

    const { tracked, lockTarget } = useDetectionStore.getState()
    const target = tracked.find(t => t.displayId === targetDisplayId)

    if (!target || (performance.now() - target.lastSeen) > 200) {
      useDroneStore.getState().setInput('forward', false)
      useDroneStore.getState().setInput('boost', false)
      if (searchStartTime && performance.now() - searchStartTime > SEARCH_DURATION) {
        get().setCommand('idle', null)
        lockTarget(null)
      }
      return
    }

    useDroneStore.getState().setInput('boost', false)
    useDroneStore.getState().setInput('forward', false)

    const predictedX = target.cx + target.vx * PREDICT_DT
    const predictedY = target.cy + target.vy * PREDICT_DT
    const errorX = predictedX - IMAGE_CX
    const errorY = predictedY - IMAGE_CY

    const yawDelta = Math.max(-MAX_YAW_DELTA, Math.min(MAX_YAW_DELTA, -errorX * KP_YAW))
    useDroneStore.setState(s => ({ yaw: s.yaw + yawDelta }))

    const pitchDelta = Math.max(-MAX_PITCH_DELTA, Math.min(MAX_PITCH_DELTA, errorY * KP_PITCH))
    useDroneStore.setState(s => ({ pitch: Math.max(-Math.PI / 3, Math.min(Math.PI / 3, s.pitch + pitchDelta)) }))

    if (command === 'approach') {
      if (target.area < standoffArea) {
        useDroneStore.getState().setInput('forward', true)
      }
    }

    if (command === 'fire') {
      useDroneStore.getState().setInput('forward', true)
      useDroneStore.getState().setInput('boost', true)
    }
  },
}))
