from app.core.module import Module
from app.core.tasks import PeriodicTask
from app.modules.approvals.public import EVENT_DECIDED, EVENT_EXPIRED
from app.modules.automation.actions import BUILTIN_ACTIONS
from app.modules.automation.engine import RUN_JOB, run_execution_job
from app.modules.automation.router import controls_router, router
from app.modules.automation.service import fire_due_schedules, on_approval_event, on_domain_event

ON_APPROVAL_JOB = "automation.on_approval_event"
ON_EVENT_JOB = "automation.on_domain_event"

module = Module(
    name="automation",
    title="Automation",
    description="Versioned typed workflows with triggers, approvals and durable execution.",
    routers=(router, controls_router),
    job_handlers={
        RUN_JOB: run_execution_job,
        ON_APPROVAL_JOB: on_approval_event,
        ON_EVENT_JOB: on_domain_event,
    },
    event_subscriptions={
        EVENT_DECIDED: [ON_APPROVAL_JOB],
        EVENT_EXPIRED: [ON_APPROVAL_JOB],
        "*": [ON_EVENT_JOB],
    },
    periodic_tasks=(PeriodicTask("automation.fire_schedules", 15, fire_due_schedules),),
    actions=BUILTIN_ACTIONS,
)
