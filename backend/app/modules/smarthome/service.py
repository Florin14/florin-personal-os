"""Discovery and guarded commands (framework independent, ADR-025)."""

from __future__ import annotations

import logging
import math
import re
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any, Literal

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.integrations import ProviderError, ProviderErrorKind
from app.core.logging import redact
from app.core.security.encryption import SecretBox
from app.core.tasks import WorkerContext
from app.modules.audit.public import ActorType, AuditRecorder, Outcome
from app.modules.events.public import EventPublisher
from app.modules.integrations.public import (
    connected_workspaces,
    current_config,
    is_connected,
    mark_connection_error,
)
from app.modules.smarthome.client import PROVIDER, HomeAssistantApi
from app.modules.smarthome.models import HomeCommand, HomeDevice
from app.modules.smarthome.policy import (
    ENVIRONMENTAL_SENSOR_CLASSES,
    SERVICES,
    SUPPORTED_DOMAINS,
    sensitive,
    validate_data,
)
from app.modules.smarthome.provider import api_from, load_home

log = logging.getLogger(__name__)
_ENTITY = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")
_ATTRIBUTES = frozenset(
    {
        "friendly_name",
        "device_class",
        "unit_of_measurement",
        "brightness",
        "temperature",
        "current_temperature",
        "hvac_modes",
        "volume_level",
        "min_temp",
        "max_temp",
    }
)


def _attributes(raw: Any) -> dict[str, Any]:
    """Keep only display/control attributes; never ingest location, tokens or arbitrary blobs."""
    if not isinstance(raw, dict):
        return {}
    result: dict[str, Any] = {}
    for key in _ATTRIBUTES & raw.keys():
        value = raw[key]
        if isinstance(value, str):
            result[key] = value[:200]
        elif (
            value is None
            or isinstance(value, (bool, int))
            or (isinstance(value, float) and math.isfinite(value))
        ):
            result[key] = value
        elif key == "hvac_modes" and isinstance(value, list):
            result[key] = [v[:40] for v in value[:20] if isinstance(v, str)]
    return result


