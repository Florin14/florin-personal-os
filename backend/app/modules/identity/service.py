"""Identity application service: users, authentication, sessions and MFA.

Framework independent: no FastAPI/Starlette imports. Transactions are
committed explicitly by each public method.
"""

from __future__ import annotations

import logging
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.db import utcnow
from app.core.errors import (
    Conflict,
    Forbidden,
    NotFound,
    RateLimited,
    Unauthenticated,
    ValidationFailed,
)
from app.core.security import passwords, totp
from app.core.security.encryption import SecretBox
from app.core.security.tokens import generate_token, hash_token
from app.modules.audit.public import ActorType, AuditRecorder, Outcome
from app.modules.identity.models import AuthLevel, User, UserSession

logger = logging.getLogger(__name__)

# Sessions that still need MFA are short-lived to limit the window for code guessing.
PENDING_SESSION_LIFETIME = timedelta(minutes=10)


class NextStep(StrEnum):
    NONE = "none"
    MFA_VERIFY = "mfa_verify"
    MFA_ENROLL = "mfa_enroll"


@dataclass(frozen=True, slots=True)
class AuthContext:
    user: User
    session: UserSession

    @property
    def auth_level(self) -> AuthLevel:
        return AuthLevel(self.session.auth_level)


@dataclass(frozen=True, slots=True)
class IssuedSession:
    """A newly created session. ``token`` is only ever held in memory/cookies."""

    token: str
    context: AuthContext


@dataclass(frozen=True, slots=True)
class TotpEnrollment:
    secret: str
    provisioning_uri: str


class InvalidCredentials(Unauthenticated):
    code = "invalid_credentials"
    message = "Invalid email or password."


class InvalidMfaCode(Unauthenticated):
    code = "invalid_mfa_code"
    message = "Invalid or already used verification code."


class AccountLocked(RateLimited):
    code = "account_locked"
    message = "Too many failed attempts. Try again later."


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_password_policy(password: str, email: str | None = None) -> None:
    if not passwords.MIN_PASSWORD_LENGTH <= len(password) <= passwords.MAX_PASSWORD_LENGTH:
        raise ValidationFailed(
            f"Password must be between {passwords.MIN_PASSWORD_LENGTH} and "
            f"{passwords.MAX_PASSWORD_LENGTH} characters.",
            code="weak_password",
        )
    if email is not None and password.strip().lower() == normalize_email(email):
        raise ValidationFailed("Password must not equal the email address.", code="weak_password")


