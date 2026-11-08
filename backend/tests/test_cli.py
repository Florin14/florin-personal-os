"""Admin CLI argument handling (database-free parts)."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from app.cli import build_parser, main


def test_generate_key_prints_valid_fernet_key(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["generate-key"]) == 0
    key = capsys.readouterr().out.strip()
    Fernet(key.encode())  # raises if invalid


def test_password_is_not_accepted_as_argument() -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(
            ["create-user", "--email", "a@b.test", "--display-name", "A", "--password", "x"]
        )


def test_workspace_kind_is_validated() -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(
            ["create-workspace", "--owner-email", "a@b.test", "--name", "X", "--kind", "shared"]
        )
