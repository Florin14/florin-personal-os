from app.core.module import Module
from app.modules.audit.router import router

module = Module(
    name="audit",
    title="Audit",
    description="Append-only audit records for security and business events.",
    routers=(router,),
)
