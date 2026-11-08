"""Identity API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.core.security.passwords import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH
from app.modules.identity.models import AuthLevel
from app.modules.identity.service import AuthContext, NextStep

# Deliberately lenient: login only performs a lookup; strict validation would
# reject valid internal addresses (e.g. *.local) without adding security.
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=320, pattern=r"^\S+@\S+$"),
]
TotpCode = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{6}$")]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Email
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class MfaCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: TotpCode


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    timezone: str
    mfa_enabled: bool
    is_admin: bool
    last_login_at: datetime | None


class AuthStateResponse(BaseModel):
    user: UserOut
    auth_level: AuthLevel
    next_step: NextStep

    @classmethod
    def build(cls, ctx: AuthContext, next_step: NextStep) -> AuthStateResponse:
        return cls(
            user=UserOut.model_validate(ctx.user),
            auth_level=ctx.auth_level,
            next_step=next_step,
        )


class TotpEnrollmentResponse(BaseModel):
    secret: str
    provisioning_uri: str


class SessionOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    auth_level: AuthLevel
    user_agent: str | None
    ip_address: str | None
    current: bool
