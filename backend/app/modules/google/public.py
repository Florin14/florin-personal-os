"""Public interface of the Google module."""

from app.modules.google.client import CalendarEvent, GmailAttachment, GoogleApi
from app.modules.google.service import GoogleAccountConfig, google_api, google_connected

__all__ = [
    "CalendarEvent",
    "GmailAttachment",
    "GoogleAccountConfig",
    "GoogleApi",
    "google_api",
    "google_connected",
]
