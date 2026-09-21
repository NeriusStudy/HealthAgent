from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    app_name: str = "water-tracker"
    app_env: str = "development"
    debug: bool = False
    database_url: str = Field(
        default_factory=lambda: os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./water_tracker.db")
    )
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 120
    jwt_register_token_expire_minutes: int = 10
    wechat_appid: str = "test-appid"
    wechat_secret: str = "test-secret"
    cors_origins: str = "*"
    agent_bootstrap_secret: str = ""

    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")


settings = Settings()
