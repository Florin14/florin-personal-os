"""Descriptor that every domain module exposes to the composition root."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from fastapi import APIRouter

from app.core.actions import ActionDefinition, ActionRegistry
from app.core.integrations import IntegrationProvider
from app.core.tasks import JobHandler, PeriodicTask


@dataclass(frozen=True, slots=True)
class Module:
    """A self-contained domain module.

    ``name`` must equal the package name under ``app.modules``.

    * ``routers`` are mounted on the API application.
    * ``job_handlers`` map a job kind (``"<module>.<action>"``) to its handler.
    * ``event_subscriptions`` map a domain event type to job kinds that must
      run for it (each delivery becomes an idempotent job).
    * ``periodic_tasks`` run in the worker process.
    * ``actions`` are typed automation actions other modules' workflows may invoke.
      ``event_subscriptions`` may use ``"*"`` to receive every event.
    """

    name: str
    title: str
    description: str
    routers: Sequence[APIRouter] = field(default_factory=tuple)
    job_handlers: Mapping[str, JobHandler] = field(default_factory=dict)
    event_subscriptions: Mapping[str, Sequence[str]] = field(default_factory=dict)
    periodic_tasks: Sequence[PeriodicTask] = field(default_factory=tuple)
    actions: Sequence[ActionDefinition] = field(default_factory=tuple)
    integrations: Sequence[IntegrationProvider] = field(default_factory=tuple)


def build_action_registry(modules: Sequence[Module]) -> ActionRegistry:
    return ActionRegistry(action for module in modules for action in module.actions)
