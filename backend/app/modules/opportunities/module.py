from app.core.module import Module
from app.core.tasks import PeriodicTask
from app.modules.opportunities.router import router
from app.modules.opportunities.service import poll_due_feeds

module = Module(
    name="opportunities",
    title="Freelance & Career",
    description=(
        "Freelance opportunity discovery from manual entries and user-added RSS/Atom feeds "
        "(SSRF-safe), with deterministic, explainable matching and optional AI summaries."
    ),
    routers=(router,),
    periodic_tasks=(PeriodicTask("opportunities.poll_feeds", 300, poll_due_feeds),),
)
