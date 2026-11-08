"""Identity HTTP endpoints. Thin layer: validation, cookies, mapping."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, Response, status

from app.core.config import Settings
from app.core.db import utcnow
from app.core.dependencies import SettingsDep
from app.core.http import ERROR_RESPONSES
from app.modules.identity.dependencies import AnyAuthContext, CurrentUser, IdentityServiceDep
from app.modules.identity.schemas import (
    AuthStateResponse,
    ChangePasswordRequest,
    LoginRequest,
    MfaCodeRequest,
    SessionOut,
    TotpEnrollmentResponse,
)
from app.modules.identity.service import IssuedSession

router = APIRouter(prefix="/api/v1/auth", tags=["auth"], responses=ERROR_RESPONSES)


def _set_session_cookies(response: Response, issued: IssuedSession, settings: Settings) -> None:
    session = issued.context.session
    max_age = max(int((session.expires_at - utcnow()).total_seconds()), 0)
    response.set_cookie(
        settings.session_cookie_name,
        issued.token,
        max_age=max_age,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    # Readable by the SPA, which echoes it in the X-CSRF-Token header.
    response.set_cookie(
        settings.csrf_cookie_name,
        session.csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.session_cookie_secure,
        samesite="strict",
        path="/",
    )


def _clear_session_cookies(response: Response, settings: Settings) -> None:
    for name in (settings.session_cookie_name, settings.csrf_cookie_name):
        response.delete_cookie(name, path="/", secure=settings.session_cookie_secure)


@router.post("/login", response_model=AuthStateResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    service: IdentityServiceDep,
    settings: SettingsDep,
) -> AuthStateResponse:
    issued = await service.login(
        body.email,
        body.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    _set_session_cookies(response, issued, settings)
    return AuthStateResponse.build(issued.context, service.next_step(issued.context))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    ctx: AnyAuthContext, response: Response, service: IdentityServiceDep, settings: SettingsDep
) -> None:
    await service.logout(ctx)
    _clear_session_cookies(response, settings)


@router.get("/me", response_model=AuthStateResponse)
async def me(ctx: AnyAuthContext, service: IdentityServiceDep) -> AuthStateResponse:
    return AuthStateResponse.build(ctx, service.next_step(ctx))


@router.post("/mfa/verify", response_model=AuthStateResponse)
async def verify_mfa(
    body: MfaCodeRequest,
    ctx: AnyAuthContext,
    response: Response,
    service: IdentityServiceDep,
    settings: SettingsDep,
) -> AuthStateResponse:
    issued = await service.verify_mfa(ctx, body.code)
    _set_session_cookies(response, issued, settings)
    return AuthStateResponse.build(issued.context, service.next_step(issued.context))


@router.post("/mfa/totp/setup", response_model=TotpEnrollmentResponse)
async def begin_totp_setup(
    ctx: AnyAuthContext, service: IdentityServiceDep
) -> TotpEnrollmentResponse:
    enrollment = await service.begin_totp_enrollment(ctx)
    return TotpEnrollmentResponse(
        secret=enrollment.secret, provisioning_uri=enrollment.provisioning_uri
    )


@router.post("/mfa/totp/confirm", response_model=AuthStateResponse)
async def confirm_totp_setup(
    body: MfaCodeRequest,
    ctx: AnyAuthContext,
    response: Response,
    service: IdentityServiceDep,
    settings: SettingsDep,
) -> AuthStateResponse:
    issued = await service.confirm_totp_enrollment(ctx, body.code)
    _set_session_cookies(response, issued, settings)
    return AuthStateResponse.build(issued.context, service.next_step(issued.context))


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(ctx: CurrentUser, service: IdentityServiceDep) -> list[SessionOut]:
    sessions = await service.list_sessions(ctx)
    return [
        SessionOut(
            id=s.id,
            created_at=s.created_at,
            last_seen_at=s.last_seen_at,
            expires_at=s.expires_at,
            auth_level=s.auth_level,
            user_agent=s.user_agent,
            ip_address=s.ip_address,
            current=s.id == ctx.session.id,
        )
        for s in sessions
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: uuid.UUID, ctx: CurrentUser, service: IdentityServiceDep
) -> None:
    await service.revoke_session(ctx, session_id)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest, ctx: CurrentUser, service: IdentityServiceDep
) -> None:
    await service.change_password(ctx, body.current_password, body.new_password)
