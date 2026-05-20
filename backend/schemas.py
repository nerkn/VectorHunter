from pydantic import BaseModel
from typing import Optional, Tuple, Literal


class HealthResponse(BaseModel):
  status: str
  timestamp: str

class DetectionBox(BaseModel):
  bbox: Tuple[float, float, float, float]
  class_id: int
  class_name: str
  confidence: float
  track_id: Optional[int] = None

class DetectionResult(BaseModel):
  camera_id: Literal["left", "right"]
  detections: list[DetectionBox]

class TelemetryMessage(BaseModel):
  timestamp: str
  altitude: float
  speed: float
  battery: float
  mode: str
  drone_position: Tuple[float, float, float]
  target_position: Optional[Tuple[float, float, float]] = None

class CommandMessage(BaseModel):
  command: Literal["takeoff", "land", "switch_mode", "lock_target"]
  target_id: Optional[int] = None

class RecordControl(BaseModel):
  action: Literal["start", "stop"]
  layout: Optional[str] = "quad"