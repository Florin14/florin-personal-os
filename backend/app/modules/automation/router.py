"""Automation HTTP endpoints (workspace scoped) and global controls."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.dependencies import ActionRegistryDep, DbSession
from app.core.http import ERROR_RESPONSES
from app.modules.automation.models import (
    Automation,
    AutomationTrigger,
    ExecutionStatus,
    StepExecution,
    WorkflowExecution,
)
from app.modules.automation.service import AutomationService
from app.modules.identity.public import AdminUser, CurrentUser
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

MAX_PAYLOAD_BYTES = 16_384

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}", tags=["automation"], responses=ERROR_RESPONSES
)
controls_router = APIRouter(
    prefix="/api/v1/automation", tags=["automation"], responses=ERROR_RESPONSES
)

Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Member = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.MEMBER))]
Admin = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.ADMIN))]


# ------------------------------------------------------------------ schemas


class TriggerStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trigger_key: str
    trigger_type: str
    event_type: str | None
    enabled: bool
    next_fire_at: datetime | None
    last_fired_at: datetime | None


class AutomationOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str
    enabled: bool
    version: int
    definition: dict[str, Any]
    triggers: list[TriggerStateOut]
    created_at: datetime
    updated_at: datetime


class AutomationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=2000)
    definition: dict[str, Any]


class AutomationUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    definition: dict[str, Any]


class EnabledIn(BaseModel):
    enabled: bool


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version: int
    definition_hash: str
    created_at: datetime
    created_by_user_id: uuid.UUID | None
    definition: dict[str, Any]


class RunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dry_run: bool = False
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("payload")
    @classmethod
    def _limit_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value, default=str)) > MAX_PAYLOAD_BYTES:
            raise ValueError("Payload too large.")
        return value


class ExecutionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    automation_id: uuid.UUID
    version: int
    status: ExecutionStatus
    dry_run: bool
    trigger_key: str
    trigger_type: str
    current_step_key: str | None
    cancel_requested: bool
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class StepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    step_key: str
    step_type: str
    status: str
    attempts: int
    input: dict[str, Any]
    output: dict[str, Any]
    error: str | None
    approval_id: uuid.UUID | None
    resume_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None


class ExecutionDetailOut(ExecutionOut):
    trigger_payload: dict[str, Any]
    steps: list[StepOut]


class ActionOut(BaseModel):
    name: str
    title: str
    description: str
    risk: str
    side_effecting: bool
    requires_approval: bool
    params_schema: dict[str, Any]


class ControlsOut(BaseModel):
    emergency_stop: bool
    changed_at: datetime | None
    reason: str | None


class EmergencyStopIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool
    reason: str | None = Field(default=None, max_length=500)


# ------------------------------------------------------------------ helpers


async def _out(
    service: AutomationService, automation: Automation, triggers: list[AutomationTrigger]
) -> AutomationOut:
    version = await service.current_version(automation)
    return AutomationOut(
        id=automation.id,
        workspace_id=automation.workspace_id,
        name=automation.name,
        description=automation.description,
        enabled=automation.enabled,
        version=automation.current_version,
        definition=version.definition,
        triggers=[TriggerStateOut.model_validate(t) for t in triggers],
        created_at=automation.created_at,
        updated_at=automation.updated_at,
    )


async def _single(service: AutomationService, automation: Automation) -> AutomationOut:
    return await _out(service, automation, await service.triggers([automation.id]))


def _detail(execution: WorkflowExecution, steps: list[StepExecution]) -> ExecutionDetailOut:
    base = ExecutionOut.model_validate(execution).model_dump()
    return ExecutionDetailOut(
        **base,
        trigger_payload=execution.trigger_payload,
        steps=[StepOut.model_validate(s) for s in steps],
    )


# ---------------------------------------------------------------- endpoints


@router.get("/automations", response_model=list[AutomationOut])
async def list_automations(
    access: Viewer, db: DbSession, registry: ActionRegistryDep
) -> list[AutomationOut]:
    service = AutomationService(db, registry)
    automations = await service.list_automations(access.workspace_id)
    triggers = await service.triggers([a.id for a in automations])
    return [
        await _out(service, a, [t for t in triggers if t.automation_id == a.id])
        for a in automations
    ]


@router.post("/automations", response_model=AutomationOut, status_code=status.HTTP_201_CREATED)
async def create_automation(
    body: AutomationIn, access: Admin, ctx: CurrentUser, db: DbSession, registry: ActionRegistryDep
) -> AutomationOut:
    service = AutomationService(db, registry)
    automation = await service.create(
        access.workspace_id,
        name=body.name,
        description=body.description,
        definition=body.definition,
        actor_user_id=ctx.user.id,
    )
    return await _single(service, automation)


@router.get("/automations/{automation_id}", response_model=AutomationOut)
async def get_automation(
    automation_id: uuid.UUID, access: Viewer, db: DbSession, registry: ActionRegistryDep
) -> AutomationOut:
    service = AutomationService(db, registry)
    return await _single(service, await service.get(access.workspace_id, automation_id))


@router.put("/automations/{automation_id}", response_model=AutomationOut)
async def update_automation(
    automation_id: uuid.UUID,
    body: AutomationUpdateIn,
    access: Admin,
    ctx: CurrentUser,
    db: DbSession,
    registry: ActionRegistryDep,
) -> AutomationOut:
    service = AutomationService(db, registry)
    automation = await service.get(access.workspace_id, automation_id)
    automation = await service.update_definition(
        automation,
        definition=body.definition,
        name=body.name,
        description=body.description,
        actor_user_id=ctx.user.id,
    )
    return await _single(service, automation)


@router.put("/automations/{automation_id}/enabled", response_model=AutomationOut)
async def set_enabled(
    automation_id: uuid.UUID,
    body: EnabledIn,
    access: Admin,
    ctx: CurrentUser,
    db: DbSession,
    registry: ActionRegistryDep,
) -> AutomationOut:
    service = AutomationService(db, registry)
    automation = await service.get(access.workspace_id, automation_id)
    await service.set_enabled(automation, body.enabled, ctx.user.id)
    return await _single(service, automation)


@router.get("/automations/{automation_id}/versions", response_model=list[VersionOut])
async def list_versions(
    automation_id: uuid.UUID, access: Viewer, db: DbSession, registry: ActionRegistryDep
) -> list[VersionOut]:
    service = AutomationService(db, registry)
    automation = await service.get(access.workspace_id, automation_id)
    return [VersionOut.model_validate(v) for v in await service.versions(automation)]


@router.post(
    "/automations/{automation_id}/run",
    response_model=ExecutionOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def run_automation(
    automation_id: uuid.UUID,
    body: RunIn,
    access: Member,
    ctx: CurrentUser,
    db: DbSession,
    registry: ActionRegistryDep,
) -> ExecutionOut:
    service = AutomationService(db, registry)
    automation = await service.get(access.workspace_id, automation_id)
    execution = await service.run_manually(
        automation, payload=body.payload, dry_run=body.dry_run, actor_user_id=ctx.user.id
    )
    return ExecutionOut.model_validate(execution)


@router.get("/executions", response_model=list[ExecutionOut])
async def list_executions(
    access: Viewer,
    db: DbSession,
    registry: ActionRegistryDep,
    automation_id: uuid.UUID | None = None,
    status: ExecutionStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[ExecutionOut]:
    executions = await AutomationService(db, registry).list_executions(
        access.workspace_id, automation_id=automation_id, status=status, limit=limit
    )
    return [ExecutionOut.model_validate(e) for e in executions]


@router.get("/executions/{execution_id}", response_model=ExecutionDetailOut)
async def get_execution(
    execution_id: uuid.UUID, access: Viewer, db: DbSession, registry: ActionRegistryDep
) -> ExecutionDetailOut:
    execution, steps = await AutomationService(db, registry).get_execution(
        access.workspace_id, execution_id
    )
    return _detail(execution, steps)


@router.post("/executions/{execution_id}/cancel", response_model=ExecutionOut)
async def cancel_execution(
    execution_id: uuid.UUID,
    access: Member,
    ctx: CurrentUser,
    db: DbSession,
    registry: ActionRegistryDep,
) -> ExecutionOut:
    execution = await AutomationService(db, registry).cancel_execution(
        access.workspace_id, execution_id, ctx.user.id
    )
    return ExecutionOut.model_validate(execution)


@controls_router.get("/actions", response_model=list[ActionOut])
async def list_actions(_: CurrentUser, registry: ActionRegistryDep) -> list[ActionOut]:
    return [
        ActionOut(
            name=a.name,
            title=a.title,
            description=a.description,
            risk=a.risk.value,
            side_effecting=a.side_effecting,
            requires_approval=a.requires_approval,
            params_schema=a.params_model.model_json_schema(),
        )
        for a in registry.all()
    ]


@controls_router.get("/controls", response_model=ControlsOut)
async def get_controls(_: CurrentUser, db: DbSession, registry: ActionRegistryDep) -> ControlsOut:
    control = await AutomationService(db, registry).controls()
    return ControlsOut(
        emergency_stop=control.emergency_stop, changed_at=control.changed_at, reason=control.reason
    )


@controls_router.put("/controls/emergency-stop", response_model=ControlsOut)
async def set_emergency_stop(
    body: EmergencyStopIn, ctx: AdminUser, db: DbSession, registry: ActionRegistryDep
) -> ControlsOut:
    control = await AutomationService(db, registry).set_emergency_stop(
        body.active, actor_user_id=ctx.user.id, reason=body.reason
    )
    return ControlsOut(
        emergency_stop=control.emergency_stop, changed_at=control.changed_at, reason=control.reason
    )
