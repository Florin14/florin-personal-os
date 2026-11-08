"""Database migration tests."""

from __future__ import annotations

from typing import Any

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, inspect
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.db import Base
from app.modules.registry import import_all_models
from tests.conftest import alembic_config

import_all_models()


def _diff(sync_conn: Connection) -> list[Any]:
    context = MigrationContext.configure(
        sync_conn, opts={"compare_type": True, "compare_server_default": True}
    )
    return list(compare_metadata(context, Base.metadata))


async def test_single_head(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        heads = await conn.run_sync(
            lambda c: ScriptDirectory.from_config(alembic_config(c)).get_heads()
        )
    assert len(heads) == 1


async def test_models_match_migrations(engine: AsyncEngine) -> None:
    """Fails when a model change is missing an Alembic migration."""
    async with engine.connect() as conn:
        diff = await conn.run_sync(_diff)
    assert diff == []


async def test_downgrade_to_base_and_upgrade_again(engine: AsyncEngine) -> None:
    # PostgreSQL DDL is transactional: the round trip is rolled back afterwards.
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            await conn.run_sync(lambda c: command.downgrade(alembic_config(c), "base"))
            tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
            assert set(tables) <= {"alembic_version"}
            await conn.run_sync(lambda c: command.upgrade(alembic_config(c), "head"))
            tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
            assert {"users", "user_sessions", "workspaces", "workspace_memberships"} <= set(tables)
            assert await conn.run_sync(_diff) == []
        finally:
            await transaction.rollback()
