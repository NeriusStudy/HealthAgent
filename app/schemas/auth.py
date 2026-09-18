from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class WechatLoginRequest(BaseModel):
    openid: str = Field(..., min_length=1)
    password: str | None = Field(default=None, min_length=1)


class RegisterRequest(BaseModel):
    register_token: str = Field(..., min_length=1)
    password: str = Field(..., min_length=6, max_length=32)
    nickname: str | None = Field(default=None, max_length=64)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not any(ch.isalpha() for ch in value) or not any(ch.isdigit() for ch in value):
            raise ValueError("password must contain both letters and digits")
        return value


class PasswordLoginRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class UserOut(BaseModel):
    user_id: str
    nickname: str | None = None
    created_at: str | None = None


class AuthResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: dict
