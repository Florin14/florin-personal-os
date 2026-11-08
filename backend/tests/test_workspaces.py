"""Workspace isolation and authorization tests."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.modules.workspaces.models import Role, WorkspaceKind
from app.modules.workspaces.service import WorkspaceService, slugify
from tests.conftest import AuthenticatedUser, UserFactory

LoginFull = Callable[..., Awaitable[AuthenticatedUser]]


class TestWorkspaceApi:
    async def test_lists_only_own_workspaces(
        self, client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull
    ) -> None:
        me, other = await make_user(), await make_user()
        personal = await make_user.workspace(me, "personal")
        business = await make_user.workspace(me, "company", WorkspaceKind.BUSINESS)
        await make_user.workspace(other, "others")
        await login_full(me)

        resp = await client.get("/api/v1/workspaces")
        assert resp.status_code == 200
        items = resp.json()
        assert {w["id"] for w in items} == {str(personal.id), str(business.id)}
        assert {w["kind"] for w in items} == {"personal", "business"}
        assert all(w["role"] == "owner" for w in items)

    async def test_non_member_gets_404(
        self, client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull
    ) -> None:
        me, other = await make_user(), await make_user()
        foreign = await make_user.workspace(other, "foreign")
        await login_full(me)
        resp = await client.get(f"/api/v1/workspaces/{foreign.id}")
        assert resp.status_code == 404
        missing = await client.get(f"/api/v1/workspaces/{uuid.uuid4()}")
        assert missing.json() == resp.json()  # indistinguishable from non-existent

    async def test_member_can_read(
        self,
        client: httpx.AsyncClient,
        make_user: UserFactory,
        login_full: LoginFull,
        db_session: AsyncSession,
    ) -> None:
        me, owner = await make_user(), await make_user()
        shared = await make_user.workspace(owner, "shared")
        await WorkspaceService(db_session).add_member(shared.id, me.id, Role.VIEWER)
        await login_full(me)
        resp = await client.get(f"/api/v1/workspaces/{shared.id}")
        assert resp.status_code == 200
        assert resp.json()["role"] == "viewer"

    async def test_invalid_id_is_validation_error(
        self, client: httpx.AsyncClient, make_user: UserFactory, login_full: LoginFull
    ) -> None:
        await login_full(await make_user())
        assert (await client.get("/api/v1/workspaces/not-a-uuid")).status_code == 422


class TestWorkspaceService:
    async def test_role_hierarchy(self, db_session: AsyncSession, make_user: UserFactory) -> None:
        owner, viewer = await make_user(), await make_user()
        ws = await make_user.workspace(owner, "roles")
        service = WorkspaceService(db_session)
        await service.add_member(ws.id, viewer.id, Role.VIEWER)

        assert (await service.authorize(owner.id, ws.id, Role.OWNER)).role is Role.OWNER
        assert (await service.authorize(viewer.id, ws.id, Role.VIEWER)).role is Role.VIEWER
        with pytest.raises(Forbidden):
            await service.authorize(viewer.id, ws.id, Role.MEMBER)

    async def test_non_member_not_found(
        self, db_session: AsyncSession, make_user: UserFactory
    ) -> None:
        owner, stranger = await make_user(), await make_user()
        ws = await make_user.workspace(owner, "private")
        with pytest.raises(NotFound):
            await WorkspaceService(db_session).authorize(stranger.id, ws.id)

    async def test_duplicate_membership(
        self, db_session: AsyncSession, make_user: UserFactory
    ) -> None:
        owner = await make_user()
        ws = await make_user.workspace(owner, "dup")
        with pytest.raises(Conflict):
            await WorkspaceService(db_session).add_member(ws.id, owner.id, Role.MEMBER)

    async def test_slug_conflict(self, db_session: AsyncSession, make_user: UserFactory) -> None:
        owner = await make_user()
        service = WorkspaceService(db_session)
        slug = f"unique-{uuid.uuid4().hex[:8]}"
        await service.create_workspace(
            owner_id=owner.id, name="A", kind=WorkspaceKind.PERSONAL, slug=slug
        )
        with pytest.raises(Conflict):
            await service.create_workspace(
                owner_id=owner.id, name="B", kind=WorkspaceKind.PERSONAL, slug=slug
            )

    @pytest.mark.parametrize(
        ("kwargs", "code"),
        [
            ({"timezone": "Mars/Olympus"}, "invalid_timezone"),
            ({"default_currency": "lei"}, "invalid_currency"),
            ({"name": "   "}, "validation_failed"),
        ],
    )
    async def test_validation(
        self, db_session: AsyncSession, make_user: UserFactory, kwargs: dict[str, str], code: str
    ) -> None:
        owner = await make_user()
        params: dict[str, str] = {"name": "Valid"} | kwargs
        with pytest.raises(ValidationFailed) as exc_info:
            await WorkspaceService(db_session).create_workspace(
                owner_id=owner.id, kind=WorkspaceKind.BUSINESS, **params
            )
        assert exc_info.value.code == code


@pytest.mark.parametrize(
    ("value", "expected"),
    [("Florin SRL", "florin-srl"), ("Șantier Țară", "santier-tara"), ("  --a__b--  ", "a-b")],
)
def test_slugify(value: str, expected: str) -> None:
    assert slugify(value) == expected
