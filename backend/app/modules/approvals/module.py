from app.core.module import Module
from app.core.tasks import PeriodicTask
from app.modules.approvals.router import router
from app.modules.approvals.service import expire_due_approvals

module = Module(
    name="approvals",
    title="Approvals",
    description="Risk-based approval requests bound to exact payloads and versions.",
    routers=(router,),
    periodic_tasks=(PeriodicTask("approvals.expire_due", 30, expire_due_approvals),),
)
