"""Public interface of the integrations module.

Adapters load their credentials with ``load_connection`` and flag revoked
credentials with ``mark_connection_error`` (affected workflows then fail safely).
"""

from app.modules.integrations.service import (
    LoadedConnection,
    is_connected,
    load_connection,
    mark_connection_error,
)

__all__ = ["LoadedConnection", "is_connected", "load_connection", "mark_connection_error"]
