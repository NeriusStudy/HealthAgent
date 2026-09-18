from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class WaterRecordCreate(BaseModel):
    user_id: str | None = None
    amount_ml: int = Field(..., gt=0, le=5000)
    drank_at: datetime


class WaterRecordUpdate(BaseModel):
    amount_ml: int | None = Field(default=None, gt=0, le=5000)
    drank_at: datetime | None = None


class WaterRecordOut(BaseModel):
    id: int
    user_id: str
    amount_ml: int
    drank_at: datetime
    created_at: datetime
    updated_at: datetime


class WaterRecordListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    records: list[WaterRecordOut]
