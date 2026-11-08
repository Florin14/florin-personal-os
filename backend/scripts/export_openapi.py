"""Export the OpenAPI schema without a database or real secrets.

Usage: python scripts/export_openapi.py ../frontend/openapi.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydantic import SecretStr

from app.core.config import Environment, Settings
from app.core.security.encryption import generate_key
from app.main import create_app


def main() -> None:
    settings = Settings(
        app_env=Environment.DEVELOPMENT,
        database_url=SecretStr("postgresql+asyncpg://unused@localhost/unused"),
        encryption_keys=[SecretStr(generate_key())],
        log_level="WARNING",
    )
    schema = create_app(settings).openapi()
    output = json.dumps(schema, indent=2, sort_keys=True) + "\n"
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)


if __name__ == "__main__":
    main()
