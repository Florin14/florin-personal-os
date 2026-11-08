"""Shared test fixtures.

Tests run against a real PostgreSQL database given by ``TEST_DATABASE_URL``.
The schema is created once per session through the real Alembic migrations;
each test runs inside a transaction that is rolled back afterwards, while
service-level ``commit()`` calls become savepoint releases.
"""

from __future__ import annotations

import os
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from pydantic import SecretStr
from sqlalchemy import Connection, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.core.config import Environment, Settings
from app.core.dependencies import get_db_session
from app.core.security import totp
from app.core.security.encryption import SecretBox, generate_key
from app.main import create_app
from app.modules.identity.models import User
from app.modules.identity.service import IdentityService
from app.modules.workspaces.models import Workspace, WorkspaceKind
from app.modules.workspaces.service import WorkspaceService

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGIN = "http://testserver"
DEFAULT_PASSWORD = "correct horse battery staple"


def _test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.exit(
            "TEST_DATABASE_URL is not set. Run the tests through docker compose "
            "(see README) or export a PostgreSQL URL for a disposable database.",
            returncode=2,
        )
    return url


def alembic_config(connection: Connection) -> Config:
    config = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_DIR, "app", "migrations"))
    config.attributes["connection"] = connection
    return config


@pytest.fixture(scope="session")
def encryption_key() -> str:
    return generate_key()


def make_settings(encryption_key: str, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": Environment.TEST,
        "database_url": SecretStr(_test_database_url()),
        "encryption_keys": [SecretStr(encryption_key)],
        "allowed_origins": [ORIGIN],
        "session_cookie_secure": False,
        "auth_require_mfa": True,
        "session_touch_interval_seconds": 0,
        "log_level": "WARNING",
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


@pytest.fixture
def settings(encryption_key: str) -> Settings:
    return make_settings(encryption_key)


@pytest.fixture
def secret_box(encryption_key: str) -> SecretBox:
    return SecretBox([encryption_key])


@pytest.fixture(scope="session")
async def engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(_test_database_url())
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(lambda sync_conn: command.upgrade(alembic_config(sync_conn), "head"))
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with engine.connect() as conn:
        outer = await conn.begin()
        session = AsyncSession(
            bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        try:
            yield session
        finally:
            await session.close()
            await outer.rollback()


def build_app(settings: Settings, db_session: AsyncSession) -> FastAPI:
    app = create_app(settings)

    async def _session_override() -> AsyncIterator[AsyncSession]:
        try:
            yield db_session
        finally:
            # Mimic a fresh session per request: discard uncommitted work and identity map.
            await db_session.rollback()
            db_session.expunge_all()

    app.dependency_overrides[get_db_session] = _session_override
    return app


@pytest.fixture
def app(settings: Settings, db_session: AsyncSession) -> FastAPI:
    return build_app(settings, db_session)


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=ORIGIN
    ) as http_client:
        yield http_client


@pytest.fixture
def identity(
    db_session: AsyncSession, settings: Settings, secret_box: SecretBox
) -> IdentityService:
    return IdentityService(db_session, settings, secret_box)


@dataclass
class UserFactory:
    db: AsyncSession
    identity: IdentityService
    counter: int = 0

    async def __call__(self, *, email: str | None = None, password: str = DEFAULT_PASSWORD) -> User:
        self.counter += 1
        email = email or f"user{self.counter}-{time.monotonic_ns()}@example.test"
        return await self.identity.create_user(email, f"User {self.counter}", password)

    async def workspace(
        self, owner: User, name: str, kind: WorkspaceKind = WorkspaceKind.PERSONAL
    ) -> Workspace:
        return await WorkspaceService(self.db).create_workspace(
            owner_id=owner.id, name=name, kind=kind, slug=f"{name}-{time.monotonic_ns()}"
        )


@pytest.fixture
def make_user(db_session: AsyncSession, identity: IdentityService) -> UserFactory:
    return UserFactory(db_session, identity)


def totp_code(secret: str, step_offset: int = 0) -> str:
    """Code for the current step + offset (offset avoids replay rejections in tests)."""
    return totp.current_code(secret, time.time() + step_offset * totp.TOTP_INTERVAL_SECONDS)


async def get_with_session_token(
    app: FastAPI, settings: Settings, path: str, token: str
) -> httpx.Response:
    """GET ``path`` from a fresh client that only carries the given session token."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url=ORIGIN,
        cookies={settings.session_cookie_name: token},
    ) as fresh:
        return await fresh.get(path)


def csrf_headers(client: httpx.AsyncClient, settings: Settings) -> dict[str, str]:
    token = client.cookies.get(settings.csrf_cookie_name)
    assert token, "no CSRF cookie set"
    return {"X-CSRF-Token": token}


@dataclass
class AuthenticatedUser:
    user: User
    totp_secret: str


@pytest.fixture
def login_full(
    client: httpx.AsyncClient, settings: Settings
) -> Callable[..., Awaitable[AuthenticatedUser]]:
    """Log in through the API, enrolling TOTP, ending with a full session."""

    async def _login(user: User, password: str = DEFAULT_PASSWORD) -> AuthenticatedUser:
        resp = await client.post(
            "/api/v1/auth/login", json={"email": user.email, "password": password}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["next_step"] == "mfa_enroll"
        setup = await client.post(
            "/api/v1/auth/mfa/totp/setup", headers=csrf_headers(client, settings)
        )
        assert setup.status_code == 200, setup.text
        secret = setup.json()["secret"]
        confirm = await client.post(
            "/api/v1/auth/mfa/totp/confirm",
            json={"code": totp_code(secret)},
            headers=csrf_headers(client, settings),
        )
        assert confirm.status_code == 200, confirm.text
        assert confirm.json()["auth_level"] == "full"
        return AuthenticatedUser(user=user, totp_secret=secret)

    return _login
