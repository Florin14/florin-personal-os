"""Workspace-scoped, encrypted Home Assistant connection."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.integrations import (
    IntegrationProvider,
    IntegrationScope,
    ProviderError,
    ProviderErrorKind,
)
from app.core.security.encryption import SecretBox
from app.modules.integrations.public import load_connection
from app.modules.smarthome.client import PROVIDER, HomeAssistantApi, make_api


class HomeAssistantConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["mock", "live"] = "mock"
    base_url: str = Field(default="http://homeassistant.local:8123", max_length=500)

    @field_validator("base_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        try:
            url = urlsplit(value)
            port = url.port
        except ValueError as exc:
            raise ValueError("Use an http(s) Home Assistant origin.") from exc
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.path not in {"", "/"}
            or url.query
            or url.fragment
            or (port is not None and port == 0)
            or any(char.isspace() or ord(char) < 32 for char in value)
            or "\\" in value
        ):
            raise ValueError("Use an http(s) origin without credentials, path, query or fragment.")
        return value.rstrip("/")

    def connection_key(self) -> str:
        return hashlib.sha256(f"{self.mode}:{self.base_url}".encode()).hexdigest()


class HomeAssistantSecrets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: SecretStr = Field(default=SecretStr(""), max_length=4096)


def api_from(
    config: HomeAssistantConfig,
    secrets: HomeAssistantSecrets,
    seed: list[dict[str, Any]] | None = None,
) -> HomeAssistantApi:
    token = secrets.access_token.get_secret_value()
    if config.mode == "live" and not token.strip():
        raise ProviderError(PROVIDER, ProviderErrorKind.NOT_CONFIGURED, "access token required")
    return make_api(mode=config.mode, base_url=config.base_url, token=token, mock_seed=seed)


async def health_check(config: BaseModel, secrets: BaseModel) -> None:
    assert isinstance(config, HomeAssistantConfig)
    assert isinstance(secrets, HomeAssistantSecrets)
    if not (await api_from(config, secrets).ping()).startswith("API running."):
        raise ProviderError(PROVIDER, ProviderErrorKind.UNAVAILABLE, "unexpected API response")


async def load_home(
    db: AsyncSession, box: SecretBox, workspace_id: uuid.UUID
) -> tuple[uuid.UUID, HomeAssistantConfig, HomeAssistantSecrets]:
    loaded = await load_connection(
        db,
        box,
        provider=PROVIDER,
        workspace_id=workspace_id,
        config_model=HomeAssistantConfig,
        secrets_model=HomeAssistantSecrets,
    )
    return loaded.connection_id, loaded.config, loaded.secrets


HOME_ASSISTANT_PROVIDER = IntegrationProvider(
    key=PROVIDER,
    title="Home Assistant",
    description="Local devices, read-only discovery and opt-in controls. Mock mode needs no token.",
    scope=IntegrationScope.WORKSPACE,
    config_model=HomeAssistantConfig,
    secrets_model=HomeAssistantSecrets,
    health_check=health_check,
    capabilities=("devices.discover", "devices.state", "devices.control"),
    docs_url="https://contributors.home-assistant.io/core/internals/rest-api/",
)