class IdentityService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        secret_box: SecretBox,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self._db = session
        self._settings = settings
        self._secret_box = secret_box
        self._now = clock
        self._audit = AuditRecorder(session)

    def _record(
        self,
        action: str,
        user_id: uuid.UUID | None,
        *,
        outcome: Outcome = Outcome.SUCCESS,
        ip_address: str | None = None,
        actor_type: ActorType = ActorType.USER,
        **details: object,
    ) -> None:
        self._audit.record(
            action,
            outcome=outcome,
            actor_type=actor_type,
            actor_user_id=user_id,
            target_type="user",
            target_id=user_id,
            ip_address=ip_address,
            details=dict(details),
        )

    # ------------------------------------------------------------------ users

    async def create_user(
        self,
        email: str,
        display_name: str,
        password: str,
        timezone: str = "Europe/Bucharest",
        *,
        is_admin: bool = False,
    ) -> User:
        email = normalize_email(email)
        validate_password_policy(password, email)
        existing = await self._db.scalar(select(User.id).where(User.email == email))
        if existing is not None:
            raise Conflict("A user with this email already exists.", code="email_taken")
        user = User(
            email=email,
            display_name=display_name.strip(),
            password_hash=passwords.hash_password(password),
            timezone=timezone,
            is_admin=is_admin,
        )
        self._db.add(user)
        await self._db.flush()
        self._record("user.created", user.id, actor_type=ActorType.SYSTEM, is_admin=is_admin)
        await self._db.commit()
        logger.info("user_created", extra={"user_id": str(user.id)})
        return user

    async def get_user_by_email(self, email: str) -> User:
        user = await self._db.scalar(select(User).where(User.email == normalize_email(email)))
        if user is None:
            raise NotFound("User not found.")
        return user

    # ---------------------------------------------------------- authentication

    def next_step(self, ctx: AuthContext) -> NextStep:
        if ctx.auth_level is AuthLevel.FULL:
            return NextStep.NONE
        return NextStep.MFA_VERIFY if ctx.user.mfa_enabled else NextStep.MFA_ENROLL

    async def login(
        self, email: str, password: str, *, user_agent: str | None, ip_address: str | None
    ) -> IssuedSession:
        now = self._now()
        # Row lock serializes concurrent attempts so failure counters cannot be lost.
        user = await self._db.scalar(
            select(User).where(User.email == normalize_email(email)).with_for_update()
        )
        password_ok = passwords.verify_password(user.password_hash if user else None, password)

        if user is None or not user.is_active:
            self._record(
                "auth.login.failed",
                user.id if user else None,
                outcome=Outcome.FAILURE,
                ip_address=ip_address,
                reason="unknown_or_inactive_user",
            )
            await self._db.commit()
            raise InvalidCredentials()
        if user.locked_until is not None and user.locked_until > now:
            self._record(
                "auth.login.locked", user.id, outcome=Outcome.DENIED, ip_address=ip_address
            )
            await self._db.commit()
            raise AccountLocked()
        if not password_ok:
            self._record(
                "auth.login.failed",
                user.id,
                outcome=Outcome.FAILURE,
                ip_address=ip_address,
                reason="invalid_password",
            )
            await self._register_failure(user, now)
            raise InvalidCredentials()

        user.failed_login_count = 0
        user.locked_until = None
        if passwords.needs_rehash(user.password_hash):
            user.password_hash = passwords.hash_password(password)

        needs_second_step = user.mfa_enabled or self._settings.auth_require_mfa
        level = AuthLevel.PASSWORD if needs_second_step else AuthLevel.FULL
        if level is AuthLevel.FULL:
            user.last_login_at = now
        issued = self._new_session(user, level, user_agent=user_agent, ip_address=ip_address)
        self._record("auth.login.password_ok", user.id, ip_address=ip_address, level=level.value)
        await self._db.commit()
        logger.info("login_password_ok", extra={"user_id": str(user.id), "level": level.value})
        return issued

    async def resolve_session(self, token: str) -> AuthContext | None:
        """Return the context for a valid session token, or ``None``."""
        now = self._now()
        row = (
            await self._db.execute(
                select(UserSession, User)
                .join(User, User.id == UserSession.user_id)
                .where(UserSession.token_hash == hash_token(token))
            )
        ).one_or_none()
        if row is None:
            return None
        session, user = row
        if session.revoked_at is not None or session.expires_at <= now or not user.is_active:
            return None
        idle_limit = timedelta(minutes=self._settings.session_idle_timeout_minutes)
        if session.last_seen_at + idle_limit <= now:
            return None
        touch_interval = timedelta(seconds=self._settings.session_touch_interval_seconds)
        if now - session.last_seen_at >= touch_interval:
            session.last_seen_at = now
            await self._db.commit()
        return AuthContext(user=user, session=session)

    async def verify_mfa(self, ctx: AuthContext, code: str) -> IssuedSession:
        """Second factor for a password-level session. Rotates the session."""
        if ctx.auth_level is AuthLevel.FULL:
            raise Conflict("Session is already fully authenticated.", code="already_verified")
        user = ctx.user
        if not user.mfa_enabled or user.totp_secret_encrypted is None:
            raise Conflict("MFA is not enabled; enroll first.", code="mfa_not_enabled")
        now = self._now()
        if user.locked_until is not None and user.locked_until > now:
            raise AccountLocked()
        await self._check_totp(ctx, user.totp_secret_encrypted, code, now)
        self._record("auth.mfa.verified", user.id, ip_address=ctx.session.ip_address)
        return await self._upgrade_session(ctx, now)

    async def confirm_step_up(self, ctx: AuthContext, code: str) -> None:
        """Fresh second-factor confirmation for high-risk actions (e.g. approvals)."""
        user = ctx.user
        if not user.mfa_enabled or user.totp_secret_encrypted is None:
            raise Forbidden("Two-factor authentication must be enabled.", code="mfa_not_enabled")
        now = self._now()
        if user.locked_until is not None and user.locked_until > now:
            raise AccountLocked()
        await self._check_totp(ctx, user.totp_secret_encrypted, code, now)
        self._record("auth.mfa.step_up", user.id, ip_address=ctx.session.ip_address)
        await self._db.commit()

    async def begin_totp_enrollment(self, ctx: AuthContext) -> TotpEnrollment:
        user = ctx.user
        if user.mfa_enabled:
            raise Conflict("MFA is already enabled.", code="mfa_already_enabled")
        secret = totp.generate_secret()
        user.totp_secret_encrypted = self._secret_box.encrypt(secret)
        user.totp_last_used_step = None
        await self._db.commit()
        return TotpEnrollment(
            secret=secret,
            provisioning_uri=totp.provisioning_uri(secret, user.email, self._settings.totp_issuer),
        )

    async def confirm_totp_enrollment(self, ctx: AuthContext, code: str) -> IssuedSession:
        user = ctx.user
        if user.mfa_enabled:
            raise Conflict("MFA is already enabled.", code="mfa_already_enabled")
        if user.totp_secret_encrypted is None:
            raise Conflict("Start MFA enrollment first.", code="mfa_enrollment_not_started")
        now = self._now()
        await self._check_totp(ctx, user.totp_secret_encrypted, code, now)
        user.totp_enabled_at = now
        self._record("auth.mfa.enrolled", user.id, ip_address=ctx.session.ip_address)
        logger.info("mfa_enabled", extra={"user_id": str(user.id)})
        return await self._upgrade_session(ctx, now, force_rotation=True)

    async def logout(self, ctx: AuthContext) -> None:
        ctx.session.revoked_at = self._now()
        self._record("auth.logout", ctx.user.id, ip_address=ctx.session.ip_address)
        await self._db.commit()

    # ---------------------------------------------------------------- sessions

    async def list_sessions(self, ctx: AuthContext) -> list[UserSession]:
        now = self._now()
        result = await self._db.scalars(
            select(UserSession)
            .where(
                UserSession.user_id == ctx.user.id,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > now,
            )
            .order_by(UserSession.last_seen_at.desc())
        )
        return list(result)

    async def revoke_session(self, ctx: AuthContext, session_id: uuid.UUID) -> None:
        target = await self._db.scalar(
            select(UserSession).where(
                UserSession.id == session_id, UserSession.user_id == ctx.user.id
            )
        )
        # Sessions of other users are indistinguishable from missing ones.
        if target is None or target.revoked_at is not None:
            raise NotFound("Session not found.")
        target.revoked_at = self._now()
        self._record(
            "auth.session.revoked",
            ctx.user.id,
            ip_address=ctx.session.ip_address,
            session_id=str(session_id),
        )
        await self._db.commit()

    async def change_password(
        self, ctx: AuthContext, current_password: str, new_password: str
    ) -> None:
        user = ctx.user
        if not passwords.verify_password(user.password_hash, current_password):
            self._record(
                "auth.password.change_failed",
                user.id,
                outcome=Outcome.FAILURE,
                ip_address=ctx.session.ip_address,
            )
            await self._db.commit()
            raise Forbidden("Current password is incorrect.", code="invalid_current_password")
        validate_password_policy(new_password, user.email)
        user.password_hash = passwords.hash_password(new_password)
        await self._revoke_other_sessions(user.id, keep=ctx.session.id)
        self._record("auth.password.changed", user.id, ip_address=ctx.session.ip_address)
        await self._db.commit()
        logger.info("password_changed", extra={"user_id": str(user.id)})

    # ------------------------------------------------------------------- admin

    async def reset_mfa(self, email: str) -> None:
        """Remove TOTP for a user and revoke all sessions (server-side recovery)."""
        user = await self.get_user_by_email(email)
        user.totp_secret_encrypted = None
        user.totp_enabled_at = None
        user.totp_last_used_step = None
        await self._revoke_other_sessions(user.id, keep=None)
        self._record("auth.mfa.reset", user.id, actor_type=ActorType.SYSTEM)
        await self._db.commit()
        logger.warning("mfa_reset", extra={"user_id": str(user.id)})

    # ----------------------------------------------------------------- helpers

    def _new_session(
        self,
        user: User,
        level: AuthLevel,
        *,
        user_agent: str | None,
        ip_address: str | None,
    ) -> IssuedSession:
        now = self._now()
        lifetime = (
            timedelta(hours=self._settings.session_absolute_timeout_hours)
            if level is AuthLevel.FULL
            else PENDING_SESSION_LIFETIME
        )
        token = generate_token()
        session = UserSession(
            id=uuid.uuid4(),
            user_id=user.id,
            token_hash=hash_token(token),
            csrf_token=secrets.token_urlsafe(32),
            auth_level=level.value,
            expires_at=now + lifetime,
            last_seen_at=now,
            user_agent=user_agent[:512] if user_agent else None,
            ip_address=ip_address,
        )
        self._db.add(session)
        return IssuedSession(token=token, context=AuthContext(user=user, session=session))

    async def _upgrade_session(
        self, ctx: AuthContext, now: datetime, *, force_rotation: bool = False
    ) -> IssuedSession:
        """Replace the session with a new fully authenticated one (prevents fixation)."""
        if ctx.auth_level is AuthLevel.FULL and not force_rotation:
            raise Conflict("Session is already fully authenticated.", code="already_verified")
        ctx.session.revoked_at = now
        ctx.user.last_login_at = now
        issued = self._new_session(
            ctx.user,
            AuthLevel.FULL,
            user_agent=ctx.session.user_agent,
            ip_address=ctx.session.ip_address,
        )
        await self._db.commit()
        return issued

    async def _check_totp(
        self, ctx: AuthContext, encrypted_secret: str, code: str, now: datetime
    ) -> None:
        user = ctx.user
        # Lock and re-read the user so two concurrent requests cannot both accept
        # the same time step (replay protection) or lose failure counts.
        await self._db.refresh(user, with_for_update=True)
        secret = self._secret_box.decrypt(encrypted_secret)
        step = totp.matching_step(secret, code, user.totp_last_used_step, at=now.timestamp())
        if step is None:
            self._record(
                "auth.mfa.failed",
                user.id,
                outcome=Outcome.FAILURE,
                ip_address=ctx.session.ip_address,
            )
            locked = await self._register_failure(user, now)
            if locked:
                ctx.session.revoked_at = now
                await self._db.commit()
                raise AccountLocked()
            raise InvalidMfaCode()
        user.totp_last_used_step = step
        user.failed_login_count = 0

    async def _register_failure(self, user: User, now: datetime) -> bool:
        """Count a failed attempt; returns True when the account became locked."""
        user.failed_login_count += 1
        locked = user.failed_login_count >= self._settings.auth_max_failed_logins
        if locked:
            user.locked_until = now + timedelta(minutes=self._settings.auth_lockout_minutes)
            user.failed_login_count = 0
            self._record("auth.account.locked", user.id, outcome=Outcome.DENIED)
            logger.warning("account_locked", extra={"user_id": str(user.id)})
        await self._db.commit()
        return locked

    async def _revoke_other_sessions(self, user_id: uuid.UUID, keep: uuid.UUID | None) -> None:
        stmt = (
            update(UserSession)
            .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
            .values(revoked_at=self._now())
        )
        if keep is not None:
            stmt = stmt.where(UserSession.id != keep)
        await self._db.execute(stmt)
