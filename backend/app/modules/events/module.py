from app.core.module import Module
from app.core.tasks import PeriodicTask
from app.modules.events.router import router
from app.modules.events.service import purge_published_events

# The outbox relay itself is wired by the worker (it needs every module's subscriptions).
module = Module(
    name="events",
    title="Events",
    description="Domain events delivered at-least-once through a transactional outbox.",
    routers=(router,),
    periodic_tasks=(PeriodicTask("events.purge_published", 6 * 3600, purge_published_events),),
)
