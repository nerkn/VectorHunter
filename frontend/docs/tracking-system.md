# Tracker Pipeline

## Flow

1. **FramePipeline** (60fps render, 16fps detection)
   - XOR left/right camera → `grayXor` (grayscale Uint8Array)
   - Call `tracker.setGrayImage(gray, w, h, threshold)`
   - Call `tracker.update()`

2. **BlobTracker.update()**
   - `initialScan()` — first frame only, finds all blobs
   - `verify()` — for each tracked object, slice-match at predicted position
   - `deduplicate()` — remove duplicates within 5px
   - `detectNew()` — find new blobs not covered by existing tracks
   - `classify()` — compute bgVel, residualSpeed, promote/demote
   - `expire()` — remove stale tracks

3. **verify()** (per tracked object)
   - Predict: `predCx = cx + vx*dt`
   - Extract sliceH/sliceV from gray at predicted position
   - Scan bright pixels (>threshold) in search radius
   - Compare slices with SAD at each bright pixel
   - Best match → compute centroid/bbox in halfW×halfH window
   - Fallback: wider search around last known position
   - Update velocity (smoothed), area (clamped to avgArea×1.5), bbox

4. **detectNew()**
   - Mark covered pixels around existing tracks
   - `blobFinder.nearbyBlobMerge()` on uncovered area
   - Adopt into missed tracks or create new noise entries

5. **classify()**
   - bgVel = median of noise (displayId=null, framesSeen≥5) velocities
   - residualSpeed = |vel - bgVel|
   - `lowResidualFrames` = consecutive frames where residualSpeed < threshold
   - `highResidualFrames` = consecutive frames where residualSpeed > threshold
   - Demote target→noise: `lrf ≥ 10` or `highJerk ≥ limit`
   - Promote noise→target: `hrf ≥ 5` (sustained motion for 5 frames)

6. **Expire()** — remove tracks missing too long

## Lingo

- **Raw blobs** — output of blobFinder flood fill
- **Noise** — tracked object with displayId=null, not yet confirmed
- **Target** — tracked object with displayId=1-9, confirmed moving object

## Slice Matching

Instead of NCC template matching (562ms for 9 objects), uses horizontal+vertical gray profiles:

- Extract sliceH (row of gray values) and sliceV (column of gray values) at predicted position
- At each bright pixel in search radius, extract candidate slices
- Compare with SAD (sum of absolute differences)
- Best SAD = closest shape match
- Bbox computed only in halfW×halfH window around match (not full search radius)
- Cost: O(w+h) per candidate, ~80× cheaper than NCC

## BlobFinder Detection Algorithms

Only `nearbyBlobMerge` is active. Others are available but unused:

| Algorithm | Method |
|---|---|
| nearbyBlobMerge | threshold → flood fill → merge → NMS ← **active** |
| dilateAndFloodFill | dilate → flood fill → NMS |
| hysteresis | dual-threshold grow → flood fill → NMS |
| dbscan | DBSCAN clustering |
| gaussianBlurPeak | blur → local max detection |
| integralImage | integral image box average → threshold |
| projection | row/col sum projections → peak intersection |
| maxPooling | max-pool downsample → local peak |

NMS = Non-Maximum Suppression — keeps strongest blob, removes weaker ones within distance

## Key Config

| Param | Default | Purpose |
|---|---|---|
| searchRadius | 30px | verify search area |
| minArea | 4 | minimum blob pixels |
| maxArea | 256 | maximum blob pixels |
| confirmationFrames | 10 | (replaced by hrf≥5) |
| demotionFrames | 10 | lrf threshold to demote |
| jerkDemotionFrames | 10 | hj threshold to demote |
| jerkThreshold | 120 | velocity change spike |
| residualThreshold | 25 | min speed to be "moving" |
| velocitySmoothing | 0.5 | EMA blend factor |
| maxMissingMs | 600 | expire timeout |
| maxNoiseObjects | 5 | max noise entries |
| frameDt | 1/24 | simulation timestep |

## Buffer Allocation

All buffers pre-allocated, zero per-frame GC:
- gray, binary (per-pixel threshold inline)
- _coveredBuf — marks tracked regions
- _sliceHRef/VRef/HCand/VCand — reusable slice buffers
- blobFinder: _thresholdBuf, _dilateBuf, _visitedBuf, _blurOut, _blurTemp, _queueBuf

## Analyze Script

`scripts/analyze.ts` — experiments on saved .gray frames

Usage:
```
npx tsx scripts/analyze.ts <dir> <command> [args...]
```

Commands:
- `blobs [threshold=25] [minArea=4]` — find blobs in all frames
- `slice <cx> <cy> [halfW=10] [halfH=3]` — extract horizontal/vertical gray slices at position
- `match <cx> <cy> [halfW=10] [halfH=3] [radius=30] [threshold=25]` — slice match first frame→all others
- `view <cx> <cy> [halfW=15] [halfH=10]` — ascii hex render of region
- `stats` — per-frame max/avg/nonzero statistics

Save .gray files from Playback with SAVE IMAGE button.
Filenames: `frame_NNNN_WxH.gray` (raw Uint8, W×H bytes)
