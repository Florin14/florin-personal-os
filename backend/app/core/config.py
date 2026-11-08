"""Application configuration loaded from environment variables.

All settings are validated at startup; the application refuses to start with
an insecure configuration in production.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from typing import Annotated

from cryptography.fernet import Fernet
from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False)

    app_name: str = "Personal OS"
    app_version: str = "0.1.0"
    app_env: Environment = Environment.DEVELOPMENT
    log_level: str = "INFO"

    database_url: SecretStr
    database_pool_size: int = Field(default=5, ge=1, le=50)

    # Comma separated Fernet keys. The first key encrypts; all keys decrypt.
    encryption_keys: Annotated[list[SecretStr], NoDecode]

    allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    session_cookie_name: str = "pos_session"
    csrf_cookie_name: str = "pos_csrf"
    session_cookie_secure: bool = True
    session_idle_timeout_minutes: int = Field(default=720, ge=5)
    session_absolute_timeout_hours: int = Field(default=168, ge=1)
    # Avoid a DB write on every request: refresh last_seen_at at most this often.
    session_touch_interval_seconds: int = Field(default=300, ge=0)

    auth_require_mfa: bool = True
    auth_max_failed_logins: int = Field(default=5, ge=1)
    auth_lockout_minutes: int = Field(default=15, ge=1)
    totp_issuer: str = "Personal OS"
    # Public (VPN) URL of the web app, used for links in chat notifications.
    public_app_url: str | None = None
    # Private directory (Docker volume) for document files.
    documents_dir: str = "./data/documents"

    # Background worker
    worker_poll_interval_seconds: float = Field(default=2.0, gt=0)
    worker_batch_size: int = Field(default=5, ge=1, le=100)
    event_relay_interval_seconds: float = Field(default=1.0, gt=0)

    # Retention
    job_retention_days: int = Field(default=30, ge=1)
    audit_retention_days: int = Field(default=365, ge=30)

    @field_validator("encryption_keys", mode="before")
    @classmethod
    def _split_keys(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("encryption_keys")
    @classmethod
    def _validate_keys(cls, value: list[SecretStr]) -> list[SecretStr]:
        if not value:
            raise ValueError("at least one encryption key is required")
        for key in value:
            try:
                Fernet(key.get_secret_value().encode())
            except ValueError as exc:
                raise ValueError(
                    "ENCRYPTION_KEYS must contain valid Fernet keys "
                    "(generate with: python -m app.cli generate-key)"
                ) from exc
        return value

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip().rstrip("/") for part in value.split(",") if part.strip()]
        return value

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        if self.app_env is Environment.PRODUCTION:
            if not self.session_cookie_secure:
                raise ValueError("SESSION_COOKIE_SECURE must be true in production")
            if not self.auth_require_mfa:
                raise ValueError("AUTH_REQUIRE_MFA must be true in production")
            if any(origin == "*" for origin in self.allowed_origins):
                raise ValueError("ALLOWED_ORIGINS must not contain '*' in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env is Environment.PRODUCTION


@lru_cache
def get_settings() -> Settings:
    return Settings()  # values come from the environment
