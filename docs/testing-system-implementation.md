# Testing System Implementation Plan

## Overview
A browser-exposed debug API on localhost:3002 that lets the AI agent (via browse97) control the simulation step-by-step, inspect detection state, and evaluate tracking quality.

## Phase 1: Debug API Endpoint (Window globals)

Expose `window.DEBUG` object with these functions callable via `browse97_eval`:

### State Readers
- `DEBUG.getState()` → { phase, drone: {pos,yaw,pitch,velocity}, targets: [{id,pos,speed,active}], detection: {tracked, lockedTarget, params} }
- `DEBUG.getXorFrame()` → returns the current XOR image as base64 PNG (from camFrameStore)
- `DEBUG.getBlobHex(displayId)` → returns the blobHex string for a specific tracked target
- `DEBUG.getTrackedDetail()` → full tracked array with area, velocity, missMs, residualSpeed, highJerkFrames, bbox, blobHex for each

### Simulation Control
- `DEBUG.startGame(targetsConfig)` → sets targets, sets phase='playing'
- `DEBUG.pause()` / `DEBUG.resume()` 
- `DEBUG.reset()` → resets all stores, goes to menu

### Frame Stepping
- `DEBUG.stepFrames(n)` → advances simulation N frames (resumes, waits N rAF ticks, pauses)
- `DEBUG.stepMs(ms)` → advances simulation for ms milliseconds

### Drone Control
- `DEBUG.setYaw(rad)` / `DEBUG.setPitch(rad)`
- `DEBUG.setPosition([x,y,z])`
- `DEBUG.setInput({forward,boost,up})` → set input flags

### Detection Control
- `DEBUG.lockTarget(displayId)` / `DEBUG.unlockTarget()`
- `DEBUG.setCommand(cmd, displayId)` → lock/approach/fire/idle
- `DEBUG.setParams({threshold, minArea, maxArea, detectionFps})`

### Recording
- `DEBUG.startRecording()` / `DEBUG.stopRecording()` → returns JSON
- `DEBUG.getRecordingJson()` → returns last recording as JSON string

### Keyboard Simulation
- `DEBUG.pressKey(code)` / `DEBUG.releaseKey(code)` → simulates keyboard events for keys 1-9, J, K, L

## Implementation

One new file: `src/debug/debugApi.ts`
- Registers `window.DEBUG` on import
- Imported conditionally in App.tsx (or always, gated by NODE_ENV)

Uses zustand `.getState()` for all reads. For stepFrames, uses a promise that resolves after N rAF callbacks.

## Phase 2: AI Agent Tools

Not code changes — these are prompts/instructions for the AI to use browse97_eval with the debug API. Documented in testing-system-use.md.

## Phase 3: XOR Image Analysis Helper

A function `DEBUG.analyzeXor()` that:
- Reads current xorFrame pixels
- Finds all connected components above threshold
- Returns array of {cx, cy, area, avgBrightness, maxBrightness, bbox}
- Includes blobHex for each
- This lets the AI see what the detector sees without running the detector

## Phase 4: Scenario Presets

- `DEBUG.preset_circle()` → single circle target at speed 40
- `DEBUG.preset_figure8()` → single figure8 target at speed 30
- `DEBUG.preset_multi()` → circle + figure8 + line
- `DEBUG.preset_stress()` → multiple fast targets
