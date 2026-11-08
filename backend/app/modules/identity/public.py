"""Public interface of the identity module for other modules.

Other modules must import identity functionality only from here.
"""

from app.modules.identity.dependencies import CurrentUser, require_full_auth
from app.modules.identity.service import AuthContext

__all__ = ["AuthContext", "CurrentUser", "require_full_auth"]
