from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.water_goal import WaterGoal


async def set_water_goal(db: AsyncSession, user_id: str, target_ml: int) -> WaterGoal:
    existing = await db.scalar(select(WaterGoal).where(WaterGoal.user_id == user_id))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="goal already exists; use update")
    goal = WaterGoal(user_id=user_id, target_ml=target_ml)
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return goal


async def update_water_goal(db: AsyncSession, user_id: str, target_ml: int) -> WaterGoal:
    existing = await db.scalar(select(WaterGoal).where(WaterGoal.user_id == user_id))
    if existing is None:
        goal = WaterGoal(user_id=user_id, target_ml=target_ml)
        db.add(goal)
        await db.commit()
        await db.refresh(goal)
        return goal
    existing.target_ml = target_ml
    await db.commit()
    await db.refresh(existing)
    return existing


async def get_water_goal(db: AsyncSession, user_id: str) -> WaterGoal | None:
    return await db.scalar(select(WaterGoal).where(WaterGoal.user_id == user_id))
