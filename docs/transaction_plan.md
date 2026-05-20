# Transaction Plan — VectorHunter

## Overview
Data flow between the browser front‑end and the FastAPI backend. Single‑user demo, no production hardening.

---

## 1. Cameras

| Cam | Position | Feed to Backend | Used For |
|-----|----------|-----------------|----------|
| **left** | Drone gimbal | Color 320×240 1fps + Mono 80×60 30fps | YOLO detection, motion |
| **right** | Drone gimbal | Color 320×240 1fps + Mono 80×60 30fps | YOLO detection, motion |
| **target** | On target, facing drone | Cinematic 720p 30fps | Recording, showcase |
| **overview** | Hovering overhead, both in frame | Cinematic 720p 30fps | Recording, showcase |

---

## 2. Transaction Types

| Transaction Type | Source → Dest | Payload | Frequency | Description |
|------------------|---------------|---------|-----------|-------------|
| **Color Frame** | Front‑end → Backend (WS) | Binary JPG 320×240 | 1 fps / cam (left, right) | YOLO detection. |
| **Mono Stream** | Front‑end → Backend (WS) | Binary 80×60 grayscale | 30 fps / cam (left, right) | Motion / disparity. |
| **Cinematic Stream** | Front‑end → Backend (WS) | Binary JPG 720p | 30 fps / cam (target, overview) | Recording to MP4. |
| **Detection Result** | Backend → Front‑end (WS) | JSON `{camera_id, detections}` | per color frame | Bounding boxes overlay on HUD. |
| **Telemetry** | Front‑end → Backend | JSON `{altitude, speed, battery, …}` | 10 Hz | UI state + mission log. |
| **Command** | Front‑end → Backend | JSON `{command}` | On‑demand | Mission actions. |
| **Record Control** | Front‑end → Backend | JSON `{action: "start" \| "stop", layout}` | On‑demand | Start/stop MP4 recording. |
| **Recording File** | Backend → Front‑end | MP4 download | On stop | Final composite video. |

---

## 3. Detailed Transaction Flow

### 3.1 Operational Cameras (left, right) → Detection Pipeline

1. **Client → Backend**
   - WebSocket per camera (`/ws/cam/{camera_id}`).
   - **Color frame**: 1 fps, 320×240, binary JPG → YOLO inference.
   - **Mono stream**: 30 fps, 80×60, raw grayscale bytes → motion / disparity.
   - Frames multiplexed on same WS with a 1‑byte header: `0x01` = color, `0x02` = mono.

2. **Backend (FastAPI)**
   - Decodes color frame → numpy array → YOLOv8‑nano inference in‑process.
   - Mono stream → lightweight motion / flow estimation.

3. **Backend → Client**
   - Detection payload on same WS: `{camera_id, detections: [{bbox, class, confidence, track_id}]}`.
   - Client overlays on HUD.

### 3.2 Cinematic Cameras (target, overview) → Composite Recording

All 4 camera streams + telemetry go into a **single ffmpeg process**. No individual saves.

1. **Client → Backend**
   - WebSocket per cinematic cam (`/ws/cinematic/{camera_id}`).
   - 720p JPG frames at 30 fps, binary.
   - Operational cams (left, right) also fed to recording pipeline at their native res.

2. **Backend → ffmpeg**
   - Single ffmpeg subprocess with `-filter_complex`.
   - All 4 streams piped in as separate inputs.
   - **Layout is selectable at record start** — passed as parameter.

3. **Layout presets** (defined as JSON config, selected by user or scene):

| Layout | Description | ffmpeg filter chain |
|--------|-------------|---------------------|
| `quad` | 2×2 grid, all cams equal | `hstack` + `vstack` |
| `pip` | Overview fullscreen, target as picture‑in‑picture | `overlay` |
| `focus` | Target cam fullscreen, overview as small corner | `overlay` |
| `ops` | Left + right side by side (operational view) | `hstack` |
| `cinematic` | Overview fullscreen only | passthrough |

   Layouts are not hardcoded — defined in config so new ones can be added without code changes.

4. **Telemetry overlay**
   - Telemetry JSON burned into video via ffmpeg `drawtext` filter.
   - Updated in real‑time through a named pipe or zmq feed.

5. **Record lifecycle**
   - `POST /api/record/start {layout: "quad"}` → spawns single ffmpeg process with chosen layout.
   - `POST /api/record/stop` → flushes ffmpeg, produces one `mission_{timestamp}.mp4`.
   - `GET /api/record/{id}/download` → returns the MP4.

### 3.3 Telemetry & Commands

- **Telemetry**: 10 Hz JSON messages, logged to SQLite for replay.
- **Commands**: Validated and applied immediately. Persisted to SQLite.

### 3.4 Playback

