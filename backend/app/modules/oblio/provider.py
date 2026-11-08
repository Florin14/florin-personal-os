"""Oblio integration provider definition and connection loading."""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.integrations import (
    IntegrationProvider,
    IntegrationScope,
    ProviderError,
    ProviderErrorKind,
)
from app.core.security.encryption import SecretBox
from app.modules.integrations.public import load_connection
from app.modules.oblio.client import PROVIDER, OblioApi, make_api


class OblioConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Company fiscal code as registered in Oblio (with or without "RO").
    cif: str = Field(pattern=r"^(RO)?[0-9]{2,10}$", max_length=12)
    # "mock" uses an in-memory simulator (no credentials or network needed).
    mode: Literal["live", "mock"] = "live"


class OblioSecrets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320, pattern=r"^\S+@\S+$")
    # Oblio > Setari > Date Cont > API secret.
    api_secret: SecretStr = Field(min_length=8, max_length=200)


def api_from(config: OblioConfig, secrets: OblioSecrets) -> OblioApi:
    return make_api(
        mode=config.mode,
        cif=config.cif,
        email=secrets.email,
        api_secret=secrets.api_secret.get_secret_value(),
    )


async def health_check(config: BaseModel, secrets: BaseModel) -> None:
    assert isinstance(config, OblioConfig)
    assert isinstance(secrets, OblioSecrets)
    companies = await api_from(config, secrets).companies()
    wanted = config.cif.removeprefix("RO")
    if not any(str(c.get("cif", "")).removeprefix("RO") == wanted for c in companies):
        raise ProviderError(
            PROVIDER,
            ProviderErrorKind.INVALID_REQUEST,
            f"CIF {config.cif} is not accessible with these credentials",
        )


async def load_oblio(
    session: AsyncSession, box: SecretBox, workspace_id: uuid.UUID
) -> tuple[uuid.UUID, OblioConfig, OblioApi]:
    loaded = await load_connection(
        session,
        box,
        provider=PROVIDER,
        workspace_id=workspace_id,
        config_model=OblioConfig,
        secrets_model=OblioSecrets,
    )
    return loaded.connection_id, loaded.config, api_from(loaded.config, loaded.secrets)


OBLIO_PROVIDER = IntegrationProvider(
    key=PROVIDER,
    title="Oblio",
    description="Romanian invoicing and e-Factura (SPV) through the official Oblio REST API.",
    scope=IntegrationScope.WORKSPACE,
    config_model=OblioConfig,
    secrets_model=OblioSecrets,
    health_check=health_check,
    capabilities=("invoice.create", "invoice.read", "einvoice.send", "nomenclature.read"),
    docs_url="https://www.oblio.eu/api",
)
