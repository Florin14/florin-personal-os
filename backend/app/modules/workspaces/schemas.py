"""Workspace API schemas."""

from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.modules.workspaces.models import Role, WorkspaceKind
from app.modules.workspaces.service import WorkspaceAccess


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    kind: WorkspaceKind
    timezone: str
    default_currency: str
    role: Role

    @classmethod
    def from_access(cls, access: WorkspaceAccess) -> WorkspaceOut:
        ws = access.workspace
        return cls(
            id=ws.id,
            slug=ws.slug,
            name=ws.name,
            kind=access.kind,
            timezone=ws.timezone,
            default_currency=ws.default_currency,
            role=access.role,
        )
