"""Deterministic reconciliation scoring (ADR-021). Pure functions: no I/O, no randomness.

score = exact amount (0.60) + date proximity (<= 0.20) + text evidence
        (invoice number 0.35, counterparty/vendor name 0.15), capped at 1.
A candidate needs an exact amount or some text evidence. Matching never crosses currencies.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.modules.banking.parsers import normalize

SUGGEST_THRESHOLD = Decimal("0.50")
AUTO_CONFIRM_THRESHOLD = Decimal("0.95")
MAX_SUGGESTIONS = 5

W_AMOUNT = Decimal("0.60")
W_NUMBER = Decimal("0.35")
W_NAME = Decimal("0.15")
DATE_STEPS: tuple[tuple[int, Decimal], ...] = (
    (0, Decimal("0.20")),
    (3, Decimal("0.15")),
    (7, Decimal("0.10")),
    (14, Decimal("0.05")),
)

# Legal-form and filler words that say nothing about who the counterparty is.
STOPWORDS = frozenset(
    {
        "srl",
        "sa",
        "sc",
        "srl-d",
        "pfa",
        "ii",
        "if",
        "ra",
        "ltd",
        "llc",
        "inc",
        "gmbh",
        "ag",
        "bv",
        "spa",
        "the",
        "and",
        "com",
        "www",
        "ro",
        "eu",
        "net",
        "org",
        "plata",
        "payment",
        "pos",
        "card",
        "transfer",
        "factura",
        "invoice",
        "comision",
        "taxa",
    }
)


@dataclass(frozen=True, slots=True)
class Candidate:
    target_type: str  # invoice | document | expense
    target_id: uuid.UUID
    when: date
    amount: Decimal  # positive
    currency: str
    label: str
    names: tuple[str, ...] = ()
    numbers: tuple[str, ...] = ()  # invoice numbers, e.g. ("FLZ 0042", "42")
    window_before: int = 45  # days the bank date may precede the target date
    window_after: int = 45  # days the bank date may follow it


@dataclass(frozen=True, slots=True)
class BankLine:
    when: date
    amount: Decimal  # positive magnitude
    currency: str
    text: str  # counterparty + description + reference


@dataclass(frozen=True, slots=True)
class Scored:
    candidate: Candidate
    confidence: Decimal
    rule: str
    reasons: tuple[str, ...]


def significant_tokens(value: str) -> set[str]:
    return {t for t in normalize(value).split() if len(t) >= 3 and t not in STOPWORDS}


def _date_score(days: int) -> tuple[Decimal, str | None]:
    for limit, weight in DATE_STEPS:
        if days <= limit:
            return weight, f"date_{limit}d"
    return Decimal(0), None


def _number_hit(numbers: tuple[str, ...], text_norm: str, tokens: set[str]) -> str | None:
    for number in numbers:
        wanted = normalize(number)
        if not wanted:
            continue
        compact = wanted.replace(" ", "")
        if " " in wanted and (wanted in text_norm or compact in text_norm.replace(" ", "")):
            return number
        digits = wanted.lstrip("0")
        # A bare number must be long enough not to collide with amounts/dates.
        if " " not in wanted and len(digits) >= 3 and digits in {t.lstrip("0") for t in tokens}:
            return number
    return None


def score(line: BankLine, candidate: Candidate) -> Scored | None:
    if candidate.currency != line.currency:
        return None
    offset = (line.when - candidate.when).days
    if offset < -candidate.window_before or offset > candidate.window_after:
        return None
    text_norm = normalize(line.text)
    tokens = set(text_norm.split())

    total = Decimal(0)
    parts: list[str] = []
    reasons: list[str] = []
    if line.amount == candidate.amount:
        total += W_AMOUNT
        parts.append("exact_amount")
        reasons.append(f"Amount {candidate.amount} {candidate.currency} matches exactly.")
    number = _number_hit(candidate.numbers, text_norm, tokens)
    if number:
        total += W_NUMBER
        parts.append("invoice_number")
        reasons.append(f"Bank text mentions {number}.")
    name_hit = next(
        (
            name
            for name in candidate.names
            if (wanted := significant_tokens(name)) and len(wanted & tokens) * 2 >= len(wanted)
        ),
        None,
    )
    if name_hit:
        total += W_NAME
        parts.append("name")
        reasons.append(f"Bank text mentions {name_hit}.")
    if not parts:
        return None  # neither the amount nor any text evidence: not a candidate
    weight, date_rule = _date_score(abs(offset))
    if date_rule:
        total += weight
        parts.append(date_rule)
    reasons.append(
        "Same day."
        if offset == 0
        else f"{abs(offset)} day(s) {'after' if offset > 0 else 'before'}."
    )
    return Scored(candidate, min(total, Decimal(1)), "+".join(parts), tuple(reasons))


def rank(line: BankLine, candidates: list[Candidate], include_weak: bool = False) -> list[Scored]:
    scored = [s for c in candidates if (s := score(line, c)) is not None]
    if not include_weak:
        scored = [s for s in scored if s.confidence >= SUGGEST_THRESHOLD]
    # Deterministic order: confidence, then closest date, then id.
    scored.sort(
        key=lambda s: (
            -s.confidence,
            abs((line.when - s.candidate.when).days),
            str(s.candidate.target_id),
        )
    )
    return scored


def auto_pick(ranked: list[Scored]) -> Scored | None:
    """The single unambiguous candidate at or above AUTO_CONFIRM_THRESHOLD, if any."""
    strong = [s for s in ranked if s.confidence >= SUGGEST_THRESHOLD]
    if len(strong) == 1 and strong[0].confidence >= AUTO_CONFIRM_THRESHOLD:
        return strong[0]
    return None
