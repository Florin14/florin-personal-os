"""Configuration validation and log redaction."""

from __future__ import annotations

import json
import logging

import pytest
from pydantic import ValidationError

from app.core.config import Environment, Settings
from app.core.logging import REDACTED, JsonFormatter, redact
from app.core.security.encryption import generate_key


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "database_url": "postgresql+asyncpg://u:p@localhost/db",
        "encryption_keys": generate_key(),
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


class TestSettings:
    def test_comma_separated_values(self) -> None:
        key1, key2 = generate_key(), generate_key()
        settings = _settings(
            encryption_keys=f"{key1}, {key2}",
            allowed_origins="https://a.example, https://b.example/",
        )
        assert [k.get_secret_value() for k in settings.encryption_keys] == [key1, key2]
        assert settings.allowed_origins == ["https://a.example", "https://b.example"]

    def test_invalid_encryption_key_rejected(self) -> None:
        with pytest.raises(ValidationError, match="valid Fernet keys"):
            _settings(encryption_keys="not-a-key")

    def test_empty_encryption_keys_rejected(self) -> None:
        with pytest.raises(ValidationError):
            _settings(encryption_keys="")

    @pytest.mark.parametrize(
        ("overrides", "message"),
        [
            ({"session_cookie_secure": False}, "SESSION_COOKIE_SECURE"),
            ({"auth_require_mfa": False}, "AUTH_REQUIRE_MFA"),
            ({"allowed_origins": "*"}, "ALLOWED_ORIGINS"),
        ],
    )
    def test_production_guards(self, overrides: dict[str, object], message: str) -> None:
        # Explicit secure baseline so the result does not depend on the process environment.
        secure_baseline: dict[str, object] = {
            "app_env": Environment.PRODUCTION,
            "session_cookie_secure": True,
            "auth_require_mfa": True,
            "allowed_origins": "https://pos.example.internal",
        }
        _settings(**secure_baseline)  # the baseline itself is valid
        with pytest.raises(ValidationError, match=message):
            _settings(**(secure_baseline | overrides))

    def test_secrets_are_not_printed(self) -> None:
        settings = _settings()
        assert "u:p@" not in repr(settings)


class TestRedaction:
    def test_nested_sensitive_keys(self) -> None:
        data = {
            "user_id": "123",
            "password": "hunter2",
            "headers": {"Authorization": "Bearer x", "accept": "json"},
            "items": [{"api_key": "k"}],
        }
        assert redact(data) == {
            "user_id": "123",
            "password": REDACTED,
            "headers": {"Authorization": REDACTED, "accept": "json"},
            "items": [{"api_key": REDACTED}],
        }

    def test_formatter_redacts_extras(self) -> None:
        record = logging.LogRecord("t", logging.INFO, __file__, 1, "login", None, None)
        record.session_token = "abc"
        record.user_id = "u1"
        payload = json.loads(JsonFormatter().format(record))
        assert payload["session_token"] == REDACTED
        assert payload["user_id"] == "u1"
        assert payload["msg"] == "login"
