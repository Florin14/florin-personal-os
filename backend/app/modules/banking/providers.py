"""Future live bank access (ADR-021). Interface only — no provider is implemented.

A real implementation must come from a licensed Account Information Service Provider (PSD2 AISP)
with the user's explicit, revocable consent obtained on the provider's own pages. Personal OS must
never collect bank passwords, automate a banking website/app, or assume BT Go/BT Pay APIs.
Transactions returned by a provider go through the same fingerprinting and reconciliation as
CSV imports.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol

from app.modules.banking.parsers import ParsedRow


@dataclass(frozen=True, slots=True)
class ProviderAccount:
    provider_account_id: str
    name: str
    iban: str | None
    currency: str


class OpenBankingProvider(Protocol):
    """Read-only account information; payment initiation is deliberately out of scope."""

    name: str

    async def consent_url(self, workspace_id: str, redirect_uri: str) -> str:
        """Where the user grants access on the provider's site (never in Personal OS)."""
        ...

    async def list_accounts(self, consent_id: str) -> list[ProviderAccount]: ...

    async def list_transactions(
        self, consent_id: str, provider_account_id: str, since: date
    ) -> list[ParsedRow]: ...
