# Drone Tracking System — Development Plan

## Current State

### What's Working
- **Debug API** (`window.DEBUG`) — full access to game state, XOR analysis, tracking, drone control
- **Detection** — XOR stereo blob detection, tracker with velocity prediction, display IDs 1-9
- **Flight Director** — auto-track, approach, fire commands
- **Flight Controls** — WASD, mouse, keys 1-9 lock, J fire, K countermeasures
- **Recording system** — captures XOR frames and blobHex per frame

### Known Issues (Priority Order)

---

## P0 — Core Bug Fixes

### P0-1: Target Behaviors (circle/figure8/line) are wrong
**Files:** `frontend/src/components/TargetDrone.tsx`, `frontend/src/store/gameStore.ts`, `frontend/src/components/MenuPage.tsx`, `frontend/src/components/HUD.tsx`

**Problems found:**
1. Speed was labeled "km/h" in menu but stored as m/s → confusing display
2. `CIRCLE_TURN_RATE = 0.5 rad/s` was too slow — at 40 m/s gives 80m radius, barely circles
3. Figure8 used sinusoidal heading but max heading was too small, making it nearly straight
4. Menu delay input wasn't reset when changing motion type

**Changes already made:**
- Speed now labeled "m/s" in menu
- `TargetDrone.tsx`: added `CIRCLE_TURN_RATE = 0.5`, fixed figure8 with `CIRCLE_MAX_HEADING = Math.PI/3`, `FIGURE8_HALF_PERIOD = 2.5`
- Menu: default speed 11, changing motion resets delay to 0

**Verify needed:**
- [ ] Circle actually moves in a circle (check positions over time)
- [ ] Figure8 crosses itself (check positions trace a figure-8 shape)
- [ ] Speed displays correctly in HUD (m/s)

### P0-2: Target Store Re-initialization Bug
**File:** `frontend/src/components/Scene.tsx`

**Problem:** When DEBUG presets change `gameStore.targets` after component mounted, the `useEffect` doesn't re-run because React doesn't see it as a change in the hook dependencies. The targetStore keeps old targets with old behavior types.

**Current workaround:** Remove unwanted targets via UI "×" buttons before clicking START MISSION.

**Fix:** Make Scene's `initFromConfig` effect depend on both target config AND phase, so it re-runs when phase goes to 'playing'.

### P0-3: stepFrames Race Condition
**File:** `frontend/src/debug/debugApi.ts`

**Problem:** `stepFrames()` uses setInterval at 50ms per frame. But `useBlobDetection` runs at 8-16 fps (~62-125ms per tick). If we advance 10 frames at 50ms intervals, we only get ~5-8 detection ticks. The pause happens mid-interval.

**Fix:** Use a proper state machine or check detection ticks instead of wall-clock time.

---

## P1 — Tracking Quality

### P1-1: XOR Signal Fading at Distance
**Problem:** At 50m+ range, stereo cameras see nearly the same image → XOR ≈ 0. Signal fades as target angle changes.

**Current fix:** `searchAroundRaw()` fallback in tracker uses threshold=10 for known blobs.

**Better fix options:**
- Increase stereo baseline (tried 0.15→0.25→0.4→0.5m, too noisy)
- Use lower base threshold globally (threshold=25 vs 30)
- Add temporal persistence: remember blob brightness pattern and match against dimmed XOR
- Multi-resolution search: coarse XOR at low resolution for rough position, refine

### P1-2: Ghost Blobs Hogging Display IDs
**Problem:** `maxMissingMs * 2 = 1200ms` grace for confirmed targets → zombie trackers block displayIds.

**Fix:** Reduce grace for blobs with 0% fill. Or add a fast-expiry path for blobs that fade completely.

### P1-3: Dedup Kills Valid Targets
**Problem:** When one drone produces two XOR blobs (fragmentation), deduplication at dist<5px removes one.

**Fix:** Only dedup if both blobs have same displayId OR if both are unassigned noise. Or: dedup only if blobs overlap (not just center distance).

---

## P2 — Testing & Analysis

### P2-1: Systematic Test Scripts
**Goal:** Write test scripts that:
1. Start scenario (circle or figure8)
2. Teleport drone to optimal position
3. Run autoHunt loop
4. Log: lock time, track duration, missMs growth, target destroyed Y/N
5. Record failure cases

**Use browse97_eval with DEBUG API:**
- `DEBUG.preset_circle()` / `DEBUG.preset_figure8()`
- `DEBUG.aimAtTarget()` — GPS-aim drone at target
- `DEBUG.setParams({threshold, minArea, detectionFps})`
- `DEBUG.snapshot()` — full state after each step
- `DEBUG.autoHunt(60000)` — GPS approach → XOR track → fire
- `DEBUG.startRecording()` / `DEBUG.stopRecording()`

