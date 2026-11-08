from app.core.module import Module
from app.modules.workspaces.router import router

module = Module(
    name="workspaces",
    title="Workspaces",
    description="Personal and business workspaces, memberships and roles.",
    routers=(router,),
)
