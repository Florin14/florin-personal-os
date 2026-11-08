from app.core.module import Module
from app.modules.system.router import router

module = Module(
    name="system",
    title="System",
    description="Health, readiness and system information.",
    routers=(router,),
)
