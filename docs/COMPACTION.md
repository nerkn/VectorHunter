# Fresh Start Companion

## Where We Left Off

### Main Goal
Build a working find → track → attack loop for a drone targeting system using stereo XOR blob detection.

### What's Fixed (This Session)
1. **Target behaviors** — Circle/figure8/line math was wrong. Fixed:
   - Speed now m/s (was km/h confusion)
   - `CIRCLE_TURN_RATE = 0.5 rad/s` added back (was deleted)
   - Figure8 heading oscillates ±60°, period 5s full cycle
   - Circle at 11 m/s: radius 22m, ~12.5s per lap
2. **Menu defaults** — default speed 11 m/s, changing motion resets delay to 0
3. **HUD display** — target speed now shows "m/s"
4. **DEBUG presets** — fixed to call `initFromConfig()` after `start()`
5. **autoHunt** — simplified to GPS-guided approach + teleport collision

### What Wasn't Finished
- **P0-2**: Target store re-init bug — FIXED in presets
- **P0-3**: stepFrames timing — uses wall-clock setInterval, not detection ticks
- **P1-1**: XOR signal fading — still loses blobs at 50m+ range
- **P1-2**: Ghost blob expiration
- **P1-3**: Dedup killing valid targets
- **P2**: Figure8 path doesn't cross yet — heading changes need tuning

### Debug API (window.DEBUG)
All working, call via `browse97_eval('DEBUG...')`.

---

## Status Update

**COMPLETED:**
- ✅ Circle motion verified - correct radius (~22m at 11 m/s)
- ✅ autoHunt(15000) successfully destroys target on circle scenario
- ✅ DEBUG presets fixed with proper targetStore init
- ✅ Collision detection (within 3 units) works

**REMAINING:**
- ❌ Figure8 path needs crossing behavior - currently weaves but doesn't self-intersect
- ❌ XOR tracking for actual find→track→fire needs testing at range

## If Stuck
- `DEBUG.analyzeXor(5)` — see raw XOR blobs at threshold 5
- `DEBUG.xorStats()` — max pixel values, hot clusters
- `DEBUG.getTrackedDetail()` — missMs, residualSpeed, hexFill per blob
- Lower threshold: `DEBUG.setParams({threshold: 15})`
- Fly closer: `DEBUG.setPosition([target.x - 20, target.y + 2, target.z])`

## Key Files to Know
- `src/debug/debugApi.ts` — all DEBUG functions
- `src/components/TargetDrone.tsx` — circle/figure8/line motion math
- `src/utils/blobTracker.ts` — tracker logic
- `src/store/flightDirector.ts` — auto-track/approach/fire