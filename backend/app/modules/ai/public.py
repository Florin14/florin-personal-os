"""Public interface of the AI module (ADR-023).

    request = AiRequest(system=..., prompt=..., schema=Model.model_json_schema())
    result = await AiService(db, settings).run(
        workspace_id, "my.feature", request, Model, actor_user_id
    )

Register the feature in ``service.FEATURES`` first. Always keep a deterministic fallback:
``AiUnavailable`` (disabled / not consented / over budget) and ``AiFailed`` are normal outcomes.
"""

from app.modules.ai.providers import AiFailed, AiRequest, AiUnavailable
from app.modules.ai.service import AiService

__all__ = ["AiFailed", "AiRequest", "AiService", "AiUnavailable"]
