"""Discord bot integration: configuration, REST client and request signatures.

Based on Discord's documentation:
* Interactions are signed with Ed25519: ``X-Signature-Ed25519`` over
  ``X-Signature-Timestamp + raw body`` with the application's public key;
  invalid signatures must get ``401``.
* PING (type 1) must be answered with PONG (type 1).
* Bot REST calls use ``Authorization: Bot <token>`` against ``/api/v10``.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.integrations import (
    IntegrationProvider,
    IntegrationScope,
    ProviderError,
    ProviderErrorKind,
    http_client,
    normalize_http_error,
)
from app.core.security.encryption import SecretBox
from app.modules.integrations.public import LoadedConnection, load_connection

PROVIDER = "discord"
API_BASE = "https://discord.com/api/v10"
MAX_CLOCK_SKEW_SECONDS = 300
SNOWFLAKE = r"^[0-9]{5,25}$"


class DiscordUserMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    discord_user_id: str = Field(pattern=SNOWFLAKE)
    email: str = Field(pattern=r"^\S+@\S+$", max_length=320)


class DiscordConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    application_id: str = Field(pattern=SNOWFLAKE)
    public_key: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    # Channel that receives notifications and approval requests.
    notification_channel_id: str = Field(pattern=SNOWFLAKE)
    # Only these channels may issue commands / press buttons (empty = notification channel only).
    allowed_channel_ids: list[str] = Field(default_factory=list)
    # Only these Discord users may act; each maps to a Personal OS account.
    users: list[DiscordUserMapping] = Field(default_factory=list, max_length=20)
    # Approval titles may contain client names/amounts; off by default (privacy).
    include_titles: bool = False

    def channel_allowed(self, channel_id: str | None) -> bool:
        allowed = set(self.allowed_channel_ids) | {self.notification_channel_id}
        return channel_id is not None and channel_id in allowed

    def email_for(self, discord_user_id: str | None) -> str | None:
        for mapping in self.users:
            if mapping.discord_user_id == discord_user_id:
                return mapping.email
        return None


class DiscordSecrets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bot_token: SecretStr = Field(min_length=20, max_length=200)


def verify_signature(public_key_hex: str, signature_hex: str, timestamp: str, body: bytes) -> bool:
    """Ed25519 check plus a replay window on the signed timestamp."""
    try:
        if abs(time.time() - int(timestamp)) > MAX_CLOCK_SKEW_SECONDS:
            return False
        key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
        key.verify(bytes.fromhex(signature_hex), timestamp.encode() + body)
    except (InvalidSignature, ValueError):
        return False
    return True


class DiscordClient:
    def __init__(self, bot_token: str) -> None:
        self._headers = {"Authorization": f"Bot {bot_token}"}

    async def request(self, method: str, path: str, json_body: Any = None) -> Any:
        try:
            async with http_client(API_BASE) as client:
                response = await client.request(method, path, json=json_body, headers=self._headers)
                response.raise_for_status()
                return response.json() if response.content else None
        except httpx.HTTPError as exc:
            raise normalize_http_error(PROVIDER, exc) from exc

    async def send_message(self, channel_id: str, message: dict[str, Any]) -> dict[str, Any]:
        result = await self.request("POST", f"/channels/{channel_id}/messages", message)
        return dict(result or {})

    async def register_commands(
        self, application_id: str, commands: list[dict[str, Any]]
    ) -> list[Any]:
        return list(await self.request("PUT", f"/applications/{application_id}/commands", commands))


async def health_check(config: BaseModel, secrets: BaseModel) -> None:
    assert isinstance(config, DiscordConfig)
    assert isinstance(secrets, DiscordSecrets)
    me = await DiscordClient(secrets.bot_token.get_secret_value()).request("GET", "/users/@me")
    if not isinstance(me, dict) or not me.get("bot"):
        raise ProviderError(PROVIDER, ProviderErrorKind.AUTH, "token does not belong to a bot")


async def load_discord(
    session: AsyncSession, box: SecretBox
) -> LoadedConnection[DiscordConfig, DiscordSecrets]:
    return await load_connection(
        session,
        box,
        provider=PROVIDER,
        workspace_id=None,
        config_model=DiscordConfig,
        secrets_model=DiscordSecrets,
    )


DISCORD_PROVIDER = IntegrationProvider(
    key=PROVIDER,
    title="Discord",
    description="Private bot for notifications, status and approve/reject buttons.",
    scope=IntegrationScope.SYSTEM,
    config_model=DiscordConfig,
    secrets_model=DiscordSecrets,
    health_check=health_check,
    capabilities=("notifications.send", "approvals.decide", "commands.status"),
    docs_url="https://docs.discord.com/developers/interactions/overview",
)

COMMANDS: list[dict[str, Any]] = [
    {
        "name": "status",
        "description": "Personal OS status: approvals, failures, emergency stop",
        "type": 1,
    },
    {"name": "approvals", "description": "List approvals waiting for you", "type": 1},
]
