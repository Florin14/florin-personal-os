"""FastAPI dependencies for workspace authorization."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Path

from app.core.dependencies import DbSession
from app.modules.identity.public import CurrentUser
from app.modules.workspaces.models import Role
from app.modules.workspaces.service import WorkspaceAccess, WorkspaceService


def get_workspace_service(db: DbSession) -> WorkspaceService:
    return WorkspaceService(db)


WorkspaceServiceDep = Annotated[WorkspaceService, Depends(get_workspace_service)]


def require_workspace_access(
    minimum_role: Role = Role.VIEWER,
) -> Callable[..., Awaitable[WorkspaceAccess]]:
    """Dependency factory: authorizes ``{workspace_id}`` from the path for the current user."""

    async def dependency(
        ctx: CurrentUser,
        service: WorkspaceServiceDep,
        workspace_id: Annotated[uuid.UUID, Path()],
    ) -> WorkspaceAccess:
        return await service.authorize(ctx.user.id, workspace_id, minimum_role)

    return dependency
