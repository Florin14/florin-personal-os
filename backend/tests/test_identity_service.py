"""IdentityService unit tests with a controllable clock."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import Conflict, ValidationFailed
from app.core.security import totp
from app.core.security.encryption import SecretBox
from app.modules.identity.models import AuthLevel
from app.modules.identity.service import (
    AccountLocked,
    IdentityService,
    InvalidCredentials,
    NextStep,
)
from tests.conftest import DEFAULT_PASSWORD, Clock, UserFactory, make_settings


@pytest.fixture
def service(
    db_session: AsyncSession, settings: Settings, secret_box: SecretBox, clock: Clock
) -> IdentityService:
    return IdentityService(db_session, settings, secret_box, clock=clock)


async def _full_session(service: IdentityService, email: str, clock: Clock) -> str:
    """Login + TOTP enrollment; returns the full session token."""
    issued = await service.login(email, DEFAULT_PASSWORD, user_agent="pytest", ip_address=None)
    enrollment = await service.begin_totp_enrollment(issued.context)
    code = totp.current_code(enrollment.secret, clock.now.timestamp())
    upgraded = await service.confirm_totp_enrollment(issued.context, code)
    assert upgraded.context.auth_level is AuthLevel.FULL
    return upgraded.token


class TestUsers:
    async def test_duplicate_email_rejected(self, service: IdentityService) -> None:
        await service.create_user("dup@example.test", "A", DEFAULT_PASSWORD)
        with pytest.raises(Conflict):
            await service.create_user("DUP@example.test", "B", DEFAULT_PASSWORD)

    @pytest.mark.parametrize("password", ["short", "x" * 257, "same@example.test"])
    async def test_password_policy(self, service: IdentityService, password: str) -> None:
        with pytest.raises(ValidationFailed):
            await service.create_user("same@example.test", "A", password)


class TestSessions:
    async def test_idle_timeout(
        self, service: IdentityService, make_user: UserFactory, clock: Clock, settings: Settings
    ) -> None:
        user = await make_user()
        token = await _full_session(service, user.email, clock)
        clock.advance(minutes=settings.session_idle_timeout_minutes - 1)
        assert await service.resolve_session(token) is not None  # also refreshes last_seen
        clock.advance(minutes=settings.session_idle_timeout_minutes - 1)
        assert await service.resolve_session(token) is not None
        clock.advance(minutes=settings.session_idle_timeout_minutes + 1)
        assert await service.resolve_session(token) is None

    async def test_absolute_timeout(
        self,
        db_session: AsyncSession,
        secret_box: SecretBox,
        encryption_key: str,
        make_user: UserFactory,
        clock: Clock,
    ) -> None:
        settings = make_settings(
            encryption_key, session_absolute_timeout_hours=2, session_idle_timeout_minutes=90
        )
        service = IdentityService(db_session, settings, secret_box, clock=clock)
        user = await make_user()
        token = await _full_session(service, user.email, clock)
        for _ in range(2):
            clock.advance(minutes=59)
            assert await service.resolve_session(token) is not None
        clock.advance(minutes=3)
        assert await service.resolve_session(token) is None

    async def test_pending_session_is_short_lived(
        self, service: IdentityService, make_user: UserFactory, clock: Clock
    ) -> None:
        user = await make_user()
        issued = await service.login(user.email, DEFAULT_PASSWORD, user_agent=None, ip_address=None)
        assert service.next_step(issued.context) is NextStep.MFA_ENROLL
        clock.advance(minutes=11)
        assert await service.resolve_session(issued.token) is None

    async def test_unknown_token(self, service: IdentityService) -> None:
        assert await service.resolve_session("does-not-exist") is None

    async def test_inactive_user_session_is_invalid(
        self,
        service: IdentityService,
        make_user: UserFactory,
        clock: Clock,
        db_session: AsyncSession,
    ) -> None:
        user = await make_user()
        token = await _full_session(service, user.email, clock)
        user.is_active = False
        await db_session.commit()
        assert await service.resolve_session(token) is None
        with pytest.raises(InvalidCredentials):
            await service.login(user.email, DEFAULT_PASSWORD, user_agent=None, ip_address=None)


class TestLockout:
    async def test_lock_expires(
        self, service: IdentityService, make_user: UserFactory, clock: Clock, settings: Settings
    ) -> None:
        user = await make_user()
        for _ in range(settings.auth_max_failed_logins):
            with pytest.raises(InvalidCredentials):
                await service.login(
                    user.email, "wrong password!!", user_agent=None, ip_address=None
                )
        with pytest.raises(AccountLocked):
            await service.login(user.email, DEFAULT_PASSWORD, user_agent=None, ip_address=None)
        clock.advance(minutes=settings.auth_lockout_minutes + 1)
        issued = await service.login(user.email, DEFAULT_PASSWORD, user_agent=None, ip_address=None)
        assert issued.token

    async def test_successful_login_resets_counter(
        self, service: IdentityService, make_user: UserFactory, settings: Settings
    ) -> None:
        user = await make_user()
        for _ in range(settings.auth_max_failed_logins - 1):
            with pytest.raises(InvalidCredentials):
                await service.login(
                    user.email, "wrong password!!", user_agent=None, ip_address=None
                )
        await service.login(user.email, DEFAULT_PASSWORD, user_agent=None, ip_address=None)
        assert user.failed_login_count == 0


class TestMfaReset:
    async def test_reset_mfa_removes_secret_and_revokes_sessions(
        self, service: IdentityService, make_user: UserFactory, clock: Clock
    ) -> None:
        user = await make_user()
        token = await _full_session(service, user.email, clock)
        assert user.mfa_enabled
        await service.reset_mfa(user.email)
        assert not user.mfa_enabled
        assert user.totp_secret_encrypted is None
        assert await service.resolve_session(token) is None
        issued = await service.login(user.email, DEFAULT_PASSWORD, user_agent=None, ip_address=None)
        assert service.next_step(issued.context) is NextStep.MFA_ENROLL
