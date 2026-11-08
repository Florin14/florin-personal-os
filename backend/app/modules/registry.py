"""The single list of enabled modules. Add new modules here."""

from __future__ import annotations

from app.core.module import Module
from app.modules.audit.module import module as audit
from app.modules.identity.module import module as identity
from app.modules.system.module import module as system
from app.modules.workspaces.module import module as workspaces

MODULES: tuple[Module, ...] = (system, identity, workspaces, audit)


def import_all_models() -> None:
    """Import every module's ORM models so they register on ``Base.metadata``.

    Used by Alembic and tests.
    """
    import app.modules.audit.models
    import app.modules.identity.models
    import app.modules.workspaces.models  # noqa: F401
