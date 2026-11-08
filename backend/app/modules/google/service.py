"""Google OAuth app, per-workspace accounts and authenticated API access."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import ForeignKey, String, Text, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, UUIDPrimaryKeyMixin, utcnow
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.core.integrations import (
    IntegrationProvider,
    IntegrationScope,
    ProviderError,
    ProviderErrorKind,
)
from app.core.security.encryption import SecretBox
from app.modules.audit.public import AuditRecorder
from app.modules.google.client import (
    FEATURE_SCOPES,
    PROVIDER,
    GoogleApi,
    LiveGoogleApi,
    authorization_url,
    cached_access_token,
    exchange_code,
    fetch_email,
    mock_api,
    pkce_pair,
    revoke_token,
    scopes_for,
)
from app.modules.integrations.public import (
    current_config,
    is_connected,
    load_connection,
    mark_connection_error,
    remove_connection,
    upsert_connection,
)

APP_PROVIDER = "google_oauth"
STATE_TTL = timedelta(minutes=10)
Feature = Literal["calendar", "gmail", "drive"]


class GoogleAppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["live", "mock"] = "live"
    client_id: str = Field(default="", max_length=200)
    # Must exactly match an authorized redirect URI of the OAuth client, e.g.
    # https://pos.example.internal/api/v1/integrations/google/callback
    redirect_uri: str = Field(default="", max_length=300)


class GoogleAppSecrets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_secret: SecretStr = Field(default=SecretStr(""), max_length=200)


class GoogleAccountConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_email: str = Field(max_length=320)
    features: list[Feature] = Field(default_factory=list)
    calendar_id: str = Field(default="primary", max_length=200)
    drive_root_folder: str = Field(default="Personal OS", max_length=100)
    mock: bool = False


class GoogleAccountSecrets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: SecretStr = Field(default=SecretStr(""), max_length=2000)


class GoogleOAuthState(UUIDPrimaryKeyMixin, Base):
    """Pending authorization (CSRF state + PKCE verifier), bound to user and workspace."""

    __tablename__ = "google_oauth_states"

    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    features: Mapped[list[str]] = mapped_column(JSONB)
    verifier_encrypted: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None] = mapped_column(default=None)


async def _noop_health(config: BaseModel, secrets_: BaseModel) -> None:
    """Token validity is checked on use; revoked tokens flag the connection."""


GOOGLE_APP_PROVIDER = IntegrationProvider(
    key=APP_PROVIDER,
    title="Google OAuth app",
    description="Your Google Cloud OAuth client for connecting Google accounts (or mock mode).",
    scope=IntegrationScope.SYSTEM,
    config_model=GoogleAppConfig,
    secrets_model=GoogleAppSecrets,
    health_check=_noop_health,
    capabilities=("oauth",),
    docs_url="https://developers.google.com/identity/protocols/oauth2/web-server",
)
GOOGLE_ACCOUNT_PROVIDER = IntegrationProvider(
    key=PROVIDER,
    title="Google account",
    description="Calendar, Gmail (read-only) and Drive (app files only) for this workspace.",
    scope=IntegrationScope.WORKSPACE,
    config_model=GoogleAccountConfig,
    secrets_model=GoogleAccountSecrets,
    health_check=_noop_health,
    capabilities=("calendar", "gmail.readonly", "drive.file"),
    docs_url="https://developers.google.com/workspace",
)


def _hash(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


async def _load_app(db: AsyncSession, box: SecretBox) -> tuple[GoogleAppConfig, GoogleAppSecrets]:
    try:
        loaded = await load_connection(
            db,
            box,
            provider=APP_PROVIDER,
            workspace_id=None,
            config_model=GoogleAppConfig,
            secrets_model=GoogleAppSecrets,
        )
    except ProviderError as exc:
        raise ValidationFailed(
            "Configure the Google OAuth app (Integrations, admin) first.",
            code="google_app_missing",
        ) from exc
    return loaded.config, loaded.secrets


class GoogleConnectService:
    def __init__(
        self, session: AsyncSession, box: SecretBox, clock: Callable[[], datetime] = utcnow
    ) -> None:
        self._db = session
        self._box = box
        self._now = clock

    async def start(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, features: list[Feature]
    ) -> str:
        """Returns the URL to send the browser to (Google consent or, in mock mode, back home)."""
        if not features:
            raise ValidationFailed("Select at least one Google feature.")
        app_config, _ = await _load_app(self._db, self._box)
        if app_config.mode == "mock":
            await self._store_account(
                workspace_id, user_id, "mock@google.local", list(features), "", mock=True
            )
            return "/integrations?google=connected"
        if not app_config.client_id or not app_config.redirect_uri:
            raise ValidationFailed("The Google OAuth app is missing client id or redirect URI.")
        state = secrets.token_urlsafe(32)
        verifier, challenge = pkce_pair()
        self._db.add(
            GoogleOAuthState(
                id=uuid.uuid4(),
                state_hash=_hash(state),
                user_id=user_id,
                workspace_id=workspace_id,
                features=list(features),
                verifier_encrypted=self._box.encrypt(verifier),
                expires_at=self._now() + STATE_TTL,
            )
        )
        await self._db.commit()
        return authorization_url(
            app_config.client_id,
            app_config.redirect_uri,
            scopes_for(list(features)),
            state,
            challenge,
        )

    async def finish(self, user_id: uuid.UUID, state: str, code: str) -> None:
        row = await self._db.scalar(
            select(GoogleOAuthState)
            .where(GoogleOAuthState.state_hash == _hash(state))
            .with_for_update()
        )
        # The state must belong to the same signed-in user, be fresh and unused (CSRF).
        if row is None or row.user_id != user_id or row.used_at is not None:
            raise Forbidden("Invalid or reused authorization state.", code="oauth_state_invalid")
        if row.expires_at <= self._now():
            raise Forbidden("The authorization request expired; try again.", code="oauth_expired")
        row.used_at = self._now()
        await self._db.commit()
        app_config, app_secrets = await _load_app(self._db, self._box)
        tokens = await exchange_code(
            app_config.client_id,
            app_secrets.client_secret.get_secret_value(),
            app_config.redirect_uri,
            code,
            self._box.decrypt(row.verifier_encrypted),
        )
        if not tokens.refresh_token:
            raise ValidationFailed("Google did not return a refresh token; reconnect with consent.")
        missing = [
            s
            for f in row.features
            for s in FEATURE_SCOPES[f]
            if tokens.scopes and s not in tokens.scopes
        ]
        granted = [f for f in row.features if not any(s in missing for s in FEATURE_SCOPES[f])]
        email = await fetch_email(tokens.access_token)
        await self._store_account(
            row.workspace_id, user_id, email, granted, tokens.refresh_token, mock=False
        )

    async def _store_account(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        email: str,
        features: list[str],
        refresh_token: str,
        *,
        mock: bool,
    ) -> None:
        previous = await current_config(self._db, PROVIDER, workspace_id)
        config = GoogleAccountConfig.model_validate(
            {
                **(previous or {}),
                "account_email": email,
                "features": features,
                "mock": mock,
            }
        )
        connection_id = await upsert_connection(
            self._db,
            self._box,
            provider=PROVIDER,
            workspace_id=workspace_id,
            name=f"Google ({email})",
            config=config.model_dump(mode="json"),
            secrets={"refresh_token": refresh_token},
            actor_user_id=user_id,
        )
        AuditRecorder(self._db).record(
            "integrations.google_connected",
            actor_user_id=user_id,
            workspace_id=workspace_id,
            target_type="integration",
            target_id=connection_id,
            details={"features": features, "mock": mock},
        )
        await self._db.commit()

    async def disconnect(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> None:
        removed = await remove_connection(self._db, self._box, PROVIDER, workspace_id)
        if removed is None:
            raise NotFound("Google is not connected for this workspace.")
        connection_id, stored = removed
        token = stored.get("refresh_token")
        if token:
            await revoke_token(str(token))
        AuditRecorder(self._db).record(
            "integrations.google_disconnected",
            actor_user_id=user_id,
            workspace_id=workspace_id,
            target_type="integration",
            target_id=connection_id,
        )
        await self._db.commit()


async def google_api(
    db: AsyncSession,
    box: SecretBox,
    workspace_id: uuid.UUID,
    feature: Feature,
    clock: Callable[[], datetime] = utcnow,
) -> tuple[GoogleAccountConfig, GoogleApi]:
    """Authenticated API for a workspace's Google account.

    Revoked/expired refresh tokens flag the connection as ``error`` and raise
    ``ProviderError(AUTH)``, so dependent workflows stop safely until reconnect.
    """
    loaded = await load_connection(
        db,
        box,
        provider=PROVIDER,
        workspace_id=workspace_id,
        config_model=GoogleAccountConfig,
        secrets_model=GoogleAccountSecrets,
    )
    config = loaded.config
    if feature not in config.features:
        raise ProviderError(
            PROVIDER, ProviderErrorKind.NOT_CONFIGURED, f"{feature} access was not granted"
        )
    if config.mock:
        return config, mock_api(f"{workspace_id}")
    app_config, app_secrets = await _load_app(db, box)
    try:
        token = await cached_access_token(
            str(loaded.connection_id),
            app_config.client_id,
            app_secrets.client_secret.get_secret_value(),
            loaded.secrets.refresh_token.get_secret_value(),
        )
    except ProviderError as exc:
        if exc.kind is ProviderErrorKind.AUTH:
            await mark_connection_error(
                db, loaded.connection_id, "Google access was revoked", clock
            )
            await db.commit()
        raise
    return config, LiveGoogleApi(token)


async def google_connected(db: AsyncSession, workspace_id: uuid.UUID) -> bool:
    return await is_connected(db, PROVIDER, workspace_id)


def summary(config: GoogleAccountConfig) -> dict[str, Any]:
    return {"account": config.account_email, "features": config.features, "mock": config.mock}
