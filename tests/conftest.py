import asyncio
import os
import sys
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

TEST_DB = "test_water_tracker.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB}"

import pytest

from app.config import settings
from app.database import engine
from app.models.base import Base

settings.database_url = os.environ["DATABASE_URL"]

if "app.database" in sys.modules:
    import app.database as database_module

    database_module.engine = create_async_engine(settings.database_url, echo=False, future=True)
    database_module.AsyncSessionLocal = async_sessionmaker(
        bind=database_module.engine,
        class_=database_module.AsyncSession,
        expire_on_commit=False,
    )


def _reset_db():
    async def reset_schema():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(reset_schema())


@pytest.fixture(autouse=True)
def isolated_db():
    _reset_db()
    yield
