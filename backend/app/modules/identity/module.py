from app.core.module import Module
from app.modules.identity.router import router

module = Module(
    name="identity",
    title="Identity & Authentication",
    description="Users, sessions, multi-factor authentication.",
    routers=(router,),
)
