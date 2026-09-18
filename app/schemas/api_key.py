from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ApiKeyCreate(BaseModel):
    user_id: str | None = None
    name: str | None = Field(default=None, max_length=64)
    expires_at: datetime | None = None


class ApiKeyOut(BaseModel):
    id: int
    user_id: str
    key_prefix: str
    name: str | None = None
    is_active: bool
    created_at: datetime
    expires_at: datetime | None = None
    api_key: str | None = None
