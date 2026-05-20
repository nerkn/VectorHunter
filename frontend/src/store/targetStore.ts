import { create } from 'zustand'
import { TargetConfig } from './gameStore'

interface TargetState {
  id: string
  position: [number, number, number]
  speed: number
  altitude: number
  active: boolean
  behavior: TargetConfig['motion']
  color: string
  appearanceDelay: number
}

interface TargetsState {
  targets: TargetState[]
  initFromConfig: (configs: TargetConfig[]) => void
  activateTarget: (id: string) => void
  updateTarget: (id: string, data: Partial<TargetState>) => void
}

const COLORS = ['#cc3333', '#cc6633', '#cc33cc', '#33cccc', '#cccc33', '#33cc66']

export const useTargetStore = create<TargetsState>((set) => ({
  targets: [],
  initFromConfig: (configs) => {
    const targets: TargetState[] = configs.map((c, i) => ({
      id: c.id,
      position: [0, 20, 0],
      speed: 0,
      altitude: 20,
      active: c.appearanceDelay === 0,
      behavior: c.motion,
      color: COLORS[i % COLORS.length],
      appearanceDelay: c.appearanceDelay,
    }))
    set({ targets })
  },
  activateTarget: (id) =>
    set((state) => ({
      targets: state.targets.map(t => t.id === id ? { ...t, active: true } : t),
    })),
  updateTarget: (id, data) =>
    set((state) => ({
      targets: state.targets.map(t => t.id === id ? { ...t, ...data } : t),
    })),
}))
