"""Public interface of the approvals module.

Requesting (in your transaction)::

    approval = await ApprovalService(db).request(workspace_id=..., action_type="invoicing.issue",
        title=..., payload=exact_params, risk_level=RiskLevel.HIGH,
        subject_type="execution_step", subject_id=f"{execution_id}:{step}",
        version_ref=str(version_id), idempotency_key=f"execution:{execution_id}:{step}")

Before the side effect (same transaction as recording it)::

    await ApprovalService(db).consume_for_execution(approval.id, payload=exact_params,
                                                    version_ref=str(version_id))

Subscribe to ``approvals.decided`` / ``approvals.expired`` to resume work.
"""

from app.modules.approvals.models import ApprovalStatus, DecisionChannel, RiskLevel
from app.modules.approvals.service import (
    EVENT_DECIDED,
    EVENT_EXPIRED,
    EVENT_REQUESTED,
    ApprovalInvalid,
    ApprovalService,
    Decision,
    canonical_payload_hash,
)

__all__ = [
    "EVENT_DECIDED",
    "EVENT_EXPIRED",
    "EVENT_REQUESTED",
    "ApprovalInvalid",
    "ApprovalService",
    "ApprovalStatus",
    "Decision",
    "DecisionChannel",
    "RiskLevel",
    "canonical_payload_hash",
]