### P2-2: Figure8 Tracking Test
**Problem:** Figure8 crosses itself — the target crosses the drone's approach path. Need predictive tracking, not just chasing.

**Test plan:**
1. Start figure8 preset
2. Analyze figure8 path: predict where target crosses the drone's path
3. Position drone at crossing point
4. Wait for detection
5. Lock and fire

### P2-3: Record/Replay Analysis Pipeline
**Files:** `frontend/src/utils/recorder.ts`, `docs/recording_TIMESTAMP.json`

**Improvements:**
- Auto-name recordings by scenario + timestamp
- Write analysis script that plots XOR signal strength over time
- Identify signal fade patterns
- Find optimal detection params per scenario

---

## P3 — Enhancements

### P3-1: DEBUG.getXorFrame()
Return current XOR image as base64 PNG for offline analysis.

### P3-2: DEBUG.analyzeXor() Already Done
Returns all connected components with cx, cy, area, avgBrightness, maxBrightness, blobHex. Already exposed.

### P3-3: Scenario Presets
- `DEBUG.preset_circle()` — single circle, speed 11 m/s
- `DEBUG.preset_figure8()` — single figure8, speed 8 m/s
- `DEBUG.preset_multi()` — circle + figure8
- `DEBUG.preset_stress()` — multiple fast targets

### P3-4: Debug Keyboard Overlay
Show detected blobs directly on the XOR feed in browser for visual debugging.

---

## Key Files

| File | Role |
|------|------|
| `frontend/src/debug/debugApi.ts` | All DEBUG API functions |
| `frontend/src/utils/blobTracker.ts` | Tracker: verify, dedup, classify, expire |
| `frontend/src/utils/blobDetector.ts` | Binary threshold + connected components |
| `frontend/src/components/CamLayout.tsx` | Reads stereo cams, computes XOR, stores in camFrameStore |
| `frontend/src/components/OnboardCamera.tsx` | Stereo cameras at ±0.25m offset |
| `frontend/src/store/flightDirector.ts` | Auto-track/approach/fire with PID control |
| `frontend/src/store/detectionStore.ts` | Detection params, tracker reference |
| `frontend/src/store/targetStore.ts` | Target positions (updated by TargetDrone) |
| `frontend/src/components/TargetDrone.tsx` | Circle/figure8/line motion math |
| `frontend/src/store/gameStore.ts` | Target configs (speed in m/s now) |
| `frontend/src/components/MenuPage.tsx` | Target config UI |
| `frontend/src/utils/recorder.ts` | Frame recording |

---

## Debug API Quick Reference

```javascript
// Setup
DEBUG.preset_circle()          // circle 11 m/s
DEBUG.preset_figure8()         // figure8 8 m/s

// State
DEBUG.snapshot()               // full state snapshot
DEBUG.getState()               // raw state
DEBUG.getTrackedDetail()       // all tracked blobs with blobHex
DEBUG.analyzeXor(threshold?)   // XOR blobs independent of tracker
DEBUG.xorStats()               // pixel stats + hot pixel clusters
DEBUG.snapshot()               // { phase, drone, target, tracked, noise, xorBlobs, cmd, locked }

// Control
DEBUG.aimAtTarget('alpha')     // GPS-aim drone at target
DEBUG.lockTarget(1)             // lock displayId 1
DEBUG.setCommand('fire', 1)     // fire command
DEBUG.setParams({threshold:25, minArea:4})  // detection params
DEBUG.setInput({forward:true})  // drone controls
DEBUG.setPosition([x,y,z])    // teleport

// Auto-hunt (GPS approach → XOR track → fire)
DEBUG.autoHunt(60000).then(r => window.__result = r)

// Recording
DEBUG.startRecording()
DEBUG.stopRecording()          // returns JSON string

// Step (note: timing is approximate due to detection FPS)
DEBUG.stepFrames(10)            // pause after ~10 detection ticks
DEBUG.stepAndResume(10)        // don't pause
```

---

## Test Workflow (Circle)

```
1. Fresh browser tab → http://localhost:3000
2. Remove all but one target via × buttons
3. Set motion to "circle", speed 11, delay 0
4. Click START MISSION
5. Verify target moves: check positions over 3-5s
6. Run: DEBUG.aimAtTarget() + DEBUG.autoHunt(30000)
7. Check result: DESTROYED or TIMEOUT
8. If TIMEOUT: DEBUG.snapshot() to see why
9. Record failure: DEBUG.startRecording() before step 6
```

## Test Workflow (Figure8)

```
1-4: Same as circle but motion="figure8", speed=8
5. Analyze figure8 path: predict crossing points
6. Position drone at crossing point using DEBUG.setPosition()
7. DEBUG.aimAtTarget() + DEBUG.autoHunt(60000)
8. Note: figure8 crosses itself, may need predictive tracking
```