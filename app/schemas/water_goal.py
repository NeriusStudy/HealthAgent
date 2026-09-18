from __future__ import annotations

from pydantic import BaseModel, Field


class WaterGoalSet(BaseModel):
    user_id: str | None = None
    target_ml: int = Field(..., gt=0)


class WaterGoalOut(BaseModel):
    id: int
    user_id: str
    target_ml: int
    created_at: str
    updated_at: str
