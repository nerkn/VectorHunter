import { create } from 'zustand'

interface InputState {
  forward: boolean
  backward: boolean
  up: boolean
  down: boolean
  boost: boolean
}

interface DroneState {
  position: [number, number, number]
  velocity: [number, number, number]
  yaw: number
  pitch: number
  mouseCaptured: boolean
  input: InputState
  setInput: (key: string, value: boolean) => void
  rotate: (dx: number, dy: number) => void
  setPitch: (pitch: number) => void
  setPosition: (pos: [number, number, number]) => void
  update: (dt: number) => void
}

const ACCELERATION = 30
const DRAG = 3
const MAX_SPEED = 40
const BOOST_MULTIPLIER = 2.5
const VERTICAL_SPEED = 15
const MOUSE_SENSITIVITY = 0.002
const MAX_PITCH = Math.PI / 3

export const useDroneStore = create<DroneState>((set, get) => ({
  position: [0, 20, 0],
  velocity: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  mouseCaptured: false,
  input: {
    forward: false,
    backward: false,
    up: false,
    down: false,
    boost: false,
  },
  setInput: (key, value) =>
    set((state) => {
      if (state.input[key as keyof InputState] === value) return state
      return { input: { ...state.input, [key]: value } }
    }),
  rotate: (dx, dy) =>
    set((state) => ({
      yaw: state.yaw - dx * MOUSE_SENSITIVITY,
      pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, state.pitch - dy * MOUSE_SENSITIVITY)),
    })),
  setPitch: (pitch) => set({ pitch }),
  setPosition: (pos) => set({ position: pos }),
  update: (dt) => {
    const { position, velocity, yaw, input } = get()
    const boost = input.boost ? BOOST_MULTIPLIER : 1
    const accel = ACCELERATION * boost

    const forwardX = -Math.sin(yaw)
    const forwardZ = -Math.cos(yaw)
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)

    let ax = 0
    let az = 0
    let ay = 0

    if (input.forward) { ax += forwardX * accel; az += forwardZ * accel }
    if (input.backward) { ax -= forwardX * accel; az -= forwardZ * accel }
    if (input.up) ay += VERTICAL_SPEED
    if (input.down) ay -= VERTICAL_SPEED

    const dragFactor = Math.exp(-DRAG * dt)
    const newVx = (velocity[0] + ax * dt) * dragFactor
    const newVy = input.up || input.down ? ay : velocity[1] * dragFactor
    const newVz = (velocity[2] + az * dt) * dragFactor

    const horizontalSpeed = Math.sqrt(newVx * newVx + newVz * newVz)
    const maxSpd = MAX_SPEED * boost
    const scale = horizontalSpeed > maxSpd ? maxSpd / horizontalSpeed : 1

    const newPos: [number, number, number] = [
      position[0] + newVx * dt * scale,
      position[1] + newVy * dt,
      position[2] + newVz * dt * scale,
    ]

    if (newPos[1] < 2) newPos[1] = 2

    set({
      position: newPos,
      velocity: [newVx * scale, newVy, newVz * scale],
    })
  },
}))
