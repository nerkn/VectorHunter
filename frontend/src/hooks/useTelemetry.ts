import { useFrame } from '@react-three/fiber'
import { useDroneStore } from '../store/droneStore'
import { useTelemetryStore } from '../store/telemetryStore'
import { useGameStore } from '../store/gameStore'

export function useTelemetry() {
  useFrame(({ fps }) => {
    if (useGameStore.getState().phase !== 'playing') return
    const { position, velocity } = useDroneStore.getState()
    const speed = Math.sqrt(velocity[0] ** 2 + velocity[1] ** 2 + velocity[2] ** 2)
    const { setTelemetry, drainBattery } = useTelemetryStore.getState()

    setTelemetry({
      altitude: position[1],
      speed,
      fps: fps > 0 ? Math.round(fps) : useTelemetryStore.getState().fps,
      signal: Math.max(0, 100 - position[1] * 0.1),
    })
    drainBattery(1 / 60)
  })
}
