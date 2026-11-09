"""Workspace-scoped discovery, policy, manual controls and command history."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from app.core.dependencies import DbSession, SecretBoxDep
from app.core.http import ERROR_RESPONSES
from app.modules.identity.public import CurrentUser
from app.modules.smarthome.models import HomeDevice
from app.modules.smarthome.policy import SERVICES, sensitive
from app.modules.smarthome.service import SmartHomeService
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/smarthome",
    tags=["smarthome"],
    responses=ERROR_RESPONSES,
)
Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Member = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.MEMBER))]
Admin = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.ADMIN))]


class HomeDeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entity_id: str
    name: str
    domain: str
    state: str
    attributes: dict[str, Any]
    available: bool
    controllable: bool
    min_interval_seconds: int
    override_until: datetime | None
    last_seen_at: datetime
    last_command_at: datetime | None
    services: list[str]
    sensitive_services: list[str]


class HomeDevicePolicyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    controllable: bool
    min_interval_seconds: int = Field(default=60, ge=10, le=3600)
    override_until: AwareDatetime | None = None


class HomeCommandIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service: str = Field(min_length=1, max_length=60, pattern=r"^[a-z_]+$")
    data: dict[str, Any] = Field(default_factory=dict, max_length=4)
    idempotency_key: uuid.UUID
    confirm_sensitive: bool = False


class HomeCommandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    entity_id: str
    service: str
    data: dict[str, Any]
    source: Literal["manual", "automation"]
    status: Literal["pending", "succeeded", "refused", "failed", "unknown"]
    message: str
    created_at: datetime


class HomeSyncOut(BaseModel):
    devices: int


class HomeStatusOut(BaseModel):
    configured: bool
    connected: bool
    mode: Literal["mock", "live"] | None


def _device(device: HomeDevice) -> HomeDeviceOut:
    services = list(SERVICES.get(device.domain, ()))
    return HomeDeviceOut(
        id=device.id,
        entity_id=device.entity_id,
        name=device.name,
        domain=device.domain,
        state=device.state,
        attributes=device.attributes,
        available=device.available,
        controllable=device.controllable,
        min_interval_seconds=device.min_interval_seconds,
        override_until=device.override_until,
        last_seen_at=device.last_seen_at,
        last_command_at=device.last_command_at,
        services=services,
        sensitive_services=[s for s in services if sensitive(device, s)],
    )


@router.get("/devices", response_model=list[HomeDeviceOut])
async def list_devices(access: Viewer, db: DbSession, box: SecretBoxDep) -> list[HomeDeviceOut]:
    return [_device(d) for d in await SmartHomeService(db, box).devices(access.workspace_id)]


@router.get("/status", response_model=HomeStatusOut)
async def home_status(access: Viewer, db: DbSession, box: SecretBoxDep) -> HomeStatusOut:
    return HomeStatusOut(**await SmartHomeService(db, box).connection_status(access.workspace_id))


@router.post("/sync", response_model=HomeSyncOut)
async def sync_devices(
    access: Member,
    ctx: CurrentUser,
    db: DbSession,
    box: SecretBoxDep,
) -> HomeSyncOut:
    return HomeSyncOut(
        devices=await SmartHomeService(db, box).sync(access.workspace_id, ctx.user.id)
    )


@router.put("/devices/{device_id}/policy", response_model=HomeDeviceOut)
async def configure_device(
    device_id: uuid.UUID,
    body: HomeDevicePolicyIn,
    access: Admin,
    ctx: CurrentUser,
    db: DbSession,
    box: SecretBoxDep,
) -> HomeDeviceOut:
    return _device(
        await SmartHomeService(db, box).configure(
            access.workspace_id,
            device_id,
            actor_user_id=ctx.user.id,
            **body.model_dump(),
        )
    )


@router.post("/devices/{device_id}/commands", response_model=HomeCommandOut)
async def send_command(
    device_id: uuid.UUID,
    body: HomeCommandIn,
    access: Member,
    ctx: CurrentUser,
    db: DbSession,
    box: SecretBoxDep,
) -> HomeCommandOut:
    command = await SmartHomeService(db, box).command(
        access.workspace_id,
        device_id,
        service=body.service,
        data=body.data,
        idempotency_key=f"manual:{body.idempotency_key}",
        source="manual",
        actor_user_id=ctx.user.id,
        confirm_sensitive=body.confirm_sensitive,
    )
    return HomeCommandOut.model_validate(command)


@router.get("/commands", response_model=list[HomeCommandOut])
async def list_commands(
    access: Viewer,
    db: DbSession,
    box: SecretBoxDep,
    device_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[HomeCommandOut]:
    return [
        HomeCommandOut.model_validate(c)
        for c in await SmartHomeService(db, box).commands(
            access.workspace_id,
            device_id,
            limit,
        )
    ]
