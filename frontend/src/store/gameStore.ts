import { create } from 'zustand'

export type GamePhase = 'menu' | 'playing' | 'paused'

export interface TargetConfig {
  id: string
  type: string
  motion: 'circle' | 'figure8' | 'line'
  speed: number  // m/s
  jitter: number
  appearanceDelay: number
}

interface GameState {
  phase: GamePhase
  sceneName: string
  targets: TargetConfig[]
  setPhase: (phase: GamePhase) => void
  setScene: (name: string) => void
  setTargets: (targets: TargetConfig[]) => void
  start: () => void
  quit: () => void
  resume: () => void
}

export const useGameStore = create<GameState>((set) => ({
  phase: 'menu',
  sceneName: 'openfield',
  targets: [
    { id: 'alpha', type: 'drone', motion: 'circle', speed: 11, jitter: 0, appearanceDelay: 0 },
    { id: 'bravo', type: 'drone', motion: 'figure8', speed: 8, jitter: 0, appearanceDelay: 0 },
    { id: 'charlie', type: 'drone', motion: 'line', speed: 11, jitter: 0, appearanceDelay: 3 },
  ],
  setPhase: (phase) => set({ phase }),
  setScene: (name) => set({ sceneName: name }),
  setTargets: (targets) => set({ targets }),
  start: () => set({ phase: 'playing' }),
  quit: () => set({ phase: 'menu' }),
  resume: () => set({ phase: 'playing' }),
}))
