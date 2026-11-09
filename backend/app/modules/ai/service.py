"""AI gatekeeper: provider, consent, budget, redaction, validation and usage (ADR-023).

Callers get either a validated Pydantic object or an exception; they must always have a
deterministic fallback. ``run`` commits the usage record, so call it before staging other changes.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.db import utcnow
from app.core.errors import ValidationFailed
from app.modules.ai.models import AiUsage, AiWorkspaceSettings
from app.modules.ai.providers import (
    AiFailed,
    AiProvider,
    AiRequest,
    AiUnavailable,
    provider_for,
)
from app.modules.audit.public import AuditRecorder

T = TypeVar("T", bound=BaseModel)


@dataclass(frozen=True, slots=True)
class AiFeature:
    key: str
    title: str
    description: str
    data_sent: str  # shown to admins before they consent


FEATURES: dict[str, AiFeature] = {
    f.key: f
    for f in (
        AiFeature(
            "opportunities.summary",
            "Freelance listing summaries",
            "Summarizes a listing and explains how it fits your profile. Never changes the score.",
            "The listing's title and text, and your skills/keywords (redacted).",
        ),
    )
}

COUNTED = ("ok", "error", "invalid_output")

_REDACTIONS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b"), "[iban]"),
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[email]"),
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "[number]"),
    (re.compile(r"\+?\d[\d\s().-]{7,}\d"), "[phone]"),
)


def redact(text: str) -> str:
    """Removes personal/financial identifiers before text leaves the process."""
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


class AiService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        provider: AiProvider | None = None,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self._db = session
        self._settings = settings
        self._provider = provider or provider_for(settings)
        self._now = clock

    @property
    def available(self) -> bool:
        return self._provider.name != "disabled"

    async def enabled_features(self, workspace_id: uuid.UUID) -> list[str]:
        row = await self._db.get(AiWorkspaceSettings, workspace_id)
        return [k for k in (row.enabled_features if row else []) if k in FEATURES]

    async def set_features(
        self, workspace_id: uuid.UUID, keys: list[str], actor_user_id: uuid.UUID
    ) -> list[str]:
        unknown = [k for k in keys if k not in FEATURES]
        if unknown:
            raise ValidationFailed(f"Unknown AI feature(s): {', '.join(unknown)}.")
        row = await self._db.get(AiWorkspaceSettings, workspace_id)
        if row is None:
            row = AiWorkspaceSettings(workspace_id=workspace_id)
            self._db.add(row)
        row.enabled_features = sorted(set(keys))
        row.updated_by_user_id = actor_user_id
        AuditRecorder(self._db).record(
            "ai.features_changed",
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type="workspace",
            target_id=workspace_id,
            details={"enabled": row.enabled_features},
        )
        await self._db.commit()
        return row.enabled_features

    def _month_start(self) -> datetime:
        now = self._now().astimezone(UTC)
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    async def used_this_month(self, workspace_id: uuid.UUID) -> int:
        return int(
            await self._db.scalar(
                select(func.count())
                .select_from(AiUsage)
                .where(
                    AiUsage.workspace_id == workspace_id,
                    AiUsage.created_at >= self._month_start(),
                    AiUsage.outcome.in_(COUNTED),
                )
            )
            or 0
        )

    async def recent_usage(self, workspace_id: uuid.UUID, limit: int = 50) -> list[AiUsage]:
        return list(
            await self._db.scalars(
                select(AiUsage)
                .where(AiUsage.workspace_id == workspace_id)
                .order_by(AiUsage.created_at.desc())
                .limit(limit)
            )
        )

    async def _record(
        self,
        workspace_id: uuid.UUID,
        feature: str,
        outcome: str,
        actor_user_id: uuid.UUID | None,
        **values: Any,
    ) -> None:
        self._db.add(
            AiUsage(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                feature=feature,
                provider=self._provider.name,
                model=self._provider.model,
                outcome=outcome,
                actor_user_id=actor_user_id,
                created_at=self._now(),
                **values,
            )
        )
        await self._db.commit()

    async def run(
        self,
        workspace_id: uuid.UUID,
        feature: str,
        request: AiRequest,
        output_model: type[T],
        actor_user_id: uuid.UUID | None,
    ) -> T:
        if feature not in FEATURES:
            raise ValueError(f"unregistered AI feature {feature!r}")
        if not self.available:
            await self._record(workspace_id, feature, "disabled", actor_user_id)
            raise AiUnavailable("AI is disabled on this server.")
        if feature not in await self.enabled_features(workspace_id):
            await self._record(workspace_id, feature, "not_consented", actor_user_id)
            raise AiUnavailable("This AI feature is not enabled for the workspace.")
        if await self.used_this_month(workspace_id) >= self._settings.ai_monthly_request_budget:
            await self._record(workspace_id, feature, "over_budget", actor_user_id)
            raise AiUnavailable("The monthly AI budget for this workspace is used up.")

        safe = AiRequest(
            system=request.system,
            prompt=redact(request.prompt),
            schema=request.schema,
            max_output_tokens=request.max_output_tokens,
        )
        try:
            result = await self._provider.complete(safe)
        except AiFailed as exc:
            await self._record(workspace_id, feature, "error", actor_user_id, error=str(exc)[:300])
            raise
        usage = {
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "duration_ms": result.duration_ms,
        }
        try:
            parsed = output_model.model_validate_json(result.content)
        except ValidationError as exc:
            await self._record(
                workspace_id,
                feature,
                "invalid_output",
                actor_user_id,
                error="Output did not match the schema.",
                **usage,
            )
            raise AiFailed("The model's answer did not match the expected format.") from exc
        await self._record(workspace_id, feature, "ok", actor_user_id, **usage)
        return parsed
