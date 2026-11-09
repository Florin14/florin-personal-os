"""Fixed service/parameter allowlists; no arbitrary Home Assistant action data."""

from __future__ import annotations

import math
from typing import Any

from app.modules.smarthome.models import HomeDevice

SERVICES: dict[str, tuple[str, ...]] = {
    "light": ("turn_on", "turn_off"),
    "switch": ("turn_on", "turn_off"),
    "fan": ("turn_on", "turn_off"),
    "climate": ("set_temperature", "set_hvac_mode"),
    "cover": ("open_cover", "close_cover", "stop_cover"),
    "lock": ("lock", "unlock"),
    "media_player": ("media_play", "media_pause", "volume_set"),
    "alarm_control_panel": ("alarm_arm_home", "alarm_arm_away"),
}
SUPPORTED_DOMAINS = frozenset(SERVICES) | {"sensor", "binary_sensor"}
ENVIRONMENTAL_SENSOR_CLASSES = frozenset(
    {
        "temperature",
        "humidity",
        "illuminance",
        "power",
        "energy",
        "battery",
    }
)


def sensitive(device: HomeDevice, service: str) -> bool:
    return (
        (device.domain == "lock" and service == "unlock")
        or (device.domain == "alarm_control_panel")
        or (
            device.domain == "cover"
            and service == "open_cover"
            and device.attributes.get("device_class")
            not in {
                "awning",
                "blind",
                "curtain",
                "shade",
                "shutter",
            }
        )
    )


def validate_data(device: HomeDevice, service: str, data: dict[str, Any]) -> str | None:
    if service not in SERVICES.get(device.domain, ()):
        return "This service is not allowed for this device."
    fields: dict[str, tuple[float, float]] = {}
    if service == "set_temperature":
        fields = {"temperature": (5, 35)}
    elif service == "volume_set":
        fields = {"volume_level": (0, 1)}
    elif device.domain == "light" and service == "turn_on":
        fields = {"brightness": (0, 255)}
    if service == "set_hvac_mode":
        modes = device.attributes.get("hvac_modes", [])
        if not isinstance(modes, list):
            modes = []
        if set(data) != {"hvac_mode"} or data["hvac_mode"] not in modes:
            return "Choose one of the device's supported HVAC modes."
        return None
    if set(data) - set(fields):
        return "Unexpected service parameters (entity targets are chosen by the server)."
    for key, (minimum, maximum) in fields.items():
        value = data.get(key)
        if key not in data and key == "brightness":
            continue
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or (isinstance(value, float) and not math.isfinite(value))
            or not minimum <= value <= maximum
            or (key == "brightness" and not isinstance(value, int))
        ):
            return f"{key} must be between {minimum:g} and {maximum:g}."
    return None
