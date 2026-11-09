"""Deterministic, explainable opportunity scoring (ADR-024). Pure functions, no I/O."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal

ONSITE_MARKERS = ("on site", "onsite", "in office", "office based", "hybrid", "relocation")
REMOTE_MARKERS = ("remote", "work from home", "wfh", "anywhere", "distributed")
CURRENCY_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP", "lei": "RON"}
_RATE = re.compile(
    r"(?P<cur1>[$€£]|usd|eur|ron|gbp|lei)?\s*(?P<low>\d{1,4}(?:[.,]\d{1,2})?)"
    r"(?:\s*(?:-|\u2013|to)\s*(?P<cur2>[$€£])?\s*(?P<high>\d{1,4}(?:[.,]\d{1,2})?))?"
    r"\s*(?P<cur3>usd|eur|ron|gbp|lei)?\s*(?:/|per)\s*(?:h|hr|hour)\b",
    re.IGNORECASE,
)


def normalize(value: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9+#]+", " ", ascii_text.casefold()).strip()


def _contains(haystack: str, phrase: str) -> bool:
    needle = normalize(phrase)
    return bool(needle) and f" {needle} " in f" {haystack} "


@dataclass(frozen=True, slots=True)
class MatchProfile:
    skills: tuple[tuple[str, int], ...] = ()
    include: tuple[str, ...] = ()
    exclude: tuple[str, ...] = ()
    min_rate: Decimal | None = None
    currency: str = "EUR"
    remote_only: bool = True


@dataclass(frozen=True, slots=True)
class Match:
    score: int
    excluded: bool
    reasons: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class Rate:
    high: Decimal
    currency: str | None


def find_rate(text: str) -> Rate | None:
    """First hourly rate in the text, e.g. '$40-60/hr', '35 EUR per hour'."""
    found = _RATE.search(text)
    if not found:
        return None
    high = Decimal((found.group("high") or found.group("low")).replace(",", "."))
    code = found.group("cur1") or found.group("cur2") or found.group("cur3")
    currency = CURRENCY_SYMBOLS.get(code.lower(), code.upper()) if code else None
    return Rate(high, currency)


def score_listing(profile: MatchProfile, title: str, body: str, budget: str = "") -> Match:
    """0-100 with reasons. Exclusions always win; nothing here is learned or random."""
    title_n, body_n = normalize(title), normalize(f"{body} {budget}")
    everything = f"{title_n} {body_n}"
    for term in profile.exclude:
        if _contains(everything, term):
            return Match(0, True, [f"Excluded: mentions “{term}”."])

    possible = sum(2 * w for _, w in profile.skills) + len(profile.include)
    if possible == 0:
        return Match(0, False, ["Add skills to your profile to score listings."])

    points = 0
    reasons: list[str] = []
    for term, weight in sorted(profile.skills, key=lambda s: -s[1]):
        if _contains(title_n, term):
            points += 2 * weight
            reasons.append(f"Title mentions {term}.")
        elif _contains(body_n, term):
            points += weight
            reasons.append(f"Mentions {term}.")
    hits = [k for k in profile.include if _contains(everything, k)]
    points += len(hits)
    if hits:
        reasons.append("Keywords: " + ", ".join(hits) + ".")
    score = round(points * 100 / possible)

    if profile.remote_only:
        if any(_contains(everything, m) for m in REMOTE_MARKERS):
            reasons.append("Remote.")
        elif any(_contains(everything, m) for m in ONSITE_MARKERS):
            score //= 2
            reasons.append("Looks on-site or hybrid (score halved).")
    if profile.min_rate is not None:
        rate = find_rate(f"{budget} {body}")
        if rate and rate.currency in (None, profile.currency):
            if rate.high < profile.min_rate:
                score //= 2
                reasons.append(f"Rate up to {rate.high}/h is below your minimum (score halved).")
            else:
                reasons.append(f"Rate up to {rate.high}/h meets your minimum.")
    if not reasons:
        reasons.append("No profile terms found.")
    return Match(max(0, min(100, score)), False, reasons)
