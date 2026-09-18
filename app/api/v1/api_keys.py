from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.api_key import ApiKeyCreate
from app.services.api_key_service import create_api_key
from app.services.auth_service import authenticate_request

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


async def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: AsyncSession = Depends(get_db),
) -> User:
    return await authenticate_request(db, authorization)


@router.post("")
async def create_key(
    payload: ApiKeyCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.user_id and payload.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="user_id mismatch")
    result = await create_api_key(db, user.user_id, payload.name, payload.expires_at)
    return {"code": 0, "message": "success", "data": result}


@router.get("")
async def list_keys(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select

    rows = (await db.execute(select(__import__("app.models.api_key", fromlist=["ApiKey"]).ApiKey).where(__import__("app.models.api_key", fromlist=["ApiKey"]).ApiKey.user_id == user.user_id))).scalars().all()
    return {
        "code": 0,
        "message": "success",
        "data": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "key_prefix": r.key_prefix,
                "name": r.name,
                "is_active": r.is_active,
                "created_at": r.created_at.isoformat(),
                "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            }
            for r in rows
        ],
    }


@router.delete("/{key_id}")
async def delete_key(
    key_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.api_key import ApiKey

    key = await db.get(ApiKey, key_id)
    if not key or key.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="api key not found")
    await db.delete(key)
    await db.commit()
    return {"code": 0, "message": "success", "data": None}
