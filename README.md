# VectorHunter

Autonomous Drone Perception Simulator

## Structure

- `frontend/` - Vite + React + TypeScript + R3F + Zustand
- `backend/` - FastAPI + uvicorn
- `shared/` - JSON schemas shared between FE and BE

## Setup

Frontend (from ./frontend):
```bash
npm install
npm run dev
```

Backend (from ./backend):
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```