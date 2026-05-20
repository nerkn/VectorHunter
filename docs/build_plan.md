# Build Plan — VectorHunter (Frontend)

## Phase 0: Project Scaffolding ✅
## Phase 1: 3D World ✅
## Phase 2: 4 Camera System ✅
## Phase 3: Target Drones ✅
## Phase 4: Telemetry System ✅

## Phase 5: Menu Page
- Landing screen before simulation starts, dark static background
- Scene selector (currently OpenField only, more later)
- Target configuration:
  - Number of targets
  - Per target: type (drone only for now), motion pattern (circle/figure8/line), speed (km/h), appearance delay (0=at once, >0=sequential seconds)
  - Jitter placeholder (0 for now)
- Start mission button → transitions to 3D scene
- Keyboard/mouse controls hint on menu
- Quit button on HUD → returns to menu
- New files: MenuPage.tsx, gameStore.ts

## Phase 6: Scene System
- Scenes are React components, not JSON configs
- src/scenes/ dir: PatrolCity, ForestSearch, UrbanTracking, OpenField
- Each scene composes terrain, objects, targets, weather as JSX
- SceneShell wrapper: shared sky, fog, lighting, drone, follow cam
- Scene selector in menu page (Phase 5)
- Defer: weather rendering

## Phase 9: Autonomous Tracking
- See `docs/tracking_plan.md` for detailed tracking & engagement plan
- Blob detection, target numbering, lock/follow, Kalman filter, fire
- Flight director command system

## Phase 7: Target Types
- Model variants: raceDrone, shahid, f16, f35, su22
- Each type: different mesh, size, speed range, signature
- Only drone type exists now, expand from reference models

## Phase 8: Target Jitter
- Random positional jitter on target movement
- Configurable amplitude + frequency
- Simulates realistic UAV instability
- Affects detection difficulty

## Phase 9: Autonomous Tracking
- Target lock (click target or cycle with Tab)
- Follow mode: drone auto-rotates toward locked target
- Target reacquisition + scanning behavior on loss
- Target position prediction
- Target info on HUD (class, distance, bearing)

## Phase 10: Cinematic Cameras + Cam GUI Polish
- Target cam: attached to target, looks at player drone, 720p
- Overview cam: above midpoint of all entities, auto-adjusts, 720p
- Higher-res WebGLRenderTargets
- Cam effects: noise, latency sim, signal degradation
- TODO: Onboard cams currently ignore drone pitch/roll — stabilized gimbal. Decide if we want unstabilized mode.

## Phase 11: Operator UI Polish
- Minimap (top-down view of terrain + drone + targets)
- Dark tactical aesthetic
- Subtle animations on HUD elements
- Target info panel (class, distance, track_id)
- Warning system (low battery, signal loss, obstacle)

## Phase 12: Visual Modes
- Thermal vision shader (false-color heatmap)
- Night vision shader (green tint + noise)
- Weather: fog, rain particles, low-light
- Togglable via HUD or keyboard shortcut

## Phase 13: Demo Polish
- Landing page / splash screen
- Scene preview thumbnails
- Auto-demo mode (scripted mission, no operator needed)
- Final visual pass, performance audit
- Presentation-ready
