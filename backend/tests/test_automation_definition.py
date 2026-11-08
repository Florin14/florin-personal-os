"""Workflow definition validation, templating and condition tests (no database)."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from app.core.actions import ActionContext, ActionDefinition, ActionRegistry, ActionRisk
from app.core.errors import ValidationFailed
from app.modules.automation.actions import BUILTIN_ACTIONS
from app.modules.automation.definition import (
    Condition,
    Operator,
    WorkflowDefinition,
    evaluate,
    lookup,
    render,
)
from app.modules.automation.service import parse_definition


class HighParams(BaseModel):
    amount: str


async def _noop(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    return {}


REGISTRY = ActionRegistry(
    [
        *BUILTIN_ACTIONS,
        ActionDefinition(
            name="test.high",
            title="High",
            description="",
            params_model=HighParams,
            handler=_noop,
            risk=ActionRisk.HIGH,
            requires_approval=True,
        ),
    ]
)


def _steps(*steps: dict[str, Any]) -> dict[str, Any]:
    return {"steps": list(steps)}


LOG = {"key": "log", "type": "action", "action": "core.log", "params": {"message": "hi"}}


def test_minimal_definition_defaults_to_manual_trigger() -> None:
    definition = WorkflowDefinition.model_validate(_steps(LOG))
    assert definition.triggers[0].type == "manual"


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (_steps(LOG, LOG), "unique"),
        (_steps(LOG | {"next": "missing"}), "unknown step"),
        (
            _steps(
                {"key": "a", "type": "delay", "seconds": 5, "next": "b"},
                {"key": "b", "type": "delay", "seconds": 5, "next": "a"},
            ),
            "cycle",
        ),
        (
            {
                "triggers": [{"type": "event", "key": "e", "event_type": "automation.x"}],
                **_steps(LOG),
            },
            "loops",
        ),
        (
            {"triggers": [{"type": "cron", "key": "c", "expression": "61 * * * *"}], **_steps(LOG)},
            "cron",
        ),
        ({"triggers": [{"type": "interval", "key": "i", "seconds": 5}], **_steps(LOG)}, "60"),
        (_steps(LOG | {"key": "end"}), "reserved"),
        (_steps({"key": "x", "type": "shell", "command": "rm -rf /"}), "type"),
    ],
)
def test_invalid_definitions(raw: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        WorkflowDefinition.model_validate(raw)


def test_unknown_action_rejected() -> None:
    with pytest.raises(ValidationFailed, match="unknown action"):
        parse_definition(_steps({"key": "x", "type": "action", "action": "os.exec"}), REGISTRY)


def test_static_params_validated() -> None:
    with pytest.raises(ValidationFailed, match="invalid params"):
        parse_definition(_steps({"key": "x", "type": "action", "action": "core.log"}), REGISTRY)


def test_high_risk_action_needs_high_risk_approval() -> None:
    step = {"key": "x", "type": "action", "action": "test.high", "params": {"amount": "1"}}
    with pytest.raises(ValidationFailed, match="requires an approval"):
        parse_definition(_steps(step), REGISTRY)
    with pytest.raises(ValidationFailed, match="high-risk approval"):
        parse_definition(_steps(step | {"approval": {"risk_level": "medium"}}), REGISTRY)
    parse_definition(_steps(step | {"approval": {"risk_level": "high"}}), REGISTRY)


CONTEXT: dict[str, Any] = {
    "trigger": {"amount": "150.50", "customer": {"name": "ACME"}, "tags": ["vip"], "flag": True},
    "steps": {"prep": {"values": {"count": 3}}},
}


def test_render_preserves_types_for_lone_placeholders() -> None:
    assert render("{{ steps.prep.values.count }}", CONTEXT) == 3
    assert render("Hello {{ trigger.customer.name }}!", CONTEXT) == "Hello ACME!"
    assert render("{{ trigger.missing }}", CONTEXT) is None
    assert render({"a": ["{{ trigger.amount }}"]}, CONTEXT) == {"a": ["150.50"]}


def test_render_never_evaluates_code() -> None:
    assert render("{{ __import__('os') }}", CONTEXT) == "{{ __import__('os') }}"
    with pytest.raises(ValueError, match="Invalid reference"):
        lookup(CONTEXT, "settings.secret")


@pytest.mark.parametrize(
    ("left", "op", "right", "expected"),
    [
        ("trigger.amount", Operator.GT, "100", True),
        ("trigger.amount", Operator.LTE, 150.5, True),
        ("trigger.customer.name", Operator.EQ, "ACME", True),
        ("trigger.customer.name", Operator.NE, "ACME", False),
        ("trigger.tags", Operator.CONTAINS, "vip", True),
        ("trigger.customer.name", Operator.CONTAINS, "CM", True),
        ("trigger.missing", Operator.EXISTS, None, False),
        ("trigger.flag", Operator.EXISTS, None, True),
        ("trigger.customer.name", Operator.GT, "1", False),  # non-numeric fails closed
        ("trigger.flag", Operator.GT, "0", False),  # booleans are not numbers
        ("trigger.missing", Operator.EQ, None, False),
    ],
)
def test_conditions(left: str, op: Operator, right: Any, expected: bool) -> None:
    assert evaluate(Condition(left=left, op=op, right=right), CONTEXT) is expected
