"""Google account connection endpoints (OAuth 2.0 authorization code + PKCE)."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field

from app.core.dependencies import DbSession, SecretBoxDep
from app.core.errors import DomainError
from app.core.http import ERROR_RESPONSES
from app.core.integrations import ProviderError
from app.modules.google.service import Feature, GoogleConnectService
from app.modules.identity.public import CurrentUser
from app.modules.workspaces.public import Role, WorkspaceService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/integrations/google", tags=["google"], responses=ERROR_RESPONSES)


class AuthorizeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: uuid.UUID
    features: list[Feature] = Field(min_length=1, max_length=3)


class AuthorizeOut(BaseModel):
    url: str


class DisconnectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: uuid.UUID


@router.post("/authorize", response_model=AuthorizeOut)
async def authorize(
    body: AuthorizeIn, ctx: CurrentUser, db: DbSession, box: SecretBoxDep
) -> AuthorizeOut:
    await WorkspaceService(db).authorize(ctx.user.id, body.workspace_id, Role.ADMIN)
    url = await GoogleConnectService(db, box).start(
        ctx.user.id, body.workspace_id, list(dict.fromkeys(body.features))
    )
    return AuthorizeOut(url=url)


@router.get("/callback", include_in_schema=False)
async def callback(
    ctx: CurrentUser,
    db: DbSession,
    box: SecretBoxDep,
    state: str = "",
    code: str = "",
    error: str = "",
) -> RedirectResponse:
    """Google redirects the browser here; the result is shown on the Integrations page."""
    if error or not state or not code:
        return RedirectResponse("/integrations?google=denied", status.HTTP_303_SEE_OTHER)
    try:
        await GoogleConnectService(db, box).finish(ctx.user.id, state[:200], code[:2000])
    except (DomainError, ProviderError) as exc:
        logger.warning("google_oauth_failed", extra={"reason": type(exc).__name__})
        return RedirectResponse("/integrations?google=failed", status.HTTP_303_SEE_OTHER)
    return RedirectResponse("/integrations?google=connected", status.HTTP_303_SEE_OTHER)


@router.post("/disconnect", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    body: DisconnectIn, ctx: CurrentUser, db: DbSession, box: SecretBoxDep
) -> None:
    await WorkspaceService(db).authorize(ctx.user.id, body.workspace_id, Role.ADMIN)
    await GoogleConnectService(db, box).disconnect(body.workspace_id, ctx.user.id)
