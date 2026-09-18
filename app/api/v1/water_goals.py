from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.water_goal import WaterGoalSet
from app.services.auth_service import authenticate_request
from app.services.water_goal_service import get_water_goal, set_water_goal, update_water_goal

router = APIRouter(prefix="/water-goals", tags=["water-goals"])


async def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: AsyncSession = Depends(get_db),
) -> User:
    return await authenticate_request(db, authorization)


@router.post("")
async def set_goal(
    payload: WaterGoalSet,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.user_id and payload.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="user_id mismatch")
    goal = await set_water_goal(db, user.user_id, payload.target_ml)
    return {
        "code": 0,
        "message": "success",
        "data": {
            "id": goal.id,
            "user_id": goal.user_id,
            "target_ml": goal.target_ml,
            "created_at": goal.created_at.isoformat(),
            "updated_at": goal.updated_at.isoformat(),
        },
    }


@router.put("")
async def update_goal(
    payload: WaterGoalSet,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.user_id and payload.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="user_id mismatch")
    goal = await update_water_goal(db, user.user_id, payload.target_ml)
    return {
        "code": 0,
        "message": "success",
        "data": {
            "id": goal.id,
            "user_id": goal.user_id,
            "target_ml": goal.target_ml,
            "created_at": goal.created_at.isoformat(),
            "updated_at": goal.updated_at.isoformat(),
        },
    }


@router.get("")
async def get_goal(
    user_id: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_user_id = user_id or user.user_id
    if target_user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not allowed to access other user's goal")
    goal = await get_water_goal(db, target_user_id)
    return {"code": 0, "message": "success", "data": None if goal is None else {
        "id": goal.id,
        "user_id": goal.user_id,
        "target_ml": goal.target_ml,
        "created_at": goal.created_at.isoformat(),
        "updated_at": goal.updated_at.isoformat(),
    }}
