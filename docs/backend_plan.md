# Backend Plan — VectorHunter
(Not in active build cycle. Reference for when backend work begins.)

## Backend 1: WebSocket Bridge
- WebSocket endpoints: `/ws/cam/{camera_id}`
- Frame ingestion: color (640×480 JPG, 1fps) + mono (80×60 raw, 30fps)
- 1-byte header multiplexing: 0x01=color, 0x02=mono
- Connection lifecycle (connect, reconnect, drop handling)
- Frontend streams frames from both onboard cams

## Backend 2: YOLOv8 Detection Pipeline
- YOLOv8-nano loaded at FastAPI startup
- Inference on color frames in-process
- Detection results: bbox, class, confidence, track_id
- Results pushed back on same WebSocket
- Frontend HUD overlay: bounding boxes + labels on camera feeds

## Backend 3: Cinematic Stream Ingest
- WebSocket endpoints: `/ws/cinematic/{camera_id}`
- 720p JPG frames at 30fps from target cam + overview cam
- Piped into ffmpeg for recording

## Backend 4: Recording Pipeline
- Single ffmpeg process, all 4 streams + telemetry composited
- Layout presets (quad, pip, focus, ops, cinematic) selectable at record start
- Layouts defined in config, not hardcoded
- Telemetry overlay via ffmpeg drawtext
- `/api/record/start`, `/api/record/stop`, `/api/record/{id}/download`
- One output MP4 per recording

## Backend 5: Playback API
- `/api/record/list` → recorded missions
- `/api/record/{id}/download` → MP4 file
- Serve recordings as static files

## Backend 6: Telemetry Persistence
- 10Hz telemetry from frontend
- SQLite logging
- Queryable for replay
