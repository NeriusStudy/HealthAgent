from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as api_v1_router
from app.config import settings
from app.database import engine, init_db_sync
from app.models import ApiKey, User, WaterGoal, WaterRecord


@asynccontextmanager
async def lifespan(app: FastAPI):
    await __import__("app.database", fromlist=["init_db"]).init_db()
    yield


init_db_sync()
app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