class SmartHomeService:
    def __init__(
        self, db: AsyncSession, box: SecretBox, clock: Callable[[], datetime] = utcnow
    ) -> None:
        self._db = db
        self._box = box
        self._now = clock
        self._audit = AuditRecorder(db)

    async def _lock(self, workspace_id: uuid.UUID) -> None:
        # Serialize first discovery and policy/command checks across API and worker processes.
        await self._db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"smarthome:{workspace_id}"},
        )

    async def devices(self, workspace_id: uuid.UUID) -> list[HomeDevice]:
        return list(
            await self._db.scalars(
                select(HomeDevice)
                .where(HomeDevice.workspace_id == workspace_id)
                .order_by(HomeDevice.domain, HomeDevice.name)
            )
        )

    async def connection_status(self, workspace_id: uuid.UUID) -> dict[str, Any]:
        config = await current_config(self._db, PROVIDER, workspace_id)
        return {
            "configured": config is not None,
            "connected": await is_connected(self._db, PROVIDER, workspace_id),
            "mode": config.get("mode", "mock") if config is not None else None,
        }

    async def device(self, workspace_id: uuid.UUID, device_id: uuid.UUID) -> HomeDevice:
        device = await self._db.scalar(
            select(HomeDevice)
            .where(HomeDevice.workspace_id == workspace_id, HomeDevice.id == device_id)
            .with_for_update()
        )
        if device is None:
            raise NotFound("Device not found.")
        return device

    async def commands(
        self, workspace_id: uuid.UUID, device_id: uuid.UUID | None, limit: int
    ) -> list[HomeCommand]:
        stmt = select(HomeCommand).where(HomeCommand.workspace_id == workspace_id)
        if device_id is not None:
            stmt = stmt.where(HomeCommand.device_id == device_id)
        return list(
            await self._db.scalars(
                stmt.order_by(HomeCommand.created_at.desc(), HomeCommand.id.desc()).limit(limit)
            )
        )

    async def _api(self, workspace_id: uuid.UUID) -> tuple[uuid.UUID, str, HomeAssistantApi]:
        connection_id, config, secrets = await load_home(self._db, self._box, workspace_id)
        key = config.connection_key()
        seed = [
            {"entity_id": d.entity_id, "state": d.state, "attributes": d.attributes}
            for d in await self.devices(workspace_id)
            if d.connection_key == key
        ]
        return connection_id, key, api_from(config, secrets, seed)

    async def _apply_states(
        self, workspace_id: uuid.UUID, states: list[dict[str, Any]], key: str, *, complete: bool
    ) -> int:
        rows = await self._db.scalars(
            select(HomeDevice).where(HomeDevice.workspace_id == workspace_id).with_for_update()
        )
        existing = {d.entity_id: d for d in rows}
        seen: set[str] = set()
        for state in states:
            entity_id = state.get("entity_id")
            if (
                not isinstance(entity_id, str)
                or len(entity_id) > 255
                or not _ENTITY.fullmatch(entity_id)
                or entity_id in seen
            ):
                continue
            domain = entity_id.split(".", 1)[0]
            if domain not in SUPPORTED_DOMAINS or not isinstance(state.get("state"), str):
                continue
            attrs = _attributes(state.get("attributes"))
            # Location and health sources are not opted in (P7-3/P7-4). Only ingest home readings.
            if domain == "sensor" and attrs.get("device_class") not in ENVIRONMENTAL_SENSOR_CLASSES:
                continue
            seen.add(entity_id)
            value = str(state["state"])[:255]
            device = existing.get(entity_id)
            if device is None:
                device = HomeDevice(
                    workspace_id=workspace_id,
                    entity_id=entity_id,
                    domain=domain,
                    name=str(attrs.get("friendly_name") or entity_id)[:200],
                    state=value,
                    connection_key=key,
                )
                self._db.add(device)
                existing[entity_id] = device
            elif device.connection_key != key:
                if not complete:
                    continue  # an in-flight command from an old connection cannot replace new data
                device.connection_key = key
                device.controllable = False
                device.override_until = None
                device.last_command_at = None
            elif device.state != value and domain != "sensor":
                EventPublisher(self._db).publish(
                    "smarthome.state_changed",
                    {
                        "device_id": str(device.id),
                        "entity_id": entity_id,
                        "old_state": device.state,
                        "new_state": value,
                    },
                    workspace_id=workspace_id,
                )
            device.name = str(attrs.get("friendly_name") or entity_id)[:200]
            device.state = value
            device.attributes = attrs
            device.available = value not in {"unknown", "unavailable"}
            device.last_seen_at = self._now()
        if complete:
            for entity_id, device in existing.items():
                if entity_id not in seen:
                    device.available = False
        return len(seen)

    async def sync(self, workspace_id: uuid.UUID, actor_user_id: uuid.UUID | None = None) -> int:
        await self._lock(workspace_id)
        connection_id: uuid.UUID | None = None
        try:
            connection_id, key, api = await self._api(workspace_id)
            states = await api.states()
        except ProviderError as exc:
            if connection_id is not None and exc.kind == ProviderErrorKind.AUTH:
                await mark_connection_error(
                    self._db, connection_id, "Home Assistant token rejected.", self._now
                )
                await self._db.commit()
            raise ValidationFailed(
                f"Cannot sync Home Assistant ({exc.kind.value}). "
                "Check the connection in Integrations.",
                code="home_assistant_unavailable",
            ) from exc
        count = await self._apply_states(workspace_id, states, key, complete=True)
        if actor_user_id is not None:
            self._audit.record(
                "smarthome.synced",
                workspace_id=workspace_id,
                actor_user_id=actor_user_id,
                details={"devices": count},
            )
        await self._db.commit()
        return count

    async def configure(
        self,
        workspace_id: uuid.UUID,
        device_id: uuid.UUID,
        *,
        controllable: bool,
        min_interval_seconds: int,
        override_until: datetime | None,
        actor_user_id: uuid.UUID,
    ) -> HomeDevice:
        if override_until is not None and override_until > self._now() + timedelta(days=7):
            raise ValidationFailed("Choose an override time within the next seven days.")
        if override_until is not None and override_until <= self._now():
            override_until = None
        await self._lock(workspace_id)
        device = await self.device(workspace_id, device_id)
        if controllable and not SERVICES.get(device.domain):
            raise ValidationFailed("This sensor has no supported controls.")
        device.controllable = controllable
        device.min_interval_seconds = min_interval_seconds
        device.override_until = override_until
        self._audit.record(
            "smarthome.device_configured",
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type="device",
            target_id=device.id,
            details={
                "controllable": controllable,
                "min_interval_seconds": min_interval_seconds,
                "override_until": override_until.isoformat() if override_until else None,
            },
        )
        await self._db.commit()
        return device

    def _record_outcome(self, command: HomeCommand) -> None:
        outcome = (
            Outcome.SUCCESS
            if command.status == "succeeded"
            else (Outcome.DENIED if command.status == "refused" else Outcome.FAILURE)
        )
        self._audit.record(
            "smarthome.command",
            actor_user_id=command.actor_user_id,
            actor_type=ActorType.USER if command.source == "manual" else ActorType.SYSTEM,
            workspace_id=command.workspace_id,
            target_type="device",
            target_id=command.device_id,
            outcome=outcome,
            details={
                "command_id": str(command.id),
                "service": command.service,
                "source": command.source,
                "status": command.status,
            },
        )

    async def command(
        self,
        workspace_id: uuid.UUID,
        device_id: uuid.UUID,
        *,
        service: str,
        data: dict[str, Any],
        idempotency_key: str,
        source: Literal["manual", "automation"],
        actor_user_id: uuid.UUID | None = None,
        confirm_sensitive: bool = False,
    ) -> HomeCommand:
        await self._lock(workspace_id)
        device = await self.device(workspace_id, device_id)
        previous = await self._db.scalar(
            select(HomeCommand).where(
                HomeCommand.workspace_id == workspace_id,
                HomeCommand.idempotency_key == idempotency_key,
            )
        )
        if previous is not None:
            if (previous.device_id, previous.service, previous.data) != (
                device_id,
                service,
                redact(data),
            ):
                raise Conflict("This command key was already used for different parameters.")
            return previous  # never replay pending/unknown intents: HA has no idempotency guarantee

        reason = validate_data(device, service, data)
        if not device.controllable:
            reason = "Device is read-only. An administrator must enable controls first."
        elif not device.available:
            reason = "Device is unavailable. Sync and check Home Assistant."
        elif sensitive(device, service) and (source == "automation" or not confirm_sensitive):
            reason = "Sensitive commands require explicit confirmation in the Smart Home page."
        elif (
            source == "automation" and device.override_until and device.override_until > self._now()
        ):
            reason = "Automations are paused for this device by a manual override."
        elif device.last_command_at and (
            device.last_command_at + timedelta(seconds=device.min_interval_seconds) > self._now()
        ):
            reason = "Device cooldown is active. Wait before sending another command."
        count = await self._db.scalar(
            select(func.count())
            .select_from(HomeCommand)
            .where(
                HomeCommand.device_id == device_id,
                HomeCommand.status != "refused",
                HomeCommand.created_at >= self._now() - timedelta(hours=1),
            )
        )
        if (count or 0) >= 20:
            reason = "Hourly limit reached (20 commands per device)."
        api: HomeAssistantApi | None = None
        connection_id: uuid.UUID | None = None
        key = ""
        if reason is None:
            try:
                connection_id, key, api = await self._api(workspace_id)
                if key != device.connection_key:
                    reason = "Connection changed. Sync and enable controls for the new home."
            except ProviderError as exc:
                reason = str(exc)
        command = HomeCommand(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            device_id=device_id,
            entity_id=device.entity_id,
            service=service,
            data=redact(data),
            source=source,
            status="refused" if reason else "pending",
            message=(reason or "")[:300],
            idempotency_key=idempotency_key,
            actor_user_id=actor_user_id,
            created_at=self._now(),
        )
        self._db.add(command)
        if reason:
            self._record_outcome(command)
            await self._db.commit()
            return command
        device.last_command_at = self._now()
        # Persist intent BEFORE the network call. A crash/timeout must never repeat a device action.
        await self._db.commit()
        assert api is not None
        try:
            changed = await api.call_service(
                device.domain, service, {**data, "entity_id": device.entity_id}
            )
            await self._lock(workspace_id)
            await self._apply_states(workspace_id, changed, key, complete=False)
            command.status = "succeeded"
            command.message = "Home Assistant accepted the command."
        except ProviderError as exc:
            command.status = "unknown" if exc.retryable else "failed"
            command.message = (
                "Outcome unknown. Sync and verify the device before sending another command."
                if exc.retryable
                else f"Home Assistant rejected the command ({exc.kind.value})."
            )
            if connection_id is not None and exc.kind == ProviderErrorKind.AUTH:
                await mark_connection_error(
                    self._db, connection_id, "Home Assistant token rejected.", self._now
                )
        self._record_outcome(command)
        await self._db.commit()
        return command


async def poll_devices(worker: WorkerContext) -> None:
    async with worker.session_factory() as db:
        workspaces = await connected_workspaces(db, PROVIDER)
    for workspace_id in workspaces:
        async with worker.session_factory() as db:
            try:
                await SmartHomeService(db, worker.secret_box, worker.clock).sync(workspace_id)
            except Exception:
                log.exception("smarthome.poll_failed", extra={"workspace_id": str(workspace_id)})
