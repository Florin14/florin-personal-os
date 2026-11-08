"""Public interface of the notifications module."""

from app.modules.notifications.models import Channel, Notification, Severity
from app.modules.notifications.service import ChannelAdapter, NotificationService

__all__ = ["Channel", "ChannelAdapter", "Notification", "NotificationService", "Severity"]
