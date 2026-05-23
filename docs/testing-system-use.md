# Testing System Use Guide — Updated

## Setup (Fresh)
1. `browse97_start` to `http://localhost:3000`
2. Remove extra targets via `×` buttons — keep only the target you want to test
3. Set motion type and speed
4. Click START MISSION
5. Verify target is active: `DEBUG.snapshot().target.active === true`
6. Verify target moves: sample positions over 3-5s

## Debug API Reference

### Setup & Start
```javascript
// Note: preset_circle/figure8 may not re-init targetStore correctly yet.
// Workaround: use menu UI to configure targets, then START MISSION.
DEBUG.preset_circle()     // 11 m/s circle
DEBUG.preset_figure8()   // 8 m/s figure8
DEBUG.reset()            // back to menu
```

### State Inspection
```javascript
DEBUG.snapshot()              // { phase, drone, target, tracked[], noise, xorBlobs, xorFrame, cmd, locked }
DEBUG.getState()             // { phase, drone, targets[], gameTargets[], detection, flightDirector }
DEBUG.getTrackedDetail()     // all tracked blobs with cx,cy,area,missMs,residualSpeed,blobHex
DEBUG.analyzeXor(threshold?) // XOR blobs independent of tracker
DEBUG.xorStats()             // { w,h, maxPixel, avgPixel, nonzeroPct, hotPixelsAbove50, clusters[] }
```

### Control
```javascript
DEBUG.aimAtTarget('alpha')           // GPS-aim drone at target
DEBUG.lockTarget(1)                  // lock displayId 1
DEBUG.setCommand('fire', 1)          // fire command on T1
DEBUG.setParams({threshold:25, minArea:4, detectionFps:16})
DEBUG.setInput({forward:true, boost:true})
DEBUG.setPosition([x,y,z])
DEBUG.setYaw(radians)
```

### Auto-Hunt (full find→track→attack loop)
```javascript
DEBUG.autoHunt(60000).then(r => window.__result = r)
// Phases: approach (GPS fly to <40m) → track (pick blob closest to center) → fire
// Returns: 'TARGET DESTROYED in Nms!' or 'TIMEOUT after Nms. phase=X {...snapshot...}'
```

### Stepping
```javascript
DEBUG.stepFrames(30)        // pause after ~30 detection ticks
DEBUG.stepAndResume(30)     // don't pause
DEBUG.resume()
DEBUG.pause()
```

### Recording
```javascript
DEBUG.startRecording()
... actions ...
window.__rec = DEBUG.stopRecording()
```

---

## Test: Circle — Find + Track + Attack

```
1. Fresh tab → http://localhost:3000
2. UI: remove extra targets, motion=circle, speed=11, delay=0
3. START MISSION
4. Verify: DEBUG.snapshot().target.active === true
5. Verify circle moves:
   for i=0..5: setTimeout(() => log target pos, i*1000)
   → should see position change every second
6. Aim: DEBUG.aimAtTarget()
7. Hunt: DEBUG.autoHunt(30000).then(r => window.__hunt = r)
8. Check: window.__hunt
   → 'TARGET DESTROYED in Nms!' = SUCCESS
   → 'TIMEOUT...' = FAIL
9. If fail: DEBUG.snapshot() to see why (tracked[], xorBlobs, missMs)
```

## Test: Figure8 — Predict + Track + Attack

```
1-3: Same setup but motion=figure8, speed=8
4. Analyze figure8 path (10s of positions):
   var _pos = []; for i=0..20: setTimeout(() => _pos.push(snapshot().target.pos), i*500)
5. Identify crossing points
6. Position drone at crossing: DEBUG.setPosition([x, y, z])
7. DEBUG.aimAtTarget() + DEBUG.autoHunt(60000)
8. Note: figure8 crosses itself — may need multiple re-locks
```

---

## Common Debug Patterns

### "Target not moving"
- Check: `DEBUG.snapshot().xorBlobs` — XOR frame should have blobs
- Check: target active? `DEBUG.snapshot().target.active`
- Check: XOR pixel stats: `DEBUG.xorStats()`
- Check: drone position vs target position (same Z means drone at target)

### "XOR signal fading"
- Check: `DEBUG.xorStats().maxPixel` — should be >100
- Check: `DEBUG.analyzeXor(5).blobs.length` — dim blobs visible?
- Try: `DEBUG.setParams({threshold: 15})` — lower threshold
- Try: `DEBUG.setPosition([target.x - 20, target.y + 2, target.z])` — fly closer

### "Tracking jittery / lost"
- Check: `DEBUG.getTrackedDetail()` — missMs growing?
- Check: `highJerkFrames` — high = erratic, likely noise
- Check: `residualSpeed` — >50 = real target, <20 = background noise
- Try: `DEBUG.setParams({minArea: 6})` — bigger blobs = more stable

### "Target not detected"
- Check: `DEBUG.analyzeXor(10).blobs` — raw XOR blobs visible?
- Check: blob centers vs target position in image
- Check: drone yaw — aimed at target?
- Try: `DEBUG.aimAtTarget()` then check `xorStats().clusters`

### "Flight director losing lock"
- Check: `snap.cmd` and `snap.locked` — should be 'fire' and non-null
- Check: tracked blob missMs — if >500ms, fd gives up
- Fix: fd SEARCH_DURATION is 5000ms, increase if needed