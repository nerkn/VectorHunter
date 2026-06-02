# Tracker Code Quality Evaluation

Date: 2026-06-02 | Session: 2026-06-02T07-26-36 | 26 frames, 640×480, threshold=25, 24fps

## BlobTracker (core / DEFAULT strategy)

### Memory
- Per-track: ~250 bytes (TrackedBlob: 64-byte refBlock, 2 slices, velocity fields)
- `_coveredBuf`: full frame (640×480 = 300KB), allocated once, reused
- `findNearestBlob` allocates `visited` (300KB) + `queue` (1.2MB Int32) every call — biggest waste. Each track that misses template match triggers full BFS. 10 noise tracks = 10× fresh allocations/frame
- `refSliceH`/`refSliceV` extracted but never used in matching — dead memory
- No pooling of refBlock Uint8Arrays

### Structure
- Single 700-line god class: verify, detect, dedup, classify, expire, template matching, flood fill, centroid
- `verify()` ~120 lines, 3 nested paths (template hit / blob fallback / miss) — hard to follow
- Pipeline order (verify→detect→dedup→classify→expire) correct but tightly coupled
- `initialScan` duplicates logic from `detectNew`

### Weaknesses
- `findSliceMatch` brute-force scans every pixel in search window: O(searchRadius²) per track. Radius=50 → up to 10K pixels × blockSad(8×8=64) = 640K ops/track
- Template matching on raw grayscale — no edge/gradient normalization, fails on brightness changes
- `findNearestBlob` does full connected-component BFS for fallback — expensive, heavy allocation
- No multi-scale: drone at different ranges won't match fixed 8×8 refBlock
- `classify()` computes own bgVx/bgVy independently from WrappedBlobTracker — two bg estimators fighting
- `consistentMatch` check in verify redundant with `highJerkFrames` in classify
- Magic numbers everywhere (0.6, 0.4, 0.9, 0.1 smoothing)

### Optimizations
- Pool `findNearestBlob` visited/queue buffers (like `_coveredBuf`)
- Use blobFinder results in verify instead of re-running flood fill
- Remove unused `refSliceH`/`refSliceV`, `extractSliceH`/`extractSliceV`
- Early-exit in blockSad when cumulative SAD exceeds current best
- Downsample search (coarse-to-fine like DriftTracker)
- Template on gradients/edges instead of raw pixels

---

## WrappedBlobTracker

### Memory
- Second BlobFinder instance (300KB buffers) for bg velocity — doubles BlobFinder memory
- `histBuf`: small, reused
- `prevBlobs`: shallow copies each frame

### Structure
- Clean wrapper — delegates tracking to BlobTracker, adds bg velocity
- `computeBgVelocity` ~90 lines, well-contained
- Histogram voting for motion estimation is robust

### Weaknesses
- Runs `nearbyBlobMerge` (full threshold + flood fill + merge) every frame for bg velocity. Inner BlobTracker also runs it in `detectNew`. **Two full blob detections per frame**
- Hardcoded `dt = 1/24` — should come from config
- `smooth = 0.5` — raw velocity 50/50 mix, noisy on first frames
- No handling of scene cuts or large bg jumps (camera pan start/stop)
- Filters out largest-50%-area blobs for bg estimation — if drone IS largest, remaining noise may be too few for reliable voting

### Optimizations
- Share blobFinder between bg velocity and inner tracker (run once, use results twice)
- Sparse feature tracking instead of full blob detection for bg velocity
- Adaptive smoothing alpha (higher confidence = more weight)

---

## DriftTracker

### Memory
- Per-blob: ~400 bytes + snapshot (50×50 = 2.5KB) + positionHistory + residualHistory
- `visitedMap`: full frame Uint32Array (1.2MB) — reused via stamp trick, good
- `ffStack`: reused array
- `grid`: 600 booleans — negligible
- `lastFrameBlobs`: populated but **never read** — dead code/field

### Structure
- Three-tier type system (smal→bg→target) — intuitive, but complex transition logic
- Pipeline: matchAll→scanGrid→merge→typeTransitions→expire — reasonable
- `computeBgVel` uses MAD-based outlier rejection — more robust than voting
- `matchAll` processes by type priority (target first) — correct

### Weaknesses
- `nearbyBlobMerge` called **twice per frame**: once in `matchAll`, again in `scanGrid`. Should run once
- `findInNextFrame` does coarse scan + gradient ascent, but `computeShiftAdd` averages raw pixel values (not SAD or correlation). Bright regions score high regardless of shape. Commented-out threshold (`if (bestScore < 30) return null`) was disabled — always returns something
- `computeShiftAdd` comment says "XOR images" but snapshot is raw gray — not XOR
- `lastFrameBlobs` written in `scanGrid`, never read — dead field
- `dt = 1/16` hardcoded, inconsistent with actual 24fps
- `isMovingConsistently` requires 4 history points + dot product coherence — too strict for slow/linear targets
- `absorb` velocity averaging `(v1+v2)/2` doesn't account for mass ratio
- No target→bg demotion based on residual (only confidence at -10/frame)

### Optimizations
- Single `nearbyBlobMerge` call, pass results to both matchAll and scanGrid
- Remove `lastFrameBlobs` dead field
- Fix dt to 1/24 or make configurable
- Use actual SAD/NCC in `findInNextFrame` instead of average brightness
- Cap `positionHistory` (already done via historyLen)

---

## ShapeTracker

### Memory
- Per-target: ~200 bytes + 50×50 snapshot (2.5KB) — always allocated max size even for small blobs
- `bgHistBuf`: reused, small
- `prevNoiseBlobs`: shallow

### Structure
- Simplest strategy — only tracks "targets" (large blobs), uses noise for bg velocity
- No type tiers, no merge, no template matching — just nearest-blob assignment
- `classifyByShape` splits by area — clean

### Weaknesses
- Snapshot stored but **never used for matching** — `matchTargets` does nearest-distance only. Dead memory/code
- No occlusion handling — greedy nearest-distance can swap IDs on overlap
- `scanNewTargets` fixed 30px proximity — doesn't scale with target size
- No deduplication — two targets can converge to same blob
- `consecutiveMisses` is **global** across all targets — one target's miss grows radius for ALL
- `dt = 1/16` hardcoded, wrong for 24fps
- `updateSnapshot` writes up to 2500 bytes/target/frame even when barely moving
- No bg velocity compensation in prediction: `predCx = cx + vx * dt` doesn't subtract bgVx

### Optimizations
- Remove snapshot entirely or use it for re-identification
- Make `consecutiveMisses` per-target
- Fix prediction: `predCx = cx + (vx - bgVx) * dt + bgDx`
- Reduce snapshot write frequency (only on significant position change)
- Fix dt to 1/24

---

## Cross-cutting Issues

| Issue | BlobTracker | DriftTracker | ShapeTracker |
|-------|------------|--------------|--------------|
| Wrong dt (1/16 vs 1/24) | ✓ config | ✗ hardcoded | ✗ hardcoded |
| BlobFinder runs/frame | 2 (inner+detect) | 2 (matchAll+scanGrid) | 1 |
| Snapshot/template used? | ✓ blockSad | ⚠ avg brightness | ✗ dead |
| bg velocity source | classify median | own MAD | noise blob voting |
| Display ID alloc sort | O(n log n) | O(n log n) | O(n log n) |

- **Duplicate bg velocity**: WrappedBlobTracker computes it, then BlobTracker.classify() computes its own. DriftTracker and ShapeTracker each have their own. Four independent estimators for three strategies.
- **Display ID allocation**: all three sort the pool every allocation — should use sorted free list or min-heap.
