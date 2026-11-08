"""FastAPI dependencies for authentication and CSRF protection."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from app.core.dependencies import DbSession, SecretBoxDep, SettingsDep
from app.core.errors import Forbidden, Unauthenticated
from app.core.middleware import UNSAFE_METHODS
from app.core.security.tokens import constant_time_equals
from app.modules.identity.models import AuthLevel
from app.modules.identity.service import AuthContext, IdentityService

CSRF_HEADER = "x-csrf-token"


def get_identity_service(
    db: DbSession, settings: SettingsDep, secret_box: SecretBoxDep
) -> IdentityService:
    return IdentityService(db, settings, secret_box)


IdentityServiceDep = Annotated[IdentityService, Depends(get_identity_service)]


async def get_auth_context(
    request: Request, service: IdentityServiceDep, settings: SettingsDep
) -> AuthContext:
    """Authenticate the request (any auth level) and enforce CSRF on unsafe methods."""
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise Unauthenticated()
    ctx = await service.resolve_session(token)
    if ctx is None:
        raise Unauthenticated("Your session has expired. Sign in again.", code="session_expired")
    if request.method in UNSAFE_METHODS:
        header = request.headers.get(CSRF_HEADER, "")
        if not header or not constant_time_equals(header, ctx.session.csrf_token):
            raise Forbidden("Missing or invalid CSRF token.", code="csrf_failed")
    return ctx


AnyAuthContext = Annotated[AuthContext, Depends(get_auth_context)]


async def require_full_auth(ctx: AnyAuthContext) -> AuthContext:
    if ctx.auth_level is not AuthLevel.FULL:
        raise Forbidden("Multi-factor authentication required.", code="mfa_required")
    return ctx


CurrentUser = Annotated[AuthContext, Depends(require_full_auth)]
