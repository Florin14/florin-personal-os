"""Composition root: builds the FastAPI application from registered modules."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import Settings, get_settings
from app.core.db import create_engine, create_session_factory
from app.core.http import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import (
    OriginCheckMiddleware,
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.module import Module, build_action_registry
from app.core.security.encryption import SecretBox
from app.modules.registry import MODULES


def create_app(settings: Settings | None = None, modules: Sequence[Module] = MODULES) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings)
        app.state.session_factory = create_session_factory(engine)
        try:
            yield
        finally:
            await engine.dispose()

    docs_enabled = not settings.is_production
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
    )
    app.state.settings = settings
    app.state.secret_box = SecretBox([k.get_secret_value() for k in settings.encryption_keys])
    app.state.modules = tuple(modules)
    app.state.actions = build_action_registry(modules)

    # Starlette runs the last-added middleware first.
    app.add_middleware(OriginCheckMiddleware, allowed_origins=settings.allowed_origins)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)

    register_error_handlers(app)
    for module in modules:
        for router in module.routers:
            app.include_router(router)
    return app


def app_factory() -> FastAPI:
    """Entry point for ``uvicorn --factory app.main:app_factory``."""
    return create_app()
