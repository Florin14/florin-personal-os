"""RFC 6238 TOTP helpers with replay protection support."""

from __future__ import annotations

import time

import pyotp

TOTP_INTERVAL_SECONDS = 30
TOTP_DIGITS = 6
# Accept one step of clock drift in each direction.
TOTP_VALID_WINDOW = 1


def generate_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, account_name: str, issuer: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=issuer)


def current_code(secret: str, at: float | None = None) -> str:
    return str(pyotp.TOTP(secret).at(int(at if at is not None else time.time())))


def matching_step(
    secret: str, code: str, last_used_step: int | None, at: float | None = None
) -> int | None:
    """Return the time step that ``code`` matches, or ``None``.

    A step that is not newer than ``last_used_step`` is rejected so a code
    cannot be replayed (including codes from earlier steps within the window).
    """
    if len(code) != TOTP_DIGITS or not code.isdigit():
        return None
    totp = pyotp.TOTP(secret)
    now = at if at is not None else time.time()
    current_step = int(now // TOTP_INTERVAL_SECONDS)
    for offset in range(-TOTP_VALID_WINDOW, TOTP_VALID_WINDOW + 1):
        step = current_step + offset
        if last_used_step is not None and step <= last_used_step:
            continue
        if pyotp.utils.strings_equal(str(totp.at(step * TOTP_INTERVAL_SECONDS)), code):
            return step
    return None
