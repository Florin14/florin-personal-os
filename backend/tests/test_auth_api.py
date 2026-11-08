"""Authentication API integration tests (real database, ASGI client)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import httpx
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.modules.identity.models import User, UserSession
from tests.conftest import (
    DEFAULT_PASSWORD,
    AuthenticatedUser,
    UserFactory,
    build_app,
    csrf_headers,
    get_with_session_token,
    make_settings,
    totp_code,
)

LoginFull = Callable[..., Awaitable[AuthenticatedUser]]


async def _login(
    client: httpx.AsyncClient, email: str, password: str = DEFAULT_PASSWORD
) -> httpx.Response:
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


class TestLogin:
    async def test_unauthenticated_requests_are_rejected(self, client: httpx.AsyncClient) -> None:
        for path in ("/api/v1/auth/me", "/api/v1/workspaces", "/api/v1/system/info"):
            resp = await client.get(path)
            assert resp.status_code == 401
            assert resp.json() == {
                "error": {"code": "unauthenticated", "message": "Authentication required."}
            }

    async def test_wrong_password_and_unknown_user_look_identical(
        self, client: httpx.AsyncClient, make_user: UserFactory
    ) -> None:
        user = await make_user()
        wrong = await _login(client, user.email, "wrong password 123")
        unknown = await _login(client, "nobody@example.test")
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json()
        assert wrong.json()["error"]["code"] == "invalid_credentials"
        assert "set-cookie" not in wrong.headers

    async def test_email_is_case_insensitive(
        self, client: httpx.AsyncClient, make_user: UserFactory
    ) -> None:
        user = await make_user()
        resp = await _login(client, user.email.upper())
        assert resp.status_code == 200

    async def test_session_cookie_flags(
        self, client: httpx.AsyncClient, make_user: UserFactory, settings: Settings
    ) -> None:
        user = await make_user()
        resp = await _login(client, user.email)
        cookies = resp.headers.get_list("set-cookie")
        session_cookie = next(c for c in cookies if c.startswith(settings.session_cookie_name))
        csrf_cookie = next(c for c in cookies if c.startswith(settings.csrf_cookie_name))
        assert "HttpOnly" in session_cookie
        assert "samesite=lax" in session_cookie.lower()
        assert "HttpOnly" not in csrf_cookie
        assert "samesite=strict" in csrf_cookie.lower()

    async def test_session_token_is_stored_hashed(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
        db_session: AsyncSession,
    ) -> None:
        user = await make_user()
        await _login(client, user.email)
        token = client.cookies.get(settings.session_cookie_name)
        assert token
        stored = await db_session.scalars(select(UserSession.token_hash))
        assert all(token.encode() != h for h in stored)

    async def test_validation_errors_do_not_echo_input(self, client: httpx.AsyncClient) -> None:
        resp = await client.post(
            "/api/v1/auth/login", json={"email": "x", "password": "super-secret-value"}
        )
        assert resp.status_code == 422
        assert "super-secret-value" not in resp.text
        assert resp.json()["error"]["code"] == "validation_failed"

    async def test_unknown_fields_rejected(self, client: httpx.AsyncClient) -> None:
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "a@b.test", "password": "x", "is_admin": True},
        )
        assert resp.status_code == 422


class TestMfaFlow:
    async def test_enrollment_required_before_full_access(
        self, client: httpx.AsyncClient, make_user: UserFactory, settings: Settings
    ) -> None:
        user = await make_user()
        resp = await _login(client, user.email)
        body = resp.json()
        assert body["auth_level"] == "password"
        assert body["next_step"] == "mfa_enroll"
        # A password-only session can see /me but nothing else.
        assert (await client.get("/api/v1/auth/me")).status_code == 200
        blocked = await client.get("/api/v1/workspaces")
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "mfa_required"

    async def test_enrollment_then_login_with_totp(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
    ) -> None:
        user = await make_user()
        auth = await login_full(user)
        assert (await client.get("/api/v1/workspaces")).status_code == 200

        await client.post("/api/v1/auth/logout", headers=csrf_headers(client, settings))
        resp = await _login(client, user.email)
        assert resp.json()["next_step"] == "mfa_verify"
        assert resp.json()["user"]["mfa_enabled"] is True

        valid = {totp_code(auth.totp_secret, o) for o in (-1, 0, 1)}
        wrong = next(c for c in ("000000", "111111", "222222", "333333") if c not in valid)
        bad = await client.post(
            "/api/v1/auth/mfa/verify", json={"code": wrong}, headers=csrf_headers(client, settings)
        )
        assert bad.status_code == 401
        assert bad.json()["error"]["code"] == "invalid_mfa_code"

        ok = await client.post(
            "/api/v1/auth/mfa/verify",
            json={"code": totp_code(auth.totp_secret, step_offset=1)},
            headers=csrf_headers(client, settings),
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["auth_level"] == "full"
        assert ok.json()["next_step"] == "none"

    async def test_totp_code_cannot_be_replayed(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
    ) -> None:
        user = await make_user()
        auth = await login_full(user)  # consumed the current step during enrollment
        await client.post("/api/v1/auth/logout", headers=csrf_headers(client, settings))
        await _login(client, user.email)
        replay = await client.post(
            "/api/v1/auth/mfa/verify",
            json={"code": totp_code(auth.totp_secret)},
            headers=csrf_headers(client, settings),
        )
        assert replay.status_code == 401

    async def test_session_is_rotated_on_mfa_verification(
        self,
        app: FastAPI,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
    ) -> None:
        user = await make_user()
        await _login(client, user.email)
        pending_token = client.cookies.get(settings.session_cookie_name)
        setup = await client.post(
            "/api/v1/auth/mfa/totp/setup", headers=csrf_headers(client, settings)
        )
        await client.post(
            "/api/v1/auth/mfa/totp/confirm",
            json={"code": totp_code(setup.json()["secret"])},
            headers=csrf_headers(client, settings),
        )
        full_token = client.cookies.get(settings.session_cookie_name)
        assert pending_token
        assert full_token
        assert pending_token != full_token

        # The pre-MFA token is no longer valid.
        stale = await get_with_session_token(app, settings, "/api/v1/auth/me", pending_token)
        assert stale.status_code == 401

    async def test_totp_secret_is_encrypted_at_rest(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
        db_session: AsyncSession,
    ) -> None:
        user = await make_user()
        auth = await login_full(user)
        stored = await db_session.scalar(
            select(User.totp_secret_encrypted).where(User.id == user.id)
        )
        assert stored
        assert auth.totp_secret not in stored

    async def test_mfa_cannot_be_enrolled_twice(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
    ) -> None:
        await login_full(await make_user())
        resp = await client.post(
            "/api/v1/auth/mfa/totp/setup", headers=csrf_headers(client, settings)
        )
        assert resp.status_code == 409

    async def test_without_mfa_requirement_login_is_full(
        self, encryption_key: str, db_session: AsyncSession, make_user: UserFactory
    ) -> None:
        app = build_app(make_settings(encryption_key, auth_require_mfa=False), db_session)
        user = await make_user()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            resp = await _login(client, user.email)
            assert resp.json()["auth_level"] == "full"
            assert (await client.get("/api/v1/workspaces")).status_code == 200


class TestLockout:
    async def test_account_locks_after_repeated_failures(
        self, client: httpx.AsyncClient, make_user: UserFactory, settings: Settings
    ) -> None:
        user = await make_user()
        for _ in range(settings.auth_max_failed_logins):
            assert (await _login(client, user.email, "wrong password 123")).status_code == 401
        locked = await _login(client, user.email)  # even the correct password is refused
        assert locked.status_code == 429
        assert locked.json()["error"]["code"] == "account_locked"

    async def test_wrong_totp_codes_lock_account_and_revoke_pending_session(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
    ) -> None:
        user = await make_user()
        auth = await login_full(user)
        await client.post("/api/v1/auth/logout", headers=csrf_headers(client, settings))
        await _login(client, user.email)
        valid = {totp_code(auth.totp_secret, o) for o in (-1, 0, 1)}
        wrong = next(c for c in ("111111", "222222", "333333", "444444") if c not in valid)
        statuses = []
        for _ in range(settings.auth_max_failed_logins):
            resp = await client.post(
                "/api/v1/auth/mfa/verify",
                json={"code": wrong},
                headers=csrf_headers(client, settings),
            )
            statuses.append(resp.status_code)
        assert statuses[-1] == 429
        assert (await client.get("/api/v1/auth/me")).status_code == 401


class TestCsrfAndOrigin:
    async def test_unsafe_request_without_csrf_token_is_rejected(
        self, client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull
    ) -> None:
        await login_full(await make_user())
        resp = await client.post("/api/v1/auth/logout")
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "csrf_failed"

    async def test_csrf_token_of_another_session_is_rejected(
        self, client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull
    ) -> None:
        await login_full(await make_user())
        resp = await client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": "forged"})
        assert resp.status_code == 403

    async def test_foreign_origin_is_rejected(
        self, client: httpx.AsyncClient, make_user: UserFactory
    ) -> None:
        user = await make_user()
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": DEFAULT_PASSWORD},
            headers={"Origin": "https://evil.example"},
        )
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "origin_not_allowed"

    async def test_allowed_origin_passes(
        self, client: httpx.AsyncClient, make_user: UserFactory
    ) -> None:
        user = await make_user()
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": DEFAULT_PASSWORD},
            headers={"Origin": "http://testserver"},
        )
        assert resp.status_code == 200


class TestSessions:
    async def test_logout_revokes_session(
        self,
        app: FastAPI,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
    ) -> None:
        await login_full(await make_user())
        token = client.cookies.get(settings.session_cookie_name)
        resp = await client.post("/api/v1/auth/logout", headers=csrf_headers(client, settings))
        assert resp.status_code == 204
        assert token
        reuse = await get_with_session_token(app, settings, "/api/v1/auth/me", token)
        assert reuse.status_code == 401

    async def test_list_and_revoke_sessions(
        self,
        app: FastAPI,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
        client: httpx.AsyncClient,
    ) -> None:
        user = await make_user()
        auth = await login_full(user)
        # Second device: a second password+TOTP login on another client.
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as other:
            await _login(other, user.email)
            await other.post(
                "/api/v1/auth/mfa/verify",
                json={"code": totp_code(auth.totp_secret, 1)},
                headers=csrf_headers(other, settings),
            )
            sessions = (await client.get("/api/v1/auth/sessions")).json()
            assert len(sessions) == 2
            assert sum(s["current"] for s in sessions) == 1
            other_id = next(s["id"] for s in sessions if not s["current"])

            resp = await client.delete(
                f"/api/v1/auth/sessions/{other_id}", headers=csrf_headers(client, settings)
            )
            assert resp.status_code == 204
            assert (await other.get("/api/v1/auth/me")).status_code == 401
            again = await client.delete(
                f"/api/v1/auth/sessions/{other_id}", headers=csrf_headers(client, settings)
            )
            assert again.status_code == 404

    async def test_cannot_revoke_another_users_session(
        self,
        app: FastAPI,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
        client: httpx.AsyncClient,
    ) -> None:
        victim = await make_user()
        await login_full(victim)
        victim_sessions = (await client.get("/api/v1/auth/sessions")).json()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as attacker_client:
            attacker = await make_user()
            await _login(attacker_client, attacker.email)
            setup = await attacker_client.post(
                "/api/v1/auth/mfa/totp/setup", headers=csrf_headers(attacker_client, settings)
            )
            await attacker_client.post(
                "/api/v1/auth/mfa/totp/confirm",
                json={"code": totp_code(setup.json()["secret"])},
                headers=csrf_headers(attacker_client, settings),
            )
            resp = await attacker_client.delete(
                f"/api/v1/auth/sessions/{victim_sessions[0]['id']}",
                headers=csrf_headers(attacker_client, settings),
            )
            assert resp.status_code == 404
        assert (await client.get("/api/v1/auth/me")).status_code == 200

    async def test_password_change_revokes_other_sessions(
        self,
        app: FastAPI,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
        client: httpx.AsyncClient,
    ) -> None:
        user = await make_user()
        auth = await login_full(user)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as other:
            await _login(other, user.email)
            await other.post(
                "/api/v1/auth/mfa/verify",
                json={"code": totp_code(auth.totp_secret, 1)},
                headers=csrf_headers(other, settings),
            )
            new_password = "an even better passphrase"
            resp = await client.post(
                "/api/v1/auth/password",
                json={"current_password": DEFAULT_PASSWORD, "new_password": new_password},
                headers=csrf_headers(client, settings),
            )
            assert resp.status_code == 204
            assert (await other.get("/api/v1/auth/me")).status_code == 401
            assert (await client.get("/api/v1/auth/me")).status_code == 200

        await client.post("/api/v1/auth/logout", headers=csrf_headers(client, settings))
        assert (await _login(client, user.email)).status_code == 401
        assert (await _login(client, user.email, new_password)).status_code == 200

    async def test_password_change_requires_current_password(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
    ) -> None:
        await login_full(await make_user())
        resp = await client.post(
            "/api/v1/auth/password",
            json={"current_password": "not my password", "new_password": "another long password"},
            headers=csrf_headers(client, settings),
        )
        assert resp.status_code == 403

    async def test_weak_new_password_rejected(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        settings: Settings,
        login_full: LoginFull,
    ) -> None:
        await login_full(await make_user())
        resp = await client.post(
            "/api/v1/auth/password",
            json={"current_password": DEFAULT_PASSWORD, "new_password": "short"},
            headers=csrf_headers(client, settings),
        )
        assert resp.status_code == 422
