"""Public interface of the workspaces module.

Future modules authorize workspace-scoped endpoints with::

    access: Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.MEMBER))]

and must filter every query by ``access.workspace_id``.
"""

from app.modules.workspaces.dependencies import require_workspace_access
from app.modules.workspaces.models import Role, WorkspaceKind
from app.modules.workspaces.service import WorkspaceAccess

__all__ = ["Role", "WorkspaceAccess", "WorkspaceKind", "require_workspace_access"]
