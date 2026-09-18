from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, create_register_token, decode_token, hash_password, verify_password
from app.models.user import User
from app.services.api_key_service import validate_api_key


def generate_user_id() -> str:
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    while True:
        value = "usr_" + "".join(secrets.choice(alphabet) for _ in range(16))
        return value


async def get_user_by_openid(db: AsyncSession, openid: str) -> User | None:
    result = await db.execute(select(User).where(User.openid == openid))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.user_id == user_id))
    return result.scalar_one_or_none()


async def register_user(db: AsyncSession, register_token: str, password: str, nickname: str | None) -> dict[str, Any]:
    try:
        payload = decode_token(register_token)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid register token") from exc
    if payload.get("type") != "register":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token type")

    openid = payload.get("sub")
    if not openid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing openid in token")

    existing = await get_user_by_openid(db, openid)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="openid already registered")

    user_id = generate_user_id()
    user = User(
        user_id=user_id,
        openid=openid,
        unionid=payload.get("unionid"),
        password_hash=hash_password(password),
        nickname=nickname,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.user_id, extra={"openid": user.openid})
    return {
        "token": token,
        "token_type": "Bearer",
        "expires_in": 7200,
        "user": {
            "user_id": user.user_id,
            "nickname": user.nickname,
            "created_at": user.created_at.isoformat(),
        },
    }


async def login_from_password(db: AsyncSession, user_id: str, password: str) -> dict[str, Any]:
    user = await get_user_by_id(db, user_id)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    token = create_access_token(user.user_id, extra={"openid": user.openid})
    return {
        "token": token,
        "token_type": "Bearer",
        "expires_in": 7200,
        "user": {
            "user_id": user.user_id,
            "nickname": user.nickname,
            "created_at": user.created_at.isoformat(),
        },
    }


async def authenticate_request(db: AsyncSession, authorization: str | None) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")

    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_token(token)
    except JWTError:
        try:
            return await validate_api_key(db, token)
        except HTTPException:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token or api key")

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token type")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing user id")

    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")
    return user
