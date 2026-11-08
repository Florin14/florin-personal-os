"""Workflow definition schema, validation, templating and conditions.

Definitions are data, never code. Templates only substitute values from the
execution context (``{{ trigger.amount }}``); conditions compare values with a
fixed set of operators.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cronsim import CronSim, CronSimError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.actions import ActionRegistry, ActionRisk

KEY_PATTERN = r"^[a-z][a-z0-9_]{0,49}$"
END = "end"
MAX_STEPS = 50
MAX_TEMPLATE_LENGTH = 4000
_TEMPLATE = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")
_PATH = re.compile(r"^(trigger|steps|execution)(\.[a-zA-Z0-9_]+)*$")

StepKey = Annotated[str, Field(pattern=KEY_PATTERN)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# ----------------------------------------------------------------- triggers


class ManualTrigger(_Strict):
    type: Literal["manual"] = "manual"
    key: StepKey = "manual"


class CronTrigger(_Strict):
    type: Literal["cron"] = "cron"
    key: StepKey
    expression: str = Field(max_length=100)
    timezone: str = "Europe/Bucharest"

    @field_validator("expression")
    @classmethod
    def _valid_cron(cls, value: str) -> str:
        from datetime import UTC, datetime

        try:
            CronSim(value, datetime.now(UTC))
        except CronSimError as exc:
            raise ValueError(f"Invalid cron expression: {exc}") from exc
        return value

    @field_validator("timezone")
    @classmethod
    def _valid_tz(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"Unknown timezone {value!r}") from exc
        return value


class IntervalTrigger(_Strict):
    type: Literal["interval"] = "interval"
    key: StepKey
    seconds: int = Field(ge=60, le=31 * 24 * 3600)


class EventTrigger(_Strict):
    type: Literal["event"] = "event"
    key: StepKey
    event_type: str = Field(pattern=r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$", max_length=100)

    @field_validator("event_type")
    @classmethod
    def _no_self_triggering(cls, value: str) -> str:
        if value.startswith("automation."):
            raise ValueError("Automations cannot be triggered by automation events (loops).")
        return value


Trigger = Annotated[
    ManualTrigger | CronTrigger | IntervalTrigger | EventTrigger, Field(discriminator="type")
]

# -------------------------------------------------------------------- steps


class Operator(StrEnum):
    EQ = "eq"
    NE = "ne"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    CONTAINS = "contains"
    EXISTS = "exists"


class Condition(_Strict):
    left: str = Field(max_length=200)
    op: Operator
    right: Any = None


class _StepBase(_Strict):
    key: StepKey
    title: str = Field(default="", max_length=200)
    # Explicit successor; defaults to the next step in the list.
    next: str | None = None


class ConditionStep(_StepBase):
    type: Literal["condition"] = "condition"
    conditions: list[Condition] = Field(min_length=1, max_length=20)
    mode: Literal["all", "any"] = "all"
    on_true: str | None = None
    on_false: str = END


class DelayStep(_StepBase):
    type: Literal["delay"] = "delay"
    seconds: int = Field(ge=1, le=30 * 24 * 3600)


class NotifyStep(_StepBase):
    type: Literal["notify"] = "notify"
    message_title: str = Field(max_length=200)
    message_body: str = Field(default="", max_length=MAX_TEMPLATE_LENGTH)
    severity: Literal["info", "success", "warning", "error"] = "info"


class ApprovalConfig(_Strict):
    risk_level: Literal["low", "medium", "high"] = "medium"
    title: str = Field(default="", max_length=200)
    summary: str = Field(default="", max_length=MAX_TEMPLATE_LENGTH)
    expires_in_minutes: int = Field(default=24 * 60, ge=1, le=30 * 24 * 60)


class ApprovalStep(_StepBase):
    """A human checkpoint that is not tied to a specific action."""

    type: Literal["approval"] = "approval"
    approval: ApprovalConfig = ApprovalConfig()


class ActionStep(_StepBase):
    type: Literal["action"] = "action"
    action: str = Field(max_length=100)
    params: dict[str, Any] = Field(default_factory=dict)
    approval: ApprovalConfig | None = None


Step = Annotated[
    ConditionStep | DelayStep | NotifyStep | ApprovalStep | ActionStep,
    Field(discriminator="type"),
]


def _default_triggers() -> list[Trigger]:
    return [ManualTrigger()]


class WorkflowDefinition(_Strict):
    schema_version: Literal[1] = 1
    triggers: list[Trigger] = Field(default_factory=_default_triggers, max_length=10)
    steps: list[Step] = Field(min_length=1, max_length=MAX_STEPS)

    @model_validator(mode="after")
    def _validate_graph(self) -> WorkflowDefinition:
        keys = [s.key for s in self.steps]
        if len(set(keys)) != len(keys):
            raise ValueError("Step keys must be unique.")
        if END in keys:
            raise ValueError(f"'{END}' is reserved.")
        trigger_keys = [t.key for t in self.triggers]
        if len(set(trigger_keys)) != len(trigger_keys):
            raise ValueError("Trigger keys must be unique.")
        valid_targets = set(keys) | {END}
        for step in self.steps:
            for target in successors(self, step.key):
                if target not in valid_targets:
                    raise ValueError(f"Step {step.key!r} points to unknown step {target!r}.")
        _assert_acyclic(self)
        return self

    def step(self, key: str) -> Step | None:
        return next((s for s in self.steps if s.key == key), None)


def default_next(definition: WorkflowDefinition, key: str) -> str:
    keys = [s.key for s in definition.steps]
    index = keys.index(key)
    return keys[index + 1] if index + 1 < len(keys) else END


def successors(definition: WorkflowDefinition, key: str) -> list[str]:
    step = definition.step(key)
    assert step is not None
    plain_next = step.next or default_next(definition, key)
    if isinstance(step, ConditionStep):
        return [step.on_true or plain_next, step.on_false]
    return [plain_next]


def _assert_acyclic(definition: WorkflowDefinition) -> None:
    """Workflows are DAGs: loops could run forever or repeat side effects."""
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(key: str) -> None:
        if key == END or key in done:
            return
        if key in visiting:
            raise ValueError(f"Workflow contains a cycle at step {key!r}.")
        visiting.add(key)
        for target in successors(definition, key):
            visit(target)
        visiting.discard(key)
        done.add(key)

    for step in definition.steps:
        visit(step.key)


def validate_actions(definition: WorkflowDefinition, registry: ActionRegistry) -> list[str]:
    """Errors for unknown actions or invalid static params (templates are checked at runtime)."""
    errors: list[str] = []
    for step in definition.steps:
        if not isinstance(step, ActionStep):
            continue
        action = registry.get(step.action)
        if action is None:
            errors.append(f"Step {step.key!r}: unknown action {step.action!r}.")
            continue
        if action.requires_approval and step.approval is None:
            errors.append(f"Step {step.key!r}: action {step.action!r} requires an approval.")
        if (
            step.approval is not None
            and action.risk is ActionRisk.HIGH
            and step.approval.risk_level != "high"
        ):
            errors.append(f"Step {step.key!r}: high-risk action needs a high-risk approval.")
        if not contains_template(step.params):
            try:
                action.validate_params(step.params)
            except ValueError as exc:
                errors.append(f"Step {step.key!r}: invalid params: {exc}")
    return errors


# ------------------------------------------------------- templates & values


def contains_template(value: Any) -> bool:
    if isinstance(value, str):
        return bool(_TEMPLATE.search(value))
    if isinstance(value, dict):
        return any(contains_template(v) for v in value.values())
    if isinstance(value, list):
        return any(contains_template(v) for v in value)
    return False


_MISSING = object()


def lookup(context: dict[str, Any], path: str) -> Any:
    if not _PATH.match(path):
        raise ValueError(f"Invalid reference {path!r}")
    current: Any = context
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return _MISSING
    return current


def render(value: Any, context: dict[str, Any]) -> Any:
    """Substitute ``{{ path }}`` references. A lone placeholder keeps the value's type."""
    if isinstance(value, dict):
        return {k: render(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, context) for v in value]
    if not isinstance(value, str):
        return value
    whole = _TEMPLATE.fullmatch(value.strip())
    if whole:
        found = lookup(context, whole.group(1))
        return None if found is _MISSING else found

    def substitute(match: re.Match[str]) -> str:
        found = lookup(context, match.group(1))
        return "" if found is _MISSING or found is None else str(found)

    return _TEMPLATE.sub(substitute, value)[:MAX_TEMPLATE_LENGTH]


def _as_number(value: Any) -> Decimal | None:
    if isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def evaluate(condition: Condition, context: dict[str, Any]) -> bool:
    left = lookup(context, condition.left)
    right = render(condition.right, context)
    if condition.op is Operator.EXISTS:
        return left is not _MISSING and left is not None
    if left is _MISSING:
        return False
    if condition.op is Operator.EQ:
        return bool(left == right)
    if condition.op is Operator.NE:
        return bool(left != right)
    if condition.op is Operator.CONTAINS:
        if isinstance(left, str) and isinstance(right, str):
            return right in left
        if isinstance(left, list):
            return right in left
        return False
    # Numeric comparisons use Decimal (never float) and fail closed on non-numbers.
    a, b = _as_number(left), _as_number(right)
    if a is None or b is None:
        return False
    return {
        Operator.GT: a > b,
        Operator.GTE: a >= b,
        Operator.LT: a < b,
        Operator.LTE: a <= b,
    }[condition.op]


def evaluate_all(step: ConditionStep, context: dict[str, Any]) -> bool:
    results = (evaluate(c, context) for c in step.conditions)
    return all(results) if step.mode == "all" else any(results)
