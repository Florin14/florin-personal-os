from app.core.module import Module
from app.core.tasks import PeriodicTask
from app.modules.audit.router import router
from app.modules.audit.service import purge_expired_audit_records

module = Module(
    name="audit",
    title="Audit",
    description="Append-only audit records for security and business events.",
    routers=(router,),
    periodic_tasks=(PeriodicTask("audit.purge_expired", 24 * 3600, purge_expired_audit_records),),
)
