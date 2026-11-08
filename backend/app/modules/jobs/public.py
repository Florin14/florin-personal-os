"""Public interface of the jobs module.

Enqueue background work inside your own transaction::

    await JobQueue(session).enqueue("invoicing.issue", {"draft_id": ...},
                                    idempotency_key=f"invoice:{draft_id}")
    await session.commit()
"""

from app.modules.jobs.models import JobStatus
from app.modules.jobs.service import JobQueue, count_jobs

__all__ = ["JobQueue", "JobStatus", "count_jobs"]
