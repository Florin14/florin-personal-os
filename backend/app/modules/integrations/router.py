"""Integration management endpoints. Secrets are write-only."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.dependencies import DbSession, SecretBoxDep
from app.core.http import ERROR_RESPONSES
from app.modules.identity.public import CurrentUser
from app.modules.integrations.models import ConnectionStatus, IntegrationConnection
from app.modules.integrations.service import IntegrationRegistry, IntegrationService
from app.modules.workspaces.public import Role, accessible_workspace_ids

router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"], responses=ERROR_RESPONSES)


def get_registry(request: Request) -> IntegrationRegistry:
    return IntegrationRegistry(request.app.state.integrations)


RegistryDep = Annotated[IntegrationRegistry, Depends(get_registry)]


class ProviderOut(BaseModel):
    key: str
    title: str
    description: str
    scope: str
    capabilities: list[str]
    docs_url: str | None
    config_schema: dict[str, Any]
    secret_fields: list[str]


class ConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID | None
    provider: str
    name: str
    status: ConnectionStatus
    config: dict[str, Any]
    has_credentials: bool
    last_checked_at: datetime | None
    last_error: str | None
    created_at: datetime


class ConnectionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(max_length=50)
    workspace_id: uuid.UUID | None = None
    name: str = Field(default="", max_length=100)
    config: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, Any]


class ConnectionUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=100)
    config: dict[str, Any] | None = None
    secrets: dict[str, Any] | None = None
    enabled: bool | None = None


def _out(c: IntegrationConnection) -> ConnectionOut:
    return ConnectionOut(
        id=c.id,
        workspace_id=c.workspace_id,
        provider=c.provider,
        name=c.name,
        status=ConnectionStatus(c.status),
        config=c.config,
        has_credentials=c.credentials_encrypted is not None,
        last_checked_at=c.last_checked_at,
        last_error=c.last_error,
        created_at=c.created_at,
    )


@router.get("/providers", response_model=list[ProviderOut])
async def list_providers(_: CurrentUser, registry: RegistryDep) -> list[ProviderOut]:
    return [
        ProviderOut(
            key=p.key,
            title=p.title,
            description=p.description,
            scope=p.scope.value,
            capabilities=list(p.capabilities),
            docs_url=p.docs_url,
            config_schema=p.config_model.model_json_schema(),
            secret_fields=list(p.secrets_model.model_fields),
        )
        for p in registry.all()
    ]


@router.get("", response_model=list[ConnectionOut])
async def list_connections(
    ctx: CurrentUser, db: DbSession, box: SecretBoxDep, registry: RegistryDep
) -> list[ConnectionOut]:
    workspace_ids = await accessible_workspace_ids(db, ctx.user.id, Role.ADMIN)
    service = IntegrationService(db, registry, box)
    return [_out(c) for c in await service.list_connections(workspace_ids, ctx.user.is_admin)]


@router.post("", response_model=ConnectionOut, status_code=status.HTTP_201_CREATED)
async def create_connection(
    body: ConnectionIn, ctx: CurrentUser, db: DbSession, box: SecretBoxDep, registry: RegistryDep
) -> ConnectionOut:
    service = IntegrationService(db, registry, box)
    await service.ensure_can_manage(ctx.user.id, ctx.user.is_admin, body.workspace_id)
    connection = await service.create(
        provider_key=body.provider,
        workspace_id=body.workspace_id,
        name=body.name,
        config=body.config,
        secrets=body.secrets,
        actor_user_id=ctx.user.id,
    )
    return _out(connection)


@router.patch("/{connection_id}", response_model=ConnectionOut)
async def update_connection(
    connection_id: uuid.UUID,
    body: ConnectionUpdateIn,
    ctx: CurrentUser,
    db: DbSession,
    box: SecretBoxDep,
    registry: RegistryDep,
) -> ConnectionOut:
    service = IntegrationService(db, registry, box)
    connection = await service.get(connection_id)
    await service.ensure_can_manage(ctx.user.id, ctx.user.is_admin, connection.workspace_id)
    connection = await service.update(
        connection,
        name=body.name,
        config=body.config,
        secrets=body.secrets,
        enabled=body.enabled,
        actor_user_id=ctx.user.id,
    )
    return _out(connection)


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    connection_id: uuid.UUID,
    ctx: CurrentUser,
    db: DbSession,
    box: SecretBoxDep,
    registry: RegistryDep,
) -> None:
    service = IntegrationService(db, registry, box)
    connection = await service.get(connection_id)
    await service.ensure_can_manage(ctx.user.id, ctx.user.is_admin, connection.workspace_id)
    await service.delete(connection, ctx.user.id)


@router.post("/{connection_id}/check", response_model=ConnectionOut)
async def check_connection(
    connection_id: uuid.UUID,
    ctx: CurrentUser,
    db: DbSession,
    box: SecretBoxDep,
    registry: RegistryDep,
) -> ConnectionOut:
    service = IntegrationService(db, registry, box)
    connection = await service.get(connection_id)
    await service.ensure_can_manage(ctx.user.id, ctx.user.is_admin, connection.workspace_id)
    return _out(await service.check(connection))
