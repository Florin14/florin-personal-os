"""Home Assistant REST adapter (documented endpoints only) and a mock home (ADR-025).

Live endpoints (contributors.home-assistant.io/core/internals/rest-api):
``GET /api/`` → {"message": "API running."}; ``GET /api/states`` → [{entity_id, state, attributes,
last_changed, last_updated}]; ``POST /api/services/<domain>/<service>`` with the action data →
list of changed states. Auth: ``Authorization: Bearer <token>``.
"""

from __future__ import annotations

import copy
import re
from datetime import UTC, datetime
from typing import Any, Protocol

import httpx

from app.core.integrations import (
    ProviderError,
    ProviderErrorKind,
    http_client,
    normalize_http_error,
)

PROVIDER = "home_assistant"
_SLUG = re.compile(r"^[a-z_]+$")


class HomeAssistantApi(Protocol):
    async def ping(self) -> str: ...
    async def states(self) -> list[dict[str, Any]]: ...
    async def call_service(
        self, domain: str, service: str, data: dict[str, Any]
    ) -> list[dict[str, Any]]: ...


class LiveHomeAssistant:
    def __init__(self, base_url: str, token: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token

    async def _request(self, method: str, path: str, json: Any = None) -> Any:
        headers = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        try:
            async with http_client(self._base_url, timeout=15.0) as client:
                response = await client.request(method, path, json=json, headers=headers)
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            error = normalize_http_error(PROVIDER, exc)
            # A configured server can return arbitrary text, including echoed bearer tokens.
            raise ProviderError(
                PROVIDER, error.kind, f"request failed ({error.kind.value})"
            ) from None

    async def ping(self) -> str:
        body = await self._request("GET", "/api/")
        return str(body.get("message", "")) if isinstance(body, dict) else ""

    async def states(self) -> list[dict[str, Any]]:
        body = await self._request("GET", "/api/states")
        if not isinstance(body, list):
            raise ProviderError(PROVIDER, ProviderErrorKind.UNAVAILABLE, "unexpected states body")
        return [s for s in body if isinstance(s, dict) and isinstance(s.get("entity_id"), str)]

    async def call_service(
        self, domain: str, service: str, data: dict[str, Any]
    ) -> list[dict[str, Any]]:
        if not (_SLUG.fullmatch(domain) and _SLUG.fullmatch(service)):
            raise ProviderError(PROVIDER, ProviderErrorKind.INVALID_REQUEST, "invalid service")
        body = await self._request("POST", f"/api/services/{domain}/{service}", json=data)
        if not isinstance(body, list):
            raise ProviderError(
                PROVIDER, ProviderErrorKind.UNAVAILABLE, "unexpected service response"
            )
        return [s for s in body if isinstance(s, dict) and isinstance(s.get("entity_id"), str)]


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _entity(entity_id: str, state: str, **attributes: Any) -> dict[str, Any]:
    stamp = _now()
    return {
        "entity_id": entity_id,
        "state": state,
        "attributes": attributes,
        "last_changed": stamp,
        "last_updated": stamp,
    }


MOCK_HOME: list[dict[str, Any]] = [
    _entity("light.living_room", "off", friendly_name="Living room lamp", brightness=None),
    _entity("light.office_desk", "on", friendly_name="Office desk light", brightness=180),
    _entity("switch.coffee_machine", "off", friendly_name="Coffee machine"),
    _entity("fan.bedroom", "off", friendly_name="Bedroom fan"),
    _entity(
        "climate.living_room",
        "heat",
        friendly_name="Living room thermostat",
        current_temperature=21.5,
        temperature=22,
        hvac_modes=["off", "heat", "auto"],
    ),
    _entity("cover.garage_door", "closed", friendly_name="Garage door", device_class="garage"),
    _entity("cover.office_blinds", "open", friendly_name="Office blinds", device_class="blind"),
    _entity("lock.front_door", "locked", friendly_name="Front door"),
    _entity(
        "sensor.outdoor_temperature",
        "7.4",
        friendly_name="Outdoor temperature",
        unit_of_measurement="°C",
        device_class="temperature",
    ),
    _entity(
        "binary_sensor.front_door_contact",
        "off",
        friendly_name="Front door contact",
        device_class="door",
    ),
    _entity(
        "media_player.living_room_speaker",
        "idle",
        friendly_name="Living room speaker",
        volume_level=0.3,
    ),
]

_MOCK_TRANSITIONS: dict[str, str] = {
    "turn_on": "on",
    "turn_off": "off",
    "lock": "locked",
    "unlock": "unlocked",
    "open_cover": "open",
    "close_cover": "closed",
    "media_play": "playing",
    "media_pause": "paused",
}


class MockHomeAssistant:
    """Simulated home used when no Home Assistant is available (``mode=mock``).

    Stateless across processes: it is seeded from the devices already stored in the database
    (or the default home on first sync), so the API process and the worker agree on the state.
    """

    def __init__(self, seed: list[dict[str, Any]] | None) -> None:
        self._states = copy.deepcopy(seed) if seed else copy.deepcopy(MOCK_HOME)

    async def ping(self) -> str:
        return "API running. (mock)"

    async def states(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._states)

    async def call_service(
        self, domain: str, service: str, data: dict[str, Any]
    ) -> list[dict[str, Any]]:
        entity_id = data.get("entity_id")
        entity = next((s for s in self._states if s["entity_id"] == entity_id), None)
        if entity is None or not str(entity_id).startswith(f"{domain}."):
            raise ProviderError(
                PROVIDER, ProviderErrorKind.INVALID_REQUEST, "HTTP 400: unknown entity"
            )
        if service == "toggle":
            entity["state"] = "off" if entity["state"] == "on" else "on"
        elif service in _MOCK_TRANSITIONS:
            entity["state"] = _MOCK_TRANSITIONS[service]
        elif service == "set_temperature":
            entity["attributes"]["temperature"] = data.get("temperature")
        elif service == "set_hvac_mode":
            entity["state"] = str(data.get("hvac_mode"))
        elif service == "volume_set":
            entity["attributes"]["volume_level"] = data.get("volume_level")
        elif service == "stop_cover":
            pass
        elif service in {"alarm_arm_home", "alarm_arm_away"}:
            entity["state"] = "armed_home" if service == "alarm_arm_home" else "armed_away"
        else:
            raise ProviderError(
                PROVIDER, ProviderErrorKind.INVALID_REQUEST, "HTTP 400: unknown service"
            )
        if domain == "light" and service == "turn_on" and "brightness" in data:
            entity["attributes"]["brightness"] = data["brightness"]
        entity["last_changed"] = entity["last_updated"] = _now()
        return [copy.deepcopy(entity)]


def make_api(
    *, mode: str, base_url: str, token: str, mock_seed: list[dict[str, Any]] | None = None
) -> HomeAssistantApi:
    if mode == "mock":
        return MockHomeAssistant(mock_seed)
    return LiveHomeAssistant(base_url, token)
