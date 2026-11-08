"""Public interface of the integrations module.

Adapters load their credentials with ``load_connection`` and flag revoked
credentials with ``mark_connection_error`` (affected workflows then fail safely).
"""

from app.modules.integrations.service import (
    LoadedConnection,
    load_connection,
    mark_connection_error,
)

__all__ = ["LoadedConnection", "load_connection", "mark_connection_error"]
