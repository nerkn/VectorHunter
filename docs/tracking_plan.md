# Tracking & Engagement Plan — VectorHunter

## T1: Blob Detection ✅
- XOR/disparity image → threshold → connected components
- Two modes:
  - **Grid scan**: divide image into grid cells, count bright pixels per cell, cluster active cells
  - **ROI scan**: only search small area around previous blob positions
- Grid sizes (selectable via HUD): 2×2, 4×4, 8×8, 16×16, 32×32, 64×64
  - Smaller grid = better accuracy, more work
  - Larger grid = faster, blockier blobs
- ROI mode: search N×N box around last known position. If not found → fall back to full frame
- ROI toggle on HUD (on/off). When off, always full frame scan
- Blob detection source: XOR view only
- Run at 10-30fps, decoupled from render loop
- Output per blob: centroid (x,y), area, bounding box
- Filter: minimum area threshold to remove noise
- New files: useBlobDetection.ts, blobDetector.ts

## T2: Target Numbering on HUD ✅
- Each blob gets an auto-incremented ID (1, 2, 3...)
- Draw ID label at blob centroid on camera feeds (XOR view)
- IDs persist frame-to-frame via nearest-centroid matching
- HUD shows list: "T1: area 450 | T2: area 120 | T3: area 80"
- New files: TargetOverlay.tsx

## T3: Frame-to-Frame Matching ✅
- Match blobs across frames by nearest centroid + similar area
- If blob disappears: hold ID for N frames (prediction gap)
- If blob splits: keep larger part, treat smaller as new
- If blobs merge: keep lower ID
- New files: blobTracker.ts

## T4: Lock & Follow ✅
- Press 1-9 matching blob ID → lock that target
- Same key again → unlock
- One target locked at a time
- Flight director auto-yaws to keep target centered
- PD controller: error = target_centroid - image_center → yaw_rate
- Altitude follow: if target is above/below, pitch adjusts
- Standoff distance enforced (no collision during follow)
- Target lost behavior: enter search pattern, scan around last known position. If not found after N seconds → unlock
- HUD shows locked target info: ID, area, bearing, speed
- New files: useTargetLock.ts

## T5: Flight Director
- Thin layer between commands and drone controls
- Commands:
  - `idle` — hold current heading
  - `lock(id)` — auto-yaw to keep target centered
  - `approach(id, distance)` — lock + fly toward, stop at standoff
  - `fire(id)` — lead calculation + fly into target
- Orbit deferred to later phase
- Each command outputs smooth yaw/pitch/throttle via PD controller
- Command runs until replaced or target lost
- New files: flightDirector.ts

## T6: Kalman Filter
- State per tracked target: [x, y, z, vx, vy, vz]
- Predict: extrapolate with velocity
- Update: correct with new blob measurement
- Tuning: process noise vs measurement noise
- Run prediction-only when target disappears (holds track during search)
- Improves lock smoothness and enables lead calculation for fire
- New files: kalmanFilter.ts

## T7: Fire (Kamikaze)
- `fire(id)` command → aim at Kalman-predicted position
- Lead calculation: predict where target will be at impact time
- Drone accelerates toward predicted intercept point
- Collision detection already exists — handles impact
- Visual: HUD shows firing solution, predicted intercept
- New files: useFireSolution.ts

## Notes
- Blob detection runs on XOR view only
- Human does classification (sees blob, presses number)
- Blob detection runs at 10-30fps. Render at 60fps. Decouple via separate loop
- Distance estimation deferred — not needed for lock/fire, only pixel position matters
- When target lost during lock: search pattern around last known position, then unlock after timeout
- One lock at a time
