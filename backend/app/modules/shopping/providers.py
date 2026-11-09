"""Where price observations come from (ADR-022).

Only manual entry exists. A future source must be compliant: authorized email-derived data,
documented public APIs or licensed feeds — never scraping, captcha or anti-bot circumvention, and
never assumptions about eMAG Marketplace seller APIs exposing consumer data. Sources that fetch
URLs must go through an SSRF-safe client (allowlisted hosts, no private ranges, no redirects to
internal addresses).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ObservedPrice:
    price: Decimal
    currency: str
    in_stock: bool | None
    observed_at: datetime


class PriceSource(Protocol):
    name: str

    async def observe(
        self, listing_url: str | None, external_ref: str | None
    ) -> ObservedPrice | None:
        """Current price for a listing, or None when the source has nothing new."""
        ...


class ManualSource:
    """Prices typed in by the user; never polls anything."""

    name = "manual"

    async def observe(
        self, listing_url: str | None, external_ref: str | None
    ) -> ObservedPrice | None:
        return None


SOURCES: dict[str, PriceSource] = {ManualSource.name: ManualSource()}
