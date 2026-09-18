from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.water_record import WaterRecord


async def create_water_record(db: AsyncSession, user_id: str, amount_ml: int, drank_at: datetime) -> WaterRecord:
    if drank_at.tzinfo is None:
        drank_at = drank_at.replace(tzinfo=timezone.utc)
    record = WaterRecord(user_id=user_id, amount_ml=amount_ml, drank_at=drank_at)
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def list_water_records(db: AsyncSession, user_id: str, page: int = 1, page_size: int = 50) -> tuple[list[WaterRecord], int]:
    if page < 1:
        page = 1
    if page_size < 1:
        page_size = 50
    if page_size > 200:
        page_size = 200

    stmt = select(WaterRecord).where(WaterRecord.user_id == user_id).order_by(WaterRecord.drank_at.desc())
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(stmt.offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return rows, total


async def list_water_records_range(db: AsyncSession, user_id: str, start_time: datetime, end_time: datetime, page: int = 1, page_size: int = 50):
    if page < 1:
        page = 1
    if page_size < 1:
        page_size = 50
    if page_size > 200:
        page_size = 200

    stmt = (
        select(WaterRecord)
        .where(WaterRecord.user_id == user_id)
        .where(WaterRecord.drank_at >= start_time)
        .where(WaterRecord.drank_at <= end_time)
        .order_by(WaterRecord.drank_at.desc())
    )
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(stmt.offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return rows, total


async def update_water_record(db: AsyncSession, user_id: str, record_id: int, amount_ml: int | None, drank_at: datetime | None) -> WaterRecord:
    record = await db.get(WaterRecord, record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="record not found")
    if record.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not allowed to modify this record")

    if amount_ml is not None:
        record.amount_ml = amount_ml
    if drank_at is not None:
        if drank_at.tzinfo is None:
            drank_at = drank_at.replace(tzinfo=timezone.utc)
        record.drank_at = drank_at

    await db.commit()
    await db.refresh(record)
    return record


async def delete_water_record(db: AsyncSession, user_id: str, record_id: int) -> None:
    record = await db.get(WaterRecord, record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="record not found")
    if record.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not allowed to delete this record")
    await db.delete(record)
    await db.commit()
