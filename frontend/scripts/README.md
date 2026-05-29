## Scripts

Test and analysis tools for the blob tracker. Run with `npx tsx scripts/<name>.ts`.

### Setup

Record a flight in the app, then click **SAVE ALL** in the playback view. This creates a timestamped folder under `docs/frames/` containing:
- `frame_XXXX_WxH.gray` — raw grayscale frames (8-bit, W×H bytes each)
- `recording.json` — tracker state per frame + ground truth annotations

List saved sessions: `npx tsx scripts/test.ts sessions`

### test.ts — Tracker validation & strategy benchmarking

```
npx tsx scripts/test.ts sessions                                        # list saved sessions
npx tsx scripts/test.ts bench                                           # benchmark all strategies
npx tsx scripts/test.ts bench --dir=docs/frames/2026-05-27T22-57-05     # specific session
npx tsx scripts/test.ts compare                                         # compare strategies vs recording
npx tsx scripts/test.ts lifecycle                                       # track identity, bg velocity
npx tsx scripts/test.ts detail --strategy=flow                          # per-frame detail for one strategy
```

**Strategies:**

| Name | Algorithm |
|------|-----------|
| `default` | Original BlobTracker (slice-match + verify + classify) |
| `simple` | Nearest-neighbor centroid matching |
| `correlation` | Template block matching via SAD (16×16 patches) |
| `flow` | Block-matching optical flow + clustering |

**Commands:**

| Command | What it does |
|---------|-------------|
| `sessions` | List saved sessions with frame count and GT status |
| `bench` | Benchmark all strategies: timing, target counts |
| `compare` | Per-frame position comparison vs recording JSON |
| `lifecycle` | Track identity stability, bg velocity, ID switches |
| `detail` | Per-frame dump for one strategy |

### analyze.ts — Image analysis

Low-level gray frame inspection. Useful for debugging blob detection.

```
npx tsx scripts/analyze.ts docs/frames/<session> blobs [threshold] [minArea]
npx tsx scripts/analyze.ts docs/frames/<session> view <cx> <cy> [halfW] [halfH]
npx tsx scripts/analyze.ts docs/frames/<session> slice <cx> <cy> [halfW] [halfH]
npx tsx scripts/analyze.ts docs/frames/<session> match <cx> <cy> [halfW] [halfH] [radius] [threshold]
npx tsx scripts/analyze.ts docs/frames/<session> stats
```

**`blobs`** — Flood-fill all connected components above threshold, show position/area/bbox.

**`view`** — Render a region as ASCII hex (0-F, each char = 16 gray levels).

**`slice`** — Extract horizontal and vertical 1D slices through a point.

**`match`** — Run slice matching from frame 0 to all others, show best match position and SAD score.

**`stats`** — Per-frame pixel statistics (max, avg, nonzero count).

### perfBlockMatch.ts — Block matching benchmark

Measures 8×8 block SAD matching performance.

### simulate.ts — Full pipeline simulation

Runs the tracker over all frames with verbose output.
