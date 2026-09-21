from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AgentIdentity(Base):
    __tablename__ = "agent_identities"

    __table_args__ = (
        UniqueConstraint(
            "provider",
            "provider_account_id",
            "external_user_id",
            name="uq_agent_identity",
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    user_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("users.user_id"),
        nullable=False,
        index=True,
    )

    provider: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )

    provider_account_id: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )

    external_user_id: Mapped[str] = mapped_column(
        String(256),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
