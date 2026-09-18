from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_key import ApiKey
from app.models.user import User


def generate_api_key() -> str:
    prefix = "wt_live_" + "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(12))
    suffix = "".join(secrets.choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(24))
    return prefix + suffix


async def create_api_key(db: AsyncSession, user_id: str, name: str | None, expires_at: datetime | None) -> dict:
    key_value = generate_api_key()
    hashed = hashlib.sha256(key_value.encode()).hexdigest()
    key = ApiKey(
        user_id=user_id,
        key_hash=hashed,
        key_prefix=key_value[:16],
        name=name,
        expires_at=expires_at,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return {
        "id": key.id,
        "api_key": key_value,
        "key_prefix": key.key_prefix,
        "name": key.name,
        "expires_at": key.expires_at,
        "created_at": key.created_at,
    }


async def validate_api_key(db: AsyncSession, api_key: str) -> User:
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    result = await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
    api_key_record = result.scalar_one_or_none()
    if not api_key_record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid api key")
    if not api_key_record.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="api key disabled")
    if api_key_record.expires_at:
        expires_at = api_key_record.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="api key expired")

    user = await db.get(User, api_key_record.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")
    return user
