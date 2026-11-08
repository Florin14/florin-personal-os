"""Public interface of the audit module.

Usage from another module's service (committed together with the caller's changes)::

    AuditRecorder(session).record("invoice.issued", actor_user_id=..., workspace_id=...)
"""

from app.modules.audit.service import ActorType, AuditRecorder, Outcome

__all__ = ["ActorType", "AuditRecorder", "Outcome"]
