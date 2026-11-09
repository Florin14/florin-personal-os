"""Public interface of the integrations module.

Adapters load their credentials with ``load_connection`` and flag revoked
credentials with ``mark_connection_error`` (affected workflows then fail safely).
"""

from app.modules.integrations.service import (
    LoadedConnection,
    connected_workspaces,
    current_config,
    is_connected,
    load_connection,
    mark_connection_error,
    remove_connection,
    upsert_connection,
)

__all__ = [
    "LoadedConnection",
    "connected_workspaces",
    "current_config",
    "is_connected",
    "load_connection",
    "mark_connection_error",
    "remove_connection",
    "upsert_connection",
]
