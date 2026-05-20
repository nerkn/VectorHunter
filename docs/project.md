# VectorHunter — Autonomous Drone Perception Simulator

Build a browser-based autonomous drone simulation platform focused on AI perception, target tracking, and realtime operator visualization.

See `docs/transaction_plan.md` for data flow, recording pipeline, scene system, and startup sequence.

The project should look and feel like a lightweight military/research drone control system, while remaining fully web-based and deployable publicly.

---

# Primary Goal

Create a visually impressive technical showcase that demonstrates:

* realtime 3D simulation
* dual onboard cameras
* AI perception pipeline
* autonomous target tracking
* telemetry systems
* realistic operator UI

The emphasis is NOT realistic aerodynamics.

The emphasis IS:

* perception
* autonomy
* visualization
* realtime systems
* engineering presentation

---

# Technical Stack

## Frontend

* Three.js
* React Three Fiber
* TypeScript
* Rapier.js physics
* Zustand state management

## Backend

* Python
* FastAPI
* OpenCV
* YOLOv8 nano
* WebSockets

## Deployment

* Frontend: Vercel or Cloudflare Pages
* Backend: Railway / Render / VPS

---

# Core Features

## 1. 3D World

Create a stylized but realistic environment:

* terrain
* roads
* buildings
* moving vehicles
* trees
* industrial/military atmosphere

Drone should freely fly in the environment.

Movement should feel smooth and believable.

---

# 2. Drone System

Drone includes:

* position
* velocity
* orientation
* camera gimbal
* telemetry state

Keyboard + mouse controls:

* throttle
* yaw
* pitch
* roll

No need for real flight physics initially.

Use simplified physics that feels responsive.

---

# 3. Dual Camera System

Drone contains:

* left camera
* right camera

Each camera:

* renders separately
* outputs low resolution 320x240 feed
* has slight noise/compression artifacts
* supports render-to-texture

Display feeds in operator UI.

Add:

* latency simulation
* signal degradation
* shaking/stabilization effects

Goal:
make feed look operational and believable.

---

# 4. AI Perception Pipeline

Send camera frames to Python backend through WebSockets.

Backend performs:

* object detection
* tracking
* target persistence

Detect:

* cars
* people
* drones

Use YOLOv8 nano for realtime performance.

Return:

* bounding boxes
* class labels
* tracking IDs
* confidence

Frontend overlays detections on video feed HUD.

---

# 5. Autonomous Tracking

Implement:

* target lock
* automatic camera tracking
* follow mode
* target reacquisition

Drone should:

* rotate toward targets
* maintain tracking
* predict target movement

Add scanning/search behavior when target disappears.

---

# 6. Stereo Vision (Fake or Semi-Real)

Use dual camera feeds to estimate depth.

Implement:

* disparity visualization
* distance estimation
* obstacle warning

Can be simplified/faked if necessary.

Main goal:
show stereo perception concepts visually.

---

# 7. Operator Interface

Create cinematic drone operator UI:

* minimap
* telemetry
* FPS
* signal strength
* battery
* altitude
* speed
* target information
* warnings

Visual style:

* dark tactical UI
* subtle animations
* modern defense-tech aesthetic

---

# 8. Visual Modes

Implement:

* normal RGB
* thermal vision shader
* night vision shader

Optional:

* fog
* rain
* low-light noise

---

# 9. Replay + Recording

Allow:

* mission replay
* camera playback
* timeline scrubbing

Record:

* drone movement
* detections
* operator actions

---

# Architecture Requirements

Frontend and backend must be modular.

Frontend:

* ECS-like structure preferred
* reusable camera pipeline
* clean simulation loop

Backend:

* async FastAPI
* websocket-based processing
* pluggable AI modules

---

# Performance Goals

Frontend:

* 60 FPS target
* optimized rendering
* instancing where possible

Backend:

* realtime inference
* low latency

---

# Final Presentation Goal

The final result should feel like:

* a defense-tech prototype
* robotics research platform
* autonomous surveillance drone system

The project should immediately communicate:

* AI engineering
* realtime systems
* computer vision
* simulation
* robotics-adjacent skills

Even if many systems are simplified internally.
