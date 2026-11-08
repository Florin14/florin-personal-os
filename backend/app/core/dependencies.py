"""Application-wide FastAPI dependencies.

Long-lived objects are created once in the lifespan and stored on
``app.state``; tests replace them through ``app.dependency_overrides``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.db import session_scope
from app.core.security.encryption import SecretBox


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_secret_box(request: Request) -> SecretBox:
    box: SecretBox = request.app.state.secret_box
    return box


async def get_db_session(request: Request) -> AsyncIterator[AsyncSession]:
    async for session in session_scope(request.app.state.session_factory):
        yield session


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
SecretBoxDep = Annotated[SecretBox, Depends(get_secret_box)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
