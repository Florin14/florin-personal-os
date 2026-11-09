"""The single list of enabled modules. Add new modules here."""

from __future__ import annotations

from app.core.module import Module
from app.modules.approvals.module import module as approvals
from app.modules.audit.module import module as audit
from app.modules.automation.module import module as automation
from app.modules.banking.module import module as banking
from app.modules.calendar.module import module as calendar
from app.modules.discord.module import module as discord
from app.modules.documents.module import module as documents
from app.modules.events.module import module as events
from app.modules.expenses.module import module as expenses
from app.modules.google.module import module as google
from app.modules.identity.module import module as identity
from app.modules.integrations.module import module as integrations
from app.modules.invoicing.module import module as invoicing
from app.modules.jobs.module import module as jobs
from app.modules.notifications.module import module as notifications
from app.modules.oblio.module import module as oblio
from app.modules.system.module import module as system
from app.modules.workspaces.module import module as workspaces

MODULES: tuple[Module, ...] = (
    system,
    identity,
    workspaces,
    audit,
    jobs,
    events,
    notifications,
    approvals,
    automation,
    integrations,
    oblio,
    invoicing,
    discord,
    google,
    calendar,
    documents,
    expenses,
    banking,
)


def import_all_models() -> None:
    """Import every module's ORM models so they register on ``Base.metadata``.

    Used by Alembic and tests.
    """
    import app.modules.approvals.models
    import app.modules.audit.models
    import app.modules.automation.models
    import app.modules.banking.models
    import app.modules.calendar.service
    import app.modules.documents.service
    import app.modules.events.models
    import app.modules.expenses.service
    import app.modules.google.service
    import app.modules.identity.models
    import app.modules.integrations.models
    import app.modules.invoicing.models
    import app.modules.jobs.models
    import app.modules.notifications.models
    import app.modules.workspaces.models  # noqa: F401
