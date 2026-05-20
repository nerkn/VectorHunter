from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from schemas import HealthResponse

app = FastAPI(title="VectorHunter API")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["http://localhost:5173"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"]
)

@app.get("/api/health", response_model=HealthResponse)
async def health_check():
  return {
    "status": "ok",
    "timestamp": datetime.utcnow().isoformat()
  }

@app.get("/")
async def root():
  return {"message": "VectorHunter API"}