# Test & Debug Scripts

## Files

| Script | Purpose |
|--------|---------|
| `test.ts` | Run detection strategies against recorded frame sessions. Benchmark, compare, ground-truth validation. |
| `visualize_sad.ts` | Generate heatmap PNGs comparing matching metrics (SAD vs ShiftAdd) at a specific frame. Debug why template matching loses targets. |

---

## Quick Start

```bash
# List available sessions
npx tsx scripts/test.ts sessions

# Benchmark all strategies on a session
npx tsx scripts/test.ts bench --dir=docs/frames/2026-05-29T12-47-47

# Per-frame detail for DRIFT strategy
npx tsx scripts/test.ts detail --dir=docs/frames/2026-05-29T12-47-47 --strategy=drift

# Ground truth comparison (requires annotated recording)
npx tsx scripts/test.ts gt --dir=docs/frames/2026-05-29T12-47-47

# Compare strategies vs recording's tracked positions
npx tsx scripts/test.ts compare --dir=docs/frames/2026-05-30T19-17-49

# Generate heatmap for frame 14
npx tsx scripts/visualize_sad.ts docs/frames/2026-05-30T19-17-49 14

# Lifecycle analysis (id switches, bg velocity)
npx tsx scripts/test.ts lifecycle --dir=docs/frames/2026-05-29T12-47-47
```

---

## test.ts

### Commands

#### `sessions`
Lists all directories under `docs/frames/` with frame count, recording status, and ground truth availability.

```bash
npx tsx scripts/test.ts sessions
```

Output:
```
2026-05-30T19-17-49  46 frames  ✓ rec  ✗ GT
2026-05-29T12-47-47  61 frames  ✓ rec  ✓ GT
```

#### `bench`
Runs all 4 strategies on every frame, reports timing and target counts.

```bash
npx tsx scripts/test.ts bench --dir=docs/frames/2026-05-29T12-47-47
```

Output columns: `Total ms | Avg ms | Max ms | Targets found | Avg tracked`

#### `compare`
Compares each strategy's `displayId=1` target position against the recording's `displayId=1`. Frame-by-frame table.

```bash
npx tsx scripts/test.ts compare --dir=docs/frames/2026-05-30T19-17-49
```

- `OK` = within 30px of recording position
- `---` = neither recording nor strategy found a target (also OK)
- `Npx` = distance in pixels (mismatch)

Summary line: `DRIFT  : 12 OK, 11 mismatch, 0 no-detection`

#### `detail`
Per-frame output for a single strategy. Shows each tracked target's position, background velocity, and noise count (blobs without displayId).

```bash
npx tsx scripts/test.ts detail --dir=docs/frames/2026-05-30T19-17-49 --strategy=drift
```

Output:
```
f39 4.7ms | d1(#24 424,231 a=54) | bg=(0,-64) | noise=3
```

#### `gt` (Ground Truth)
Compares strategies against manually annotated ground truth positions. Requires `recording.json` with `groundTruth` field (annotated in Playback UI).

```bash
npx tsx scripts/test.ts gt --dir=docs/frames/2026-05-29T12-47-47
```

Options:
- `--thr=N` — match threshold in pixels (default 30)
- `--debug` — enable strategy debug output

Output:
```
Strategy  | Found | Missed | Wrong | Avg err | Max err | Avg ms
DRIFT   |    47 |      7 |     3 |   13.3 |   42.2 | 6.3
```

- **Found** = tracked target within threshold of GT position
- **Missed** = GT exists but strategy found no target
- **Wrong** = strategy found target but outside threshold
- **Avg err** = average pixel distance (of found + wrong)
- **Max err** = worst case pixel distance

Followed by per-frame detail showing GT position vs each strategy's closest target with ✓/✗ markers.

#### `lifecycle`
Analyzes tracking identity stability across frames. Reports ID switches (same displayId mapped to different internalIds), max simultaneous targets, and average background speed.

```bash
npx tsx scripts/test.ts lifecycle --dir=docs/frames/2026-05-29T12-47-47
```

### Strategies

| Name | Description |
|------|-------------|
| `default` | Original BlobTracker — median background velocity + slice matching |
| `flow` | Block-matching optical flow with raw flow background velocity |
| `hybrid` | Flow detection + raw flow bg velocity + strict classification |
| `drift` | DriftTracker — snapshot template matching with ShiftAdd metric, promotion pipeline (smal→bg→target) |

### Data Format

Sessions live in `docs/frames/<timestamp>/`. Each session contains:

- `*.gray` files — raw grayscale frames, filename format `<W>x<H>.gray` or `frame_N_WxH.gray`
- `recording.json` — tracked blob data per frame including `refBlock` (snapshot pixels), velocities, positions
- GT is stored as `groundTruth.frames[].targets[]` inside `recording.json`

---

## visualize_sad.ts

Generates 3-panel heatmap PNG comparing SAD vs ShiftAdd matching metrics at a specific frame. Used to debug why template matching succeeds or fails.

```bash
npx tsx scripts/visualize_sad.ts <dir> [frameIdx]
```

- `dir` — session directory (must contain `recording.json` and `.gray` files)
- `frameIdx` — frame number to analyze (default 14)

### Output Files

Writes to the session directory:

| File | Content |
|------|---------|
| `sad_f<N>_heatmap.png` | 3-panel: SAD heatmap \| ShiftAdd heatmap \| search area with crosshairs |
| `sad_f<N>_snapshot.png` | The snapshot template (reference block) scaled 5× |
| `sad_f<N>_searcharea.png` | The search region from the frame, scaled 5× |

### Heatmap Panels

**Left panel — SAD** (lower = better match)
- Blue→green→yellow→red color ramp (auto-scaled to data range)
- White cell = SAD minimum (best match)
- Yellow cell = actual target position (from recording)

**Middle panel — ShiftAdd `(a+b)>>1`** (higher = better match)
- Same color ramp direction
- White cell = ShiftAdd maximum
- Yellow cell = actual target position

**Right panel — Search area**
- Raw grayscale boosted 3× for visibility
- Crosshairs:
  - **Yellow** = actual target position (from recording)
  - **White** = SAD best position
  - **Green** = ShiftAdd best position (raw)
  - **Cyan** = ShiftAdd corrected (best + snapW/2, snapH/2)

### Console Output

Prints numeric grid values, ranges, and delta (max-min) for both metrics. Useful when PNG inspection isn't available — a flat SAD delta (e.g., < 2) confirms the metric has no discrimination power at that frame.

### Metrics Explained

| Metric | Formula | Direction | Works on XOR? |
|--------|---------|-----------|---------------|
| SAD | `mean(\|a - b\|)` | lower = better | No — background 0-vs-0 dominates, flat response |
| ShiftAdd | `mean((a + b) >> 1)` | higher = better | Yes — bright+bright produces peak at correct position |
| ClampAdd | `mean(min(a+b, 256))` | lower = better | No — clamping inverts discrimination |
