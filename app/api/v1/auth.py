from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.auth import PasswordLoginRequest, RegisterRequest, WechatLoginRequest
from app.services.auth_service import authenticate_request, get_user_by_openid, login_from_password, register_user
from app.core.security import create_access_token, create_register_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/wechat-login")
async def wechat_login(payload: WechatLoginRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_openid(db, payload.openid)
    if user:
        if not payload.password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="password is required for existing user")
        if not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid password")
        token = create_access_token(user.user_id, extra={"openid": user.openid})
        return {
            "code": 0,
            "message": "success",
            "data": {
                "need_register": False,
                "token": token,
                "token_type": "Bearer",
                "expires_in": 7200,
                "user": {
                    "user_id": user.user_id,
                    "nickname": user.nickname,
                    "created_at": user.created_at.isoformat(),
                },
            },
        }
    register_token = create_register_token(payload.openid)
    return {
        "code": 0,
        "message": "success",
        "data": {
            "need_register": True,
            "register_token": register_token,
            "expires_in": 600,
        },
    }


@router.post("/register")
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await register_user(db, payload.register_token, payload.password, payload.nickname)
    return {"code": 0, "message": "success", "data": result}


@router.post("/password-login")
async def password_login(payload: PasswordLoginRequest, db: AsyncSession = Depends(get_db)):
    result = await login_from_password(db, payload.user_id, payload.password)
    return {"code": 0, "message": "success", "data": result}


@router.get("/me")
async def me(authorization: str | None = Header(default=None, alias="Authorization"), db: AsyncSession = Depends(get_db)):
    user = await authenticate_request(db, authorization)
    return {
        "code": 0,
        "message": "success",
        "data": {
            "user_id": user.user_id,
            "nickname": user.nickname,
            "created_at": user.created_at.isoformat(),
        },
    }
