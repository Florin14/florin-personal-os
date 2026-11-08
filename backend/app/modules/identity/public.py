"""Public interface of the identity module for other modules.

Other modules must import identity functionality only from here.
"""

from app.modules.identity.dependencies import (
    AdminUser,
    CurrentUser,
    IdentityServiceDep,
    require_admin,
    require_full_auth,
)
from app.modules.identity.service import AuthContext, IdentityService

__all__ = [
    "AdminUser",
    "AuthContext",
    "CurrentUser",
    "IdentityService",
    "IdentityServiceDep",
    "require_admin",
    "require_full_auth",
]
