from app.core.module import Module
from app.core.tasks import PeriodicTask
from app.modules.jobs.router import router
from app.modules.jobs.service import purge_finished_jobs

module = Module(
    name="jobs",
    title="Jobs",
    description="Durable PostgreSQL-backed job queue with retries and failure inspection.",
    routers=(router,),
    periodic_tasks=(PeriodicTask("jobs.purge_finished", 6 * 3600, purge_finished_jobs),),
)
