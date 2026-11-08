"""Typed automation actions.

Workflows can only invoke actions registered here by modules: there is no way
to run user-provided code, SQL, shell commands or arbitrary HTTP requests.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

if TYPE_CHECKING:
    from app.core.tasks import WorkerContext


class ActionRisk(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ActionError(Exception):
    """The action failed and must not be retried (the step fails)."""


class RetryableActionError(Exception):
    """A transient failure; the execution is retried from this step with backoff."""


@dataclass(frozen=True, slots=True)
class ActionContext:
    workspace_id: uuid.UUID
    execution_id: uuid.UUID
    step_key: str
    # Stable across retries of the same step: pass to providers that support idempotency.
    idempotency_key: str
    worker: WorkerContext


ActionHandler = Callable[[ActionContext, BaseModel], Awaitable[dict[str, Any]]]


async def _default_plan(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    return {"dry_run": True, "would_execute": params.model_dump(mode="json")}


@dataclass(frozen=True, slots=True)
class ActionDefinition:
    """A registered action type.

    * ``side_effecting`` actions are blocked by the emergency stop and skipped in dry-run
      (``plan`` is called instead).
    * ``risk`` >= ``approval_required_from`` (default: high) forces an approval step.
    """

    name: str
    title: str
    description: str
    params_model: type[BaseModel]
    handler: ActionHandler = field(repr=False)
    side_effecting: bool = True
    risk: ActionRisk = ActionRisk.LOW
    requires_approval: bool = False
    plan: ActionHandler = field(default=_default_plan, repr=False)

    def validate_params(self, params: Mapping[str, Any]) -> BaseModel:
        return self.params_model.model_validate(dict(params))


class ActionRegistry:
    def __init__(self, actions: Iterable[ActionDefinition] = ()) -> None:
        self._actions: dict[str, ActionDefinition] = {}
        for action in actions:
            if action.name in self._actions:
                raise RuntimeError(f"Duplicate action {action.name!r}")
            self._actions[action.name] = action

    def get(self, name: str) -> ActionDefinition | None:
        return self._actions.get(name)

    def all(self) -> list[ActionDefinition]:
        return sorted(self._actions.values(), key=lambda a: a.name)

    def __contains__(self, name: object) -> bool:
        return name in self._actions
