import { useEffect } from 'react'
import { useDroneStore } from '../store/droneStore'
import { useGameStore } from '../store/gameStore'
import { useTargetStore } from '../store/targetStore'
import { useDetectionStore } from '../store/detectionStore'
import { useFlightDirector } from '../store/flightDirector'
import { isRecording, startRecording, stopRecording } from '../utils/recorder'

const YAW_SPEED = 1.5
const PITCH_SENSITIVITY = 0.003

export function useFlightControls() {
  const setInput = useDroneStore(s => s.setInput)

  useEffect(() => {
    const keyMap: Record<string, string> = {
      KeyW: 'forward',
      KeyS: 'backward',
      Space: 'up',
      KeyC: 'down',
      ShiftLeft: 'boost',
      ShiftRight: 'boost',
    }

    const keys = new Set<string>()

    const onKeyDown = (e: KeyboardEvent) => {
      keys.add(e.code)
      const action = keyMap[e.code]
      if (action) {
        setInput(action, true)
        e.preventDefault()
      }
      if (e.code === 'KeyM') {
        if (document.pointerLockElement) {
          document.exitPointerLock()
        } else {
          document.body.requestPointerLock()
        }
      }
      if (e.code === 'Escape') {
        e.preventDefault()
        const { phase, setPhase } = useGameStore.getState()
        if (phase === 'playing') setPhase('paused')
      }

      const lockMatch = e.code.match(/^(?:Digit|Numpad)([1-9])$/)
      if (lockMatch) {
        const displayId = Number(lockMatch[1])
        const { lockedTarget, lockTarget, strategyImpl } = useDetectionStore.getState()
        if (lockedTarget === displayId) {
          lockTarget(null)
          useFlightDirector.getState().setCommand('idle', null)
        } else if (strategyImpl && strategyImpl.getByDisplayId(displayId)) {
          lockTarget(displayId)
          useFlightDirector.getState().setCommand('lock', displayId)
        }
      }

      if (e.code === 'KeyJ' && useDetectionStore.getState().lockedTarget !== null) {
        const displayId = useDetectionStore.getState().lockedTarget!
        useFlightDirector.getState().setCommand('approach', displayId)
      }
      if (e.code === 'KeyK' && useDetectionStore.getState().lockedTarget !== null) {
        const displayId = useDetectionStore.getState().lockedTarget!
        useFlightDirector.getState().setCommand('fire', displayId)
      }
      if (e.code === 'KeyL') {
        useDroneStore.getState().setInput('forward', false)
        useDroneStore.getState().setInput('boost', false)
        useFlightDirector.getState().setCommand('lock', useDetectionStore.getState().lockedTarget)
      }

      if (e.code === 'KeyR') {
        if (!isRecording()) {
          const { minArea, maxArea, threshold, detectionFps } = useDetectionStore.getState()
          startRecording({ minArea, maxArea, threshold, detectionFps })
        } else {
          const rec = stopRecording()
          if (rec) {
            useDetectionStore.getState().setPlayback(rec)
            useGameStore.getState().setPhase('paused')
          }
        }
      }
      if (e.code === 'KeyT') {
        useDetectionStore.getState().toggleSlowMode()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code)
      const action = keyMap[e.code]
      if (action) setInput(action, false)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return
      const state = useDroneStore.getState()
      state.setPitch(
        Math.max(-Math.PI / 3, Math.min(Math.PI / 3, state.pitch - e.movementY * PITCH_SENSITIVITY))
      )
    }

    const onPointerLockChange = () => {
      useDroneStore.setState({ mouseCaptured: !!document.pointerLockElement })
    }

    let last = performance.now()
    let animId = 0
    const tick = (now: number) => {
      let dt = (now - last) / 1000
      last = now

      if (useDetectionStore.getState().slowMode) {
        dt = 1 / 60
      }

      if (useGameStore.getState().phase !== 'playing') {
        animId = requestAnimationFrame(tick)
        return
      }

      if (keys.has('KeyA')) {
        const { yaw } = useDroneStore.getState()
        useDroneStore.setState({ yaw: yaw + YAW_SPEED * dt })
      }
      if (keys.has('KeyD')) {
        const { yaw } = useDroneStore.getState()
        useDroneStore.setState({ yaw: yaw - YAW_SPEED * dt })
      }

      const dronePos = useDroneStore.getState().position
      const targets = useTargetStore.getState().targets.filter(t => t.active)
      for (const t of targets) {
        const dx = dronePos[0] - t.position[0]
        const dy = dronePos[1] - t.position[1]
        const dz = dronePos[2] - t.position[2]
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < 3) {
          useTargetStore.getState().updateTarget(t.id, { ...t, active: false })
          const remaining = useTargetStore.getState().targets.filter(x => x.active || x.appearanceDelay > 0)
          if (remaining.length === 0) {
            useGameStore.getState().setPhase('paused')
          }
          break
        }
      }

      useFlightDirector.getState().update()

      animId = requestAnimationFrame(tick)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    animId = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      cancelAnimationFrame(animId)
      if (document.pointerLockElement) document.exitPointerLock()
    }
  }, [setInput])
}