"""Public interface of the opportunities module."""

from app.modules.opportunities.service import EVENT_MATCHED, OpportunityService

__all__ = ["EVENT_MATCHED", "OpportunityService"]
