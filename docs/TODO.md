# TODO — Fresh Start

## Step 1: Verify Circle Actually Moves (5 min)
- [ ] Fresh reload, remove extra targets, start circle
- [ ] Track target position over 5 seconds — does it move in a circle?
- [ ] Verify radius ≈ 22m (at 11 m/s, 0.5 rad/s turn rate)
- [ ] If not moving → check TargetDrone.tsx, CIRCLE_TURN_RATE constant

## Step 2: Verify Figure8 Actually Crosses Itself (5 min)
- [ ] Start figure8, track positions over 10 seconds
- [ ] Does the path cross the center?
- [ ] If nearly straight → check CIRCLE_MAX_HEADING and FIGURE8_HALF_PERIOD

## Step 3: Verify Speed Display (2 min)
- [ ] HUD shows speed in m/s, not km/h
- [ ] Menu input labeled m/s

## Step 4: Systematic Test — Circle, Find + Track + Attack (15 min)
- [ ] Aim drone at target
- [ ] Run autoHunt 30s
- [ ] Record: lock time, track duration, missMs growth, DESTROYED Y/N
- [ ] If failed → snapshot to understand why

## Step 5: Systematic Test — Figure8 (15 min)
- [ ] Predict crossing point
- [ ] Position drone at crossing
- [ ] Run autoHunt 60s (figure8 is harder)
- [ ] Record same metrics

## Step 6: Record + Analyze Failures (as needed)
- [ ] startRecording() before autoHunt
- [ ] stopRecording() + save JSON
- [ ] Analyze XOR signal strength over time
- [ ] Identify fade patterns
- [ ] Tune threshold based on findings

## If Stuck
- Use `DEBUG.analyzeXor(5)` to see raw XOR blobs at any threshold
- Use `DEBUG.xorStats()` to see max pixel values and hot clusters
- Compare `tracked[].cx,cy` to `target.position` to see accuracy
- Check `tracked[].missMs` — growing = lost target
- Check `tracked[].hexFill` — <10% = fading signal