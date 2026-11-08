"""Public interface of the automation module.

Other modules contribute workflow capabilities by declaring ``ActionDefinition``s
(``app.core.actions``) on their Module; they do not call the engine directly.
"""

from app.modules.automation.engine import emergency_stop_active
from app.modules.automation.models import ExecutionStatus

__all__ = ["ExecutionStatus", "emergency_stop_active"]
