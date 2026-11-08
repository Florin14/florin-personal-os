"""Identity ORM models: users and their sessions."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AuthLevel(StrEnum):
    """How strongly a session has been authenticated."""

    # Password verified; MFA verification or enrollment still pending.
    PASSWORD = "password"  # noqa: S105 - enum value, not a credential
    # Fully authenticated.
    FULL = "full"


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="email_lowercase"),)

    email: Mapped[str] = mapped_column(String(320), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Bucharest")

    totp_secret_encrypted: Mapped[str | None] = mapped_column(Text, default=None)
    totp_enabled_at: Mapped[datetime | None] = mapped_column(default=None)
    totp_last_used_step: Mapped[int | None] = mapped_column(BigInteger, default=None)

    failed_login_count: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None] = mapped_column(default=None)
    last_login_at: Mapped[datetime | None] = mapped_column(default=None)

    @property
    def mfa_enabled(self) -> bool:
        return self.totp_enabled_at is not None


class UserSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        CheckConstraint("auth_level IN ('password', 'full')", name="auth_level_valid"),
        Index("ix_user_sessions_user_id", "user_id"),
        Index("ix_user_sessions_expires_at", "expires_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    auth_level: Mapped[str] = mapped_column(String(16))
    expires_at: Mapped[datetime]
    last_seen_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)
    user_agent: Mapped[str | None] = mapped_column(String(512), default=None)
    ip_address: Mapped[str | None] = mapped_column(String(45), default=None)
