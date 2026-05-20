import { create } from 'zustand'

interface TelemetryState {
  altitude: number
  speed: number
  battery: number
  fps: number
  signal: number
  mode: string
  lastUpdate: number
  setTelemetry: (data: Partial<TelemetryState>) => void
  drainBattery: (dt: number) => void
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  altitude: 20,
  speed: 0,
  battery: 100,
  fps: 60,
  signal: 100,
  mode: 'manual',
  lastUpdate: Date.now(),
  setTelemetry: (data) => set(data),
  drainBattery: (dt) => {
    const battery = get().battery
    const drain = dt * 0.05
    set({ battery: Math.max(0, battery - drain) })
  },
}))
