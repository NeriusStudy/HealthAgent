from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.water_record import WaterRecordCreate, WaterRecordUpdate
from app.services.auth_service import authenticate_request
from app.services.water_record_service import create_water_record, delete_water_record, list_water_records, list_water_records_range, update_water_record

router = APIRouter(prefix="/water-records", tags=["water-records"])


async def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: AsyncSession = Depends(get_db),
) -> User:
    return await authenticate_request(db, authorization)


@router.post("")
async def create_record(
    payload: WaterRecordCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.user_id and payload.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="user_id mismatch")
    record = await create_water_record(db, user.user_id, payload.amount_ml, payload.drank_at)
    return {
        "code": 0,
        "message": "success",
        "data": {
            "id": record.id,
            "user_id": record.user_id,
            "amount_ml": record.amount_ml,
            "drank_at": record.drank_at.isoformat(),
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
        },
    }


@router.get("")
async def list_records(
    user_id: str | None = None,
    page: int = 1,
    page_size: int = 50,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_user_id = user_id or user.user_id
    if target_user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not allowed to access other user's records")
    rows, total = await list_water_records(db, target_user_id, page=page, page_size=page_size)
    return {
        "code": 0,
        "message": "success",
        "data": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "records": [
                {
                    "id": r.id,
                    "user_id": r.user_id,
                    "amount_ml": r.amount_ml,
                    "drank_at": r.drank_at.isoformat(),
                    "created_at": r.created_at.isoformat(),
                    "updated_at": r.updated_at.isoformat(),
                }
                for r in rows
            ],
        },
    }


@router.get("/range")
async def list_records_range(
    user_id: str | None = None,
    start_time: datetime = Query(...),
    end_time: datetime = Query(...),
    page: int = 1,
    page_size: int = 50,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_user_id = user_id or user.user_id
    if target_user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not allowed to access other user's records")
    rows, total = await list_water_records_range(db, target_user_id, start_time, end_time, page=page, page_size=page_size)
    return {
        "code": 0,
        "message": "success",
        "data": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "records": [
                {
                    "id": r.id,
                    "user_id": r.user_id,
                    "amount_ml": r.amount_ml,
                    "drank_at": r.drank_at.isoformat(),
                    "created_at": r.created_at.isoformat(),
                    "updated_at": r.updated_at.isoformat(),
                }
                for r in rows
            ],
        },
    }


@router.put("/{record_id}")
async def update_record(
    record_id: int,
    payload: WaterRecordUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await update_water_record(db, user.user_id, record_id, payload.amount_ml, payload.drank_at)
    return {
        "code": 0,
        "message": "success",
        "data": {
            "id": record.id,
            "user_id": record.user_id,
            "amount_ml": record.amount_ml,
            "drank_at": record.drank_at.isoformat(),
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
        },
    }


@router.delete("/{record_id}")
async def delete_record(
    record_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await delete_water_record(db, user.user_id, record_id)
    return {"code": 0, "message": "success", "data": None}
