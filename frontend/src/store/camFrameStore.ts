import { create } from 'zustand'

interface CamFrameState {
  xorFrame: { pixels: Uint8Array; w: number; h: number } | null
  leftFrame: { pixels: Uint8Array; w: number; h: number } | null
  rightFrame: { pixels: Uint8Array; w: number; h: number } | null
  setXorFrame: (data: { pixels: Uint8Array; w: number; h: number }) => void
  setLeftFrame: (data: { pixels: Uint8Array; w: number; h: number }) => void
  setRightFrame: (data: { pixels: Uint8Array; w: number; h: number }) => void
}

export const useCamFrameStore = create<CamFrameState>((set) => ({
  xorFrame: null,
  leftFrame: null,
  rightFrame: null,
  setXorFrame: (data) => set({ xorFrame: data }),
  setLeftFrame: (data) => set({ leftFrame: data }),
  setRightFrame: (data) => set({ rightFrame: data }),
}))