- `GET /api/record/list` → returns list of recorded missions.
- `GET /api/record/{id}/download` → downloads MP4.
- Frontend plays MP4 in a `<video>` element. No special player needed.

---

## 4. Scenes

Scenes are JSON configs loaded from the backend. Frontend builds the world from config.

### 4.1 Scene Schema

```json
{
  "name": "patrol_city",
  "description": "Urban patrol with vehicle tracking",
  "terrain": { "heightmap": "flat", "texture": "urban", "size": 500 },
  "static_objects": [
    { "type": "building", "position": [0, 0, 50], "scale": [10, 20, 10] }
  ],
  "dynamic_objects": [
    { "type": "car", "waypoints": [[0,0,0],[100,0,0],[100,0,100]], "speed": 5 }
  ],
  "targets": [
    { "type": "drone", "behavior": "patrol", "waypoints": [...], "speed": 8, "start_position": [50, 30, 50] }
  ],
  "weather": { "fog": 0.2, "wind": [1, 0, 0] },
  "drone_spawn": { "position": [0, 50, 0], "altitude": 50 },
  "default_layout": "quad"
}
```

### 4.2 Target Behavior

| Behavior | Description |
|----------|-------------|
| `patrol` | Follows waypoints in a loop. |
| `evade` | Follows waypoints, accelerates away when detected. |
| `hover` | Stays in place, rotates slowly. |
| `chase` | Follows the player drone. |

Simple waypoint follower. No ML needed. Optional evade triggers on detection event.

### 4.3 Scene API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scene/list` | GET | Returns available scene names + descriptions. |
| `/api/scene/{name}` | GET | Returns full scene JSON config. |

---

## 5. Startup Sequence

```
Backend starts
  ├── FastAPI + YOLO loaded into memory
  ├── Scan /scenes/*.json → available scenes
  ├── WebSocket endpoints ready
  └── Health check: GET /api/health → 200

Frontend loads
  ├── GET /api/health → backend alive?
  ├── GET /api/scene/list → populate scene selector
  ├── User picks scene → GET /api/scene/patrol_city
  ├── Three.js builds world from config
  │   ├── Terrain + static objects
  │   ├── Dynamic objects with waypoint paths
  │   └── Target with behavior script
  ├── Spawn drone at config.drone_spawn
  ├── Open WS connections:
  │   ├── /ws/cam/left
  │   ├── /ws/cam/right
  │   ├── /ws/cinematic/target
  │   └── /ws/cinematic/overview
  └── Render loop starts → user has control
```

No URL params. Frontend pulls everything from backend.

---

## 6. Data Schema

```python
class DetectionBox(BaseModel):
    bbox: Tuple[float, float, float, float]  # (x1, y1, x2, y2)
    class_id: int
    class_name: str
    confidence: float
    track_id: Optional[int] = None

class DetectionResult(BaseModel):
    camera_id: Literal["left", "right"]
    detections: List[DetectionBox]

class TelemetryMessage(BaseModel):
    timestamp: datetime
    altitude: float
    speed: float
    battery: float
    mode: str
    drone_position: Tuple[float, float, float]
    target_position: Tuple[float, float, float]

class CommandMessage(BaseModel):
    command: Literal["takeoff", "land", "switch_mode", "lock_target"]
    target_id: Optional[int] = None

class RecordControl(BaseModel):
    action: Literal["start", "stop"]
    layout: Optional[str] = "quad"
```

---

## 7. Concurrency

| Concern | Solution |
|---------|----------|
| **Operational frame processing** | asyncio in‑process queue. YOLO on color; lightweight motion on mono. |
| **Cinematic recording** | Single ffmpeg subprocess with `-filter_complex`. All streams composited in real‑time. |
| **Model warm‑up** | Load YOLOv8‑nano once at FastAPI startup. Keep in memory. |
| **Back‑pressure** | Drop oldest frame if queue > 2 frames deep. Never block the render loop. |
| **Bandwidth** | 2× mono (80×60 @ 30fps ≈ 150 KB/s) + 2× color (320×240 @ 1fps ≈ 50 KB/s) + 2× cinematic (720p @ 30fps ≈ 8 MB/s) ≈ **8–10 MB/s sustained upstream**. |

---

## 8. Deployment

```
+-------------------+        +-------------------+
|  Front‑end (Vercel)| <----> |  FastAPI (Railway) |
+-------------------+   WS   +-------------------+
                                |           |
                         +------+-----+ +--------+
                         |  YOLOv8    | | SQLite |
                         +------+-----+ +--------+
                                |
                         +------+-----+
                         |  ffmpeg    |
                         +------+-----+
                                |
                           MP4 files
```

Single container. ffmpeg available in Docker image. Recordings served as static files.
