"""Public interface of the events module.

Publish inside the transaction that changes state::

    EventPublisher(session).publish("approvals.decided", {"approval_id": str(a.id)},
                                    workspace_id=a.workspace_id)
    await session.commit()

Subscribe by declaring ``event_subscriptions={"approvals.decided": ["automation.resume"]}``
on your Module and registering a job handler for ``automation.resume`` that calls
``event_from_job(ctx)``. Delivery is at-least-once; handlers must be idempotent.
"""

from app.modules.events.service import DomainEvent, EventPublisher, event_from_job

__all__ = ["DomainEvent", "EventPublisher", "event_from_job"]
