"""Workspace application service (framework independent)."""

from __future__ import annotations

import re
import unicodedata
import uuid
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.modules.workspaces.models import Role, Workspace, WorkspaceKind, WorkspaceMembership

_SLUG_INVALID = re.compile(r"[^a-z0-9]+")
_CURRENCY = re.compile(r"^[A-Z]{3}$")


@dataclass(frozen=True, slots=True)
class WorkspaceAccess:
    """Proof that a user may access a workspace with a given role."""

    workspace: Workspace
    role: Role

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.workspace.id

    @property
    def kind(self) -> WorkspaceKind:
        return WorkspaceKind(self.workspace.kind)


def slugify(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return _SLUG_INVALID.sub("-", ascii_value.lower()).strip("-")[:64]


def validate_timezone(name: str) -> str:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValidationFailed(f"Unknown timezone: {name!r}", code="invalid_timezone") from exc
    return name


class WorkspaceService:
    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def create_workspace(
        self,
        *,
        owner_id: uuid.UUID,
        name: str,
        kind: WorkspaceKind,
        timezone: str = "Europe/Bucharest",
        default_currency: str = "RON",
        slug: str | None = None,
    ) -> Workspace:
        name = name.strip()
        if not name:
            raise ValidationFailed("Workspace name is required.")
        slug = slugify(slug or name)
        if not slug:
            raise ValidationFailed("Workspace slug is invalid.", code="invalid_slug")
        if not _CURRENCY.match(default_currency):
            raise ValidationFailed("Currency must be an ISO 4217 code.", code="invalid_currency")
        validate_timezone(timezone)
        if await self._db.scalar(select(Workspace.id).where(Workspace.slug == slug)):
            raise Conflict("A workspace with this slug already exists.", code="slug_taken")

        workspace = Workspace(
            id=uuid.uuid4(),
            slug=slug,
            name=name,
            kind=kind.value,
            timezone=timezone,
            default_currency=default_currency,
        )
        self._db.add(workspace)
        await self._db.flush()
        self._db.add(
            WorkspaceMembership(workspace_id=workspace.id, user_id=owner_id, role=Role.OWNER.value)
        )
        await self._db.commit()
        return workspace

    async def add_member(self, workspace_id: uuid.UUID, user_id: uuid.UUID, role: Role) -> None:
        exists = await self._db.scalar(
            select(WorkspaceMembership.id).where(
                WorkspaceMembership.workspace_id == workspace_id,
                WorkspaceMembership.user_id == user_id,
            )
        )
        if exists:
            raise Conflict("User is already a member.", code="already_member")
        self._db.add(
            WorkspaceMembership(workspace_id=workspace_id, user_id=user_id, role=role.value)
        )
        await self._db.commit()

    async def list_for_user(self, user_id: uuid.UUID) -> list[WorkspaceAccess]:
        rows = await self._db.execute(
            select(Workspace, WorkspaceMembership.role)
            .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
            .where(WorkspaceMembership.user_id == user_id)
            .order_by(Workspace.kind.desc(), Workspace.name)
        )
        return [WorkspaceAccess(workspace=ws, role=Role(role)) for ws, role in rows]

    async def authorize(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, minimum_role: Role = Role.VIEWER
    ) -> WorkspaceAccess:
        """Return access for a member; non-members get NotFound (existence is not revealed)."""
        row = (
            await self._db.execute(
                select(Workspace, WorkspaceMembership.role)
                .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
                .where(Workspace.id == workspace_id, WorkspaceMembership.user_id == user_id)
            )
        ).one_or_none()
        if row is None:
            raise NotFound("Workspace not found.")
        workspace, role_value = row
        access = WorkspaceAccess(workspace=workspace, role=Role(role_value))
        if not access.role.allows(minimum_role):
            raise Forbidden("Your role does not allow this action.", code="insufficient_role")
        return access
