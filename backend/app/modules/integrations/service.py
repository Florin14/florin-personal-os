"""Integration connection management (framework independent)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.core.integrations import (
    IntegrationProvider,
    IntegrationScope,
    ProviderError,
    ProviderErrorKind,
)
from app.core.security.encryption import DecryptionError, SecretBox
from app.modules.audit.public import AuditRecorder
from app.modules.integrations.models import ConnectionStatus, IntegrationConnection
from app.modules.workspaces.public import Role, WorkspaceService


class IntegrationRegistry:
    def __init__(self, providers: Iterable[IntegrationProvider] = ()) -> None:
        self._providers: dict[str, IntegrationProvider] = {}
        for provider in providers:
            if provider.key in self._providers:
                raise RuntimeError(f"Duplicate integration provider {provider.key!r}")
            self._providers[provider.key] = provider

    def get(self, key: str) -> IntegrationProvider:
        provider = self._providers.get(key)
        if provider is None:
            raise NotFound(f"Unknown integration provider {key!r}.")
        return provider

    def all(self) -> list[IntegrationProvider]:
        return sorted(self._providers.values(), key=lambda p: p.key)


@dataclass(frozen=True, slots=True)
class LoadedConnection[CfgT: BaseModel, SecT: BaseModel]:
    connection_id: uuid.UUID
    config: CfgT
    secrets: SecT


def _validation_message(exc: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())


async def load_connection[C: BaseModel, S: BaseModel](
    session: AsyncSession,
    box: SecretBox,
    *,
    provider: str,
    workspace_id: uuid.UUID | None,
    config_model: type[C],
    secrets_model: type[S],
) -> LoadedConnection[C, S]:
    """Decrypt an active connection for use by an adapter.

    Raises ProviderError(NOT_CONFIGURED/AUTH) so callers fail safely when an
    integration is missing, disabled or flagged as broken.
    """
    stmt = select(IntegrationConnection).where(IntegrationConnection.provider == provider)
    stmt = stmt.where(
        IntegrationConnection.workspace_id.is_(None)
        if workspace_id is None
        else IntegrationConnection.workspace_id == workspace_id
    )
    connection = await session.scalar(stmt)
    if connection is None or connection.status == ConnectionStatus.DISABLED.value:
        raise ProviderError(
            provider, ProviderErrorKind.NOT_CONFIGURED, "integration not configured"
        )
    if connection.status == ConnectionStatus.ERROR.value:
        raise ProviderError(
            provider, ProviderErrorKind.AUTH, "integration needs attention (reconnect it)"
        )
    if connection.credentials_encrypted is None:
        raise ProviderError(provider, ProviderErrorKind.NOT_CONFIGURED, "credentials missing")
    try:
        raw = json.loads(box.decrypt(connection.credentials_encrypted))
    except DecryptionError as exc:
        raise ProviderError(
            provider, ProviderErrorKind.NOT_CONFIGURED, "credentials cannot be decrypted"
        ) from exc
    return LoadedConnection(
        connection_id=connection.id,
        config=config_model.model_validate(connection.config),
        secrets=secrets_model.model_validate(raw),
    )


async def mark_connection_error(
    session: AsyncSession, connection_id: uuid.UUID, message: str, clock: Callable[[], datetime]
) -> None:
    """Flag a connection whose credentials were rejected (caller commits)."""
    connection = await session.get(IntegrationConnection, connection_id)
    if connection is not None:
        connection.status = ConnectionStatus.ERROR.value
        connection.last_error = message[:500]
        connection.last_checked_at = clock()


class IntegrationService:
    def __init__(
        self,
        session: AsyncSession,
        registry: IntegrationRegistry,
        box: SecretBox,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self._db = session
        self._registry = registry
        self._box = box
        self._now = clock
        self._audit = AuditRecorder(session)

    async def list_connections(
        self, workspace_ids: list[uuid.UUID], include_system: bool
    ) -> list[IntegrationConnection]:
        conditions = [IntegrationConnection.workspace_id.in_(workspace_ids)]
        if include_system:
            conditions.append(IntegrationConnection.workspace_id.is_(None))
        stmt = select(IntegrationConnection).where(or_(*conditions))
        return list(await self._db.scalars(stmt.order_by(IntegrationConnection.provider)))

    async def ensure_can_manage(
        self, user_id: uuid.UUID, is_admin: bool, workspace_id: uuid.UUID | None
    ) -> None:
        """Workspace integrations need workspace admin; system ones need a system admin."""
        if workspace_id is None:
            if not is_admin:
                raise Forbidden("Administrator access required.", code="admin_required")
            return
        await WorkspaceService(self._db).authorize(user_id, workspace_id, Role.ADMIN)

    async def get(self, connection_id: uuid.UUID) -> IntegrationConnection:
        connection = await self._db.get(IntegrationConnection, connection_id)
        if connection is None:
            raise NotFound("Connection not found.")
        return connection

    def _validate(
        self, provider: IntegrationProvider, config: dict[str, Any], secrets: dict[str, Any] | None
    ) -> tuple[BaseModel, BaseModel | None]:
        try:
            cfg = provider.config_model.model_validate(config)
            sec = provider.secrets_model.model_validate(secrets) if secrets is not None else None
        except ValidationError as exc:
            raise ValidationFailed(
                f"Invalid settings: {_validation_message(exc)}", code="invalid_integration"
            ) from exc
        return cfg, sec

    async def create(
        self,
        *,
        provider_key: str,
        workspace_id: uuid.UUID | None,
        name: str,
        config: dict[str, Any],
        secrets: dict[str, Any],
        actor_user_id: uuid.UUID,
    ) -> IntegrationConnection:
        provider = self._registry.get(provider_key)
        if (provider.scope is IntegrationScope.SYSTEM) != (workspace_id is None):
            raise ValidationFailed(
                f"{provider.title} is a {provider.scope.value}-level integration.",
                code="wrong_integration_scope",
            )
        cfg, sec = self._validate(provider, config, secrets)
        assert sec is not None
        existing = await self._db.scalar(
            select(IntegrationConnection.id).where(
                IntegrationConnection.provider == provider_key,
                IntegrationConnection.workspace_id.is_(None)
                if workspace_id is None
                else IntegrationConnection.workspace_id == workspace_id,
            )
        )
        if existing is not None:
            raise Conflict(f"{provider.title} is already connected.", code="already_connected")
        connection = IntegrationConnection(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            provider=provider_key,
            name=name.strip()[:100] or provider.title,
            status=ConnectionStatus.ACTIVE.value,
            config=cfg.model_dump(mode="json"),
            credentials_encrypted=self._box.encrypt(sec.model_dump_json()),
            created_by_user_id=actor_user_id,
        )
        self._db.add(connection)
        self._record("integrations.connected", connection, actor_user_id)
        await self._db.commit()
        return connection

    async def update(
        self,
        connection: IntegrationConnection,
        *,
        name: str | None,
        config: dict[str, Any] | None,
        secrets: dict[str, Any] | None,
        enabled: bool | None,
        actor_user_id: uuid.UUID,
    ) -> IntegrationConnection:
        provider = self._registry.get(connection.provider)
        cfg, sec = self._validate(
            provider, config if config is not None else connection.config, secrets
        )
        connection.config = cfg.model_dump(mode="json")
        if name is not None:
            connection.name = name.strip()[:100] or connection.name
        if sec is not None:
            # Credential rotation: replacing secrets clears a previous error state.
            connection.credentials_encrypted = self._box.encrypt(sec.model_dump_json())
            connection.status = ConnectionStatus.ACTIVE.value
            connection.last_error = None
        if enabled is not None:
            connection.status = (
                ConnectionStatus.ACTIVE if enabled else ConnectionStatus.DISABLED
            ).value
        self._record(
            "integrations.updated",
            connection,
            actor_user_id,
            rotated_credentials=sec is not None,
        )
        await self._db.commit()
        return connection

    async def delete(self, connection: IntegrationConnection, actor_user_id: uuid.UUID) -> None:
        self._record("integrations.disconnected", connection, actor_user_id)
        await self._db.delete(connection)
        await self._db.commit()

    async def check(self, connection: IntegrationConnection) -> IntegrationConnection:
        """Run the provider health check and persist the result."""
        provider = self._registry.get(connection.provider)
        connection.last_checked_at = self._now()
        try:
            if connection.credentials_encrypted is None:
                raise ProviderError(
                    provider.key, ProviderErrorKind.NOT_CONFIGURED, "no credentials"
                )
            secrets = provider.secrets_model.model_validate(
                json.loads(self._box.decrypt(connection.credentials_encrypted))
            )
            config = provider.config_model.model_validate(connection.config)
            await provider.health_check(config, secrets)
        except ProviderError as exc:
            connection.last_error = exc.message[:500]
            if exc.kind is ProviderErrorKind.AUTH:
                connection.status = ConnectionStatus.ERROR.value
        else:
            connection.last_error = None
            if connection.status == ConnectionStatus.ERROR.value:
                connection.status = ConnectionStatus.ACTIVE.value
        await self._db.commit()
        return connection

    def _record(
        self,
        action: str,
        connection: IntegrationConnection,
        actor_user_id: uuid.UUID,
        **details: object,
    ) -> None:
        self._audit.record(
            action,
            actor_user_id=actor_user_id,
            workspace_id=connection.workspace_id,
            target_type="integration",
            target_id=connection.id,
            details={"provider": connection.provider, **details},
        )


async def is_connected(
    session: AsyncSession, provider: str, workspace_id: uuid.UUID | None
) -> bool:
    """True when an active connection exists for the provider/scope."""
    stmt = select(IntegrationConnection.id).where(
        IntegrationConnection.provider == provider,
        IntegrationConnection.status == ConnectionStatus.ACTIVE.value,
        IntegrationConnection.workspace_id.is_(None)
        if workspace_id is None
        else IntegrationConnection.workspace_id == workspace_id,
    )
    return await session.scalar(stmt) is not None


async def connected_workspaces(session: AsyncSession, provider: str) -> list[uuid.UUID]:
    """Workspaces with an active connection for a workspace-scoped provider (for pollers)."""
    rows = await session.scalars(
        select(IntegrationConnection.workspace_id).where(
            IntegrationConnection.provider == provider,
            IntegrationConnection.status == ConnectionStatus.ACTIVE.value,
            IntegrationConnection.workspace_id.is_not(None),
        )
    )
    return [w for w in rows if w is not None]


async def upsert_connection(
    session: AsyncSession,
    box: SecretBox,
    *,
    provider: str,
    workspace_id: uuid.UUID | None,
    name: str,
    config: dict[str, Any],
    secrets: dict[str, Any],
    actor_user_id: uuid.UUID,
) -> uuid.UUID:
    """Create or replace a connection created by a provider flow (e.g. OAuth). Caller commits."""
    stmt = select(IntegrationConnection).where(IntegrationConnection.provider == provider)
    stmt = stmt.where(
        IntegrationConnection.workspace_id.is_(None)
        if workspace_id is None
        else IntegrationConnection.workspace_id == workspace_id
    )
    connection = await session.scalar(stmt)
    if connection is None:
        connection = IntegrationConnection(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            provider=provider,
            created_by_user_id=actor_user_id,
        )
        session.add(connection)
    connection.name = name[:100]
    connection.config = config
    connection.credentials_encrypted = box.encrypt(json.dumps(secrets))
    connection.status = ConnectionStatus.ACTIVE.value
    connection.last_error = None
    return connection.id


async def current_config(
    session: AsyncSession, provider: str, workspace_id: uuid.UUID | None
) -> dict[str, Any] | None:
    stmt = select(IntegrationConnection.config).where(IntegrationConnection.provider == provider)
    stmt = stmt.where(
        IntegrationConnection.workspace_id.is_(None)
        if workspace_id is None
        else IntegrationConnection.workspace_id == workspace_id
    )
    result: dict[str, Any] | None = await session.scalar(stmt)
    return result


async def remove_connection(
    session: AsyncSession, box: SecretBox, provider: str, workspace_id: uuid.UUID | None
) -> tuple[uuid.UUID, dict[str, Any]] | None:
    """Delete a connection and return (id, decrypted secrets) for provider-side revocation."""
    stmt = select(IntegrationConnection).where(IntegrationConnection.provider == provider)
    stmt = stmt.where(
        IntegrationConnection.workspace_id.is_(None)
        if workspace_id is None
        else IntegrationConnection.workspace_id == workspace_id
    )
    connection = await session.scalar(stmt)
    if connection is None:
        return None
    secrets: dict[str, Any] = {}
    if connection.credentials_encrypted:
        try:
            secrets = json.loads(box.decrypt(connection.credentials_encrypted))
        except DecryptionError:
            secrets = {}
    connection_id = connection.id
    await session.delete(connection)
    return connection_id, secrets
