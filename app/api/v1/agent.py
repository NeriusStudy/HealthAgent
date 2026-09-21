from __future__ import annotations

import hashlib
import hmac
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import hash_password
from app.database import get_db
from app.models.agent_identity import AgentIdentity
from app.models.api_key import ApiKey
from app.models.user import User
from app.schemas.agent_bootstrap import AgentBootstrapRequest
from app.services.api_key_service import create_api_key
from app.services.auth_service import generate_user_id

router = APIRouter(prefix="/agent", tags=["agent"])


def verify_bootstrap_secret(
    authorization: str | None,
) -> None:
    expected = settings.agent_bootstrap_secret

    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="agent bootstrap is not configured",
        )

    if (
        not authorization
        or not authorization.startswith("Bearer ")
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bootstrap credential",
        )

    supplied = authorization.split(" ", 1)[1]

    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid bootstrap credential",
        )


@router.post("/bootstrap")
async def bootstrap_agent_user(
    payload: AgentBootstrapRequest,
    authorization: str | None = Header(
        default=None,
        alias="Authorization",
    ),
    db: AsyncSession = Depends(get_db),
):
    verify_bootstrap_secret(authorization)

    identity = await db.scalar(
        select(AgentIdentity).where(
            AgentIdentity.provider == payload.provider,
            AgentIdentity.provider_account_id
            == payload.provider_account_id,
            AgentIdentity.external_user_id
            == payload.external_user_id,
        )
    )

    created_user = False

    if identity:
        user = await db.get(User, identity.user_id)

        if user is None:
            raise HTTPException(
                status_code=500,
                detail="agent identity points to missing user",
            )
    else:
        identity_material = (
            f"{payload.provider}\0"
            f"{payload.provider_account_id}\0"
            f"{payload.external_user_id}"
        )

        synthetic_openid = (
            "agent_"
            + hashlib.sha256(
                identity_material.encode("utf-8")
            ).hexdigest()[:56]
        )

        user = await db.scalar(
            select(User).where(
                User.openid == synthetic_openid
            )
        )

        if user is None:
            user = User(
                user_id=generate_user_id(),
                openid=synthetic_openid,
                unionid=None,
                password_hash=hash_password(
                    secrets.token_urlsafe(32)
                ),
                nickname="ClawBot User",
            )

            db.add(user)
            await db.flush()
            created_user = True

        identity = AgentIdentity(
            user_id=user.user_id,
            provider=payload.provider,
            provider_account_id=payload.provider_account_id,
            external_user_id=payload.external_user_id,
        )

        db.add(identity)

        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()

            identity = await db.scalar(
                select(AgentIdentity).where(
                    AgentIdentity.provider
                    == payload.provider,
                    AgentIdentity.provider_account_id
                    == payload.provider_account_id,
                    AgentIdentity.external_user_id
                    == payload.external_user_id,
                )
            )

            if identity is None:
                raise

            user = await db.get(
                User,
                identity.user_id,
            )

            if user is None:
                raise HTTPException(
                    status_code=500,
                    detail="agent bootstrap race failed",
                )

            created_user = False

    account_hash = hashlib.sha256(
        payload.provider_account_id.encode("utf-8")
    ).hexdigest()[:12]

    key_name = (
        f"agent:{payload.provider}:{account_hash}"
    )[:64]

    # bootstrap 再次发生时，撤销这个 Agent 身份之前的自动 Key。
    old_keys = (
        await db.execute(
            select(ApiKey).where(
                ApiKey.user_id == user.user_id,
                ApiKey.name == key_name,
                ApiKey.is_active.is_(True),
            )
        )
    ).scalars().all()

    for old_key in old_keys:
        old_key.is_active = False

    if old_keys:
        await db.commit()

    key = await create_api_key(
        db,
        user.user_id,
        key_name,
        None,
    )

    return {
        "code": 0,
        "message": "success",
        "data": {
            "user_id": user.user_id,
            "created_user": created_user,
            "api_key": key["api_key"],
            "key_prefix": key["key_prefix"],
        },
    }
