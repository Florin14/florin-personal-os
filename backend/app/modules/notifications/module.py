from app.core.module import Module
from app.modules.notifications.router import router
from app.modules.notifications.service import DELIVER_JOB, ChannelAdapter, make_delivery_handler

# Populated by the worker composition root for configured integrations (ADR-016).
CHANNEL_ADAPTERS: dict[str, ChannelAdapter] = {}

module = Module(
    name="notifications",
    title="Notifications",
    description="In-app notification inbox and channel delivery with deduplication.",
    routers=(router,),
    job_handlers={DELIVER_JOB: make_delivery_handler(CHANNEL_ADAPTERS)},
)
