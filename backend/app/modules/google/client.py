"""Google OAuth 2.0 + Calendar v3, Gmail v1 and Drive v3 adapters (and mocks).

Endpoints used (all documented by Google):
* Authorization: https://accounts.google.com/o/oauth2/v2/auth (code flow + PKCE,
  ``access_type=offline``); token: https://oauth2.googleapis.com/token;
  revoke: https://oauth2.googleapis.com/revoke; userinfo:
  https://openidconnect.googleapis.com/v1/userinfo
* Calendar: GET users/me/calendarList, GET/POST calendars/{id}/events, POST freeBusy
* Gmail: GET users/me/messages?q=, GET users/me/messages/{id},
  GET users/me/messages/{id}/attachments/{attachmentId}
* Drive: POST files (folders), GET files?q=, multipart upload
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import secrets
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx

from app.core.integrations import (
    ProviderError,
    ProviderErrorKind,
    http_client,
    normalize_http_error,
)

PROVIDER = "google"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 - URL, not a secret
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1"
DRIVE_BASE = "https://www.googleapis.com/drive/v3"
DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"

# Minimal scopes per feature (least privilege; users choose features at connect time).
FEATURE_SCOPES: dict[str, list[str]] = {
    "calendar": [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.freebusy",
    ],
    "gmail": ["https://www.googleapis.com/auth/gmail.readonly"],
    "drive": ["https://www.googleapis.com/auth/drive.file"],
}
BASE_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email"]


def scopes_for(features: list[str]) -> list[str]:
    scopes = list(BASE_SCOPES)
    for feature in features:
        scopes += FEATURE_SCOPES[feature]
    return scopes


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    return verifier, challenge.decode()


def authorization_url(
    client_id: str, redirect_uri: str, scopes: list[str], state: str, code_challenge: str
) -> str:
    query = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(scopes),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{AUTH_URL}?{urlencode(query)}"


@dataclass(frozen=True, slots=True)
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_at: float
    scopes: list[str]


async def _token_request(data: dict[str, str]) -> dict[str, Any]:
    try:
        async with http_client("https://oauth2.googleapis.com") as client:
            response = await client.post(TOKEN_URL, data=data)
    except httpx.HTTPError as exc:
        raise normalize_http_error(PROVIDER, exc) from exc
    body: dict[str, Any] = response.json() if response.content else {}
    if response.status_code >= 400:
        # invalid_grant = refresh token revoked/expired: the user must reconnect.
        kind = (
            ProviderErrorKind.AUTH
            if body.get("error") in ("invalid_grant", "unauthorized_client", "invalid_client")
            else ProviderErrorKind.UNAVAILABLE
            if response.status_code >= 500
            else ProviderErrorKind.INVALID_REQUEST
        )
        raise ProviderError(PROVIDER, kind, str(body.get("error", response.status_code)))
    return body


async def exchange_code(
    client_id: str, client_secret: str, redirect_uri: str, code: str, verifier: str
) -> TokenSet:
    body = await _token_request(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
    )
    return TokenSet(
        access_token=str(body["access_token"]),
        refresh_token=body.get("refresh_token"),
        expires_at=time.time() + float(body.get("expires_in", 3600)),
        scopes=str(body.get("scope", "")).split(),
    )


async def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> TokenSet:
    body = await _token_request(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    )
    return TokenSet(
        access_token=str(body["access_token"]),
        refresh_token=refresh_token,
        expires_at=time.time() + float(body.get("expires_in", 3600)),
        scopes=str(body.get("scope", "")).split(),
    )


async def revoke_token(token: str) -> None:
    try:
        async with http_client("https://oauth2.googleapis.com") as client:
            await client.post(REVOKE_URL, data={"token": token})
    except httpx.HTTPError:
        return  # best effort; local credentials are deleted regardless


async def fetch_email(access_token: str) -> str:
    async with http_client("https://openidconnect.googleapis.com") as client:
        response = await client.get(
            USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
        )
        response.raise_for_status()
        return str(response.json().get("email", ""))


# ---------------------------------------------------------------- API facade


@dataclass(frozen=True, slots=True)
class CalendarEvent:
    id: str
    summary: str
    start: str
    end: str
    all_day: bool
    html_link: str | None
    location: str | None


@dataclass(frozen=True, slots=True)
class GmailAttachment:
    message_id: str
    attachment_id: str
    filename: str
    mime_type: str
    subject: str
    sender: str
    received_at: str


class GoogleApi(Protocol):
    async def list_events(
        self, calendar_id: str, time_min: datetime, time_max: datetime
    ) -> list[CalendarEvent]: ...
    async def create_event(self, calendar_id: str, body: dict[str, Any]) -> CalendarEvent: ...
    async def free_busy(
        self, calendar_ids: list[str], time_min: datetime, time_max: datetime
    ) -> list[tuple[datetime, datetime]]: ...
    async def find_attachments(self, query: str, max_messages: int) -> list[GmailAttachment]: ...
    async def download_attachment(self, message_id: str, attachment_id: str) -> bytes: ...
    async def ensure_folder(self, path: list[str]) -> str: ...
    async def upload_file(
        self, folder_id: str, filename: str, mime_type: str, content: bytes
    ) -> str: ...


def _event(item: dict[str, Any]) -> CalendarEvent:
    start, end = item.get("start", {}), item.get("end", {})
    return CalendarEvent(
        id=str(item.get("id", "")),
        summary=str(item.get("summary", "(no title)")),
        start=str(start.get("dateTime") or start.get("date") or ""),
        end=str(end.get("dateTime") or end.get("date") or ""),
        all_day="date" in start,
        html_link=item.get("htmlLink"),
        location=item.get("location"),
    )


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


class LiveGoogleApi:
    """Calls Google APIs with a short-lived access token (refreshed by the caller)."""

    def __init__(self, access_token: str) -> None:
        self._headers = {"Authorization": f"Bearer {access_token}"}

    async def _call(
        self, method: str, url: str, *, params: Any = None, json_body: Any = None
    ) -> Any:
        try:
            async with http_client("https://www.googleapis.com") as client:
                response = await client.request(
                    method, url, params=params, json=json_body, headers=self._headers
                )
                response.raise_for_status()
                return response.json() if response.content else None
        except httpx.HTTPError as exc:
            raise normalize_http_error(PROVIDER, exc) from exc

    async def list_events(
        self, calendar_id: str, time_min: datetime, time_max: datetime
    ) -> list[CalendarEvent]:
        data = await self._call(
            "GET",
            f"{CALENDAR_BASE}/calendars/{calendar_id}/events",
            params={
                "timeMin": _iso(time_min),
                "timeMax": _iso(time_max),
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "250",
            },
        )
        return [_event(i) for i in (data or {}).get("items", [])]

    async def create_event(self, calendar_id: str, body: dict[str, Any]) -> CalendarEvent:
        data = await self._call(
            "POST", f"{CALENDAR_BASE}/calendars/{calendar_id}/events", json_body=body
        )
        return _event(data or {})

    async def free_busy(
        self, calendar_ids: list[str], time_min: datetime, time_max: datetime
    ) -> list[tuple[datetime, datetime]]:
        data = await self._call(
            "POST",
            f"{CALENDAR_BASE}/freeBusy",
            json_body={
                "timeMin": _iso(time_min),
                "timeMax": _iso(time_max),
                "items": [{"id": c} for c in calendar_ids],
            },
        )
        busy: list[tuple[datetime, datetime]] = []
        for calendar in ((data or {}).get("calendars") or {}).values():
            for slot in calendar.get("busy", []):
                busy.append(
                    (datetime.fromisoformat(slot["start"]), datetime.fromisoformat(slot["end"]))
                )
        return sorted(busy)

    async def find_attachments(self, query: str, max_messages: int) -> list[GmailAttachment]:
        listing = await self._call(
            "GET",
            f"{GMAIL_BASE}/users/me/messages",
            params={"q": query, "maxResults": str(max_messages)},
        )
        found: list[GmailAttachment] = []
        for ref in (listing or {}).get("messages", []):
            message = await self._call(
                "GET", f"{GMAIL_BASE}/users/me/messages/{ref['id']}", params={"format": "full"}
            )
            headers = {
                h["name"].lower(): h["value"]
                for h in (message or {}).get("payload", {}).get("headers", [])
            }
            for part in _walk_parts((message or {}).get("payload", {})):
                body = part.get("body", {})
                if part.get("filename") and body.get("attachmentId"):
                    found.append(
                        GmailAttachment(
                            message_id=str(ref["id"]),
                            attachment_id=str(body["attachmentId"]),
                            filename=str(part["filename"]),
                            mime_type=str(part.get("mimeType", "application/octet-stream")),
                            subject=headers.get("subject", ""),
                            sender=headers.get("from", ""),
                            received_at=str((message or {}).get("internalDate", "")),
                        )
                    )
        return found

    async def download_attachment(self, message_id: str, attachment_id: str) -> bytes:
        data = await self._call(
            "GET", f"{GMAIL_BASE}/users/me/messages/{message_id}/attachments/{attachment_id}"
        )
        raw = str((data or {}).get("data", ""))
        return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))

    async def ensure_folder(self, path: list[str]) -> str:
        parent = "root"
        for name in path:
            safe = name.replace("\\", "\\\\").replace("'", "\\'")
            listing = await self._call(
                "GET",
                f"{DRIVE_BASE}/files",
                params={
                    "q": (
                        f"name = '{safe}' and mimeType = 'application/vnd.google-apps.folder' "
                        f"and '{parent}' in parents and trashed = false"
                    ),
                    "fields": "files(id)",
                },
            )
            files = (listing or {}).get("files", [])
            if files:
                parent = str(files[0]["id"])
                continue
            created = await self._call(
                "POST",
                f"{DRIVE_BASE}/files",
                json_body={
                    "name": name,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [parent],
                },
            )
            parent = str((created or {})["id"])
        return parent

    async def upload_file(
        self, folder_id: str, filename: str, mime_type: str, content: bytes
    ) -> str:
        boundary = f"pos-{uuid.uuid4().hex}"
        metadata = json.dumps({"name": filename, "parents": [folder_id]}).encode()
        body = b"".join(
            [
                f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode(),
                metadata,
                f"\r\n--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n".encode(),
                content,
                f"\r\n--{boundary}--".encode(),
            ]
        )
        try:
            async with http_client("https://www.googleapis.com", timeout=60) as client:
                response = await client.post(
                    DRIVE_UPLOAD,
                    params={"uploadType": "multipart", "fields": "id"},
                    content=body,
                    headers={
                        **self._headers,
                        "Content-Type": f"multipart/related; boundary={boundary}",
                    },
                )
                response.raise_for_status()
                return str(response.json()["id"])
        except httpx.HTTPError as exc:
            raise normalize_http_error(PROVIDER, exc) from exc


def _walk_parts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    parts = [payload]
    for child in payload.get("parts", []) or []:
        parts += _walk_parts(child)
    return parts


@dataclass
class MockGoogleApi:
    """In-memory Google account for development without OAuth credentials."""

    events: list[CalendarEvent] = field(default_factory=list)
    drive: dict[str, bytes] = field(default_factory=dict)
    folders: dict[str, str] = field(default_factory=dict)

    async def list_events(
        self, calendar_id: str, time_min: datetime, time_max: datetime
    ) -> list[CalendarEvent]:
        if not self.events:
            base = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
            self.events = [
                CalendarEvent(
                    "mock-1",
                    "Client call (mock)",
                    _iso(base + timedelta(days=1, hours=2)),
                    _iso(base + timedelta(days=1, hours=3)),
                    False,
                    None,
                    "Online",
                ),
                CalendarEvent(
                    "mock-2",
                    "Accountant: monthly documents (mock)",
                    _iso(base + timedelta(days=3)),
                    _iso(base + timedelta(days=3, hours=1)),
                    False,
                    None,
                    None,
                ),
            ]
        return [e for e in self.events if _iso(time_min) <= e.start <= _iso(time_max)]

    async def create_event(self, calendar_id: str, body: dict[str, Any]) -> CalendarEvent:
        event = _event({**body, "id": f"mock-{uuid.uuid4().hex[:8]}"})
        self.events.append(event)
        return event

    async def free_busy(
        self, calendar_ids: list[str], time_min: datetime, time_max: datetime
    ) -> list[tuple[datetime, datetime]]:
        events = await self.list_events("primary", time_min, time_max)
        return sorted(
            (
                datetime.fromisoformat(e.start.replace("Z", "+00:00")),
                datetime.fromisoformat(e.end.replace("Z", "+00:00")),
            )
            for e in events
            if not e.all_day
        )

    async def find_attachments(self, query: str, max_messages: int) -> list[GmailAttachment]:
        return [
            GmailAttachment(
                "mock-msg-1",
                "mock-att-1",
                "factura-hosting-mock.pdf",
                "application/pdf",
                "Factura hosting (mock)",
                "billing@example.test",
                str(int(time.time() * 1000)),
            ),
        ][:max_messages]

    async def download_attachment(self, message_id: str, attachment_id: str) -> bytes:
        # A minimal valid PDF so the document pipeline (type sniffing, hashing) runs for real.
        return (
            b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
        )

    async def ensure_folder(self, path: list[str]) -> str:
        key = "/".join(path)
        return self.folders.setdefault(key, f"mock-folder-{len(self.folders) + 1}")

    async def upload_file(
        self, folder_id: str, filename: str, mime_type: str, content: bytes
    ) -> str:
        file_id = f"mock-file-{uuid.uuid4().hex[:8]}"
        self.drive[file_id] = content
        return file_id


_MOCKS: dict[str, MockGoogleApi] = {}
_ACCESS_CACHE: dict[str, tuple[str, float]] = {}
_LOCK = asyncio.Lock()


def mock_api(account: str) -> MockGoogleApi:
    return _MOCKS.setdefault(account, MockGoogleApi())


async def cached_access_token(
    cache_key: str, client_id: str, client_secret: str, refresh_token: str
) -> str:
    async with _LOCK:
        cached = _ACCESS_CACHE.get(cache_key)
        if cached and cached[1] > time.time() + 60:
            return cached[0]
        tokens = await refresh_access_token(client_id, client_secret, refresh_token)
        _ACCESS_CACHE[cache_key] = (tokens.access_token, tokens.expires_at)
        return tokens.access_token
