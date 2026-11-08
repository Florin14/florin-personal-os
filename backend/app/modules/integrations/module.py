from app.core.module import Module
from app.modules.integrations.router import router

module = Module(
    name="integrations",
    title="Integrations",
    description="Provider connections, encrypted credentials and health checks.",
    routers=(router,),
)
