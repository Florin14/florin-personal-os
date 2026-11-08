"""Workspace HTTP endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.http import ERROR_RESPONSES
from app.modules.identity.public import CurrentUser
from app.modules.workspaces.dependencies import WorkspaceServiceDep, require_workspace_access
from app.modules.workspaces.schemas import WorkspaceOut
from app.modules.workspaces.service import WorkspaceAccess

router = APIRouter(prefix="/api/v1/workspaces", tags=["workspaces"], responses=ERROR_RESPONSES)


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(ctx: CurrentUser, service: WorkspaceServiceDep) -> list[WorkspaceOut]:
    return [WorkspaceOut.from_access(a) for a in await service.list_for_user(ctx.user.id)]


@router.get("/{workspace_id}", response_model=WorkspaceOut)
async def get_workspace(
    access: Annotated[WorkspaceAccess, Depends(require_workspace_access())],
) -> WorkspaceOut:
    return WorkspaceOut.from_access(access)
