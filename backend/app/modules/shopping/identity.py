"""Canonical product identity and input hygiene (pure functions, ADR-022)."""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlsplit


def normalize(value: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", ascii_text.casefold()).strip()


def valid_gtin(value: str) -> bool:
    """GTIN-8/12/13/14 (EAN/UPC) with a correct mod-10 check digit."""
    if not re.fullmatch(r"\d{8}|\d{12,14}", value):
        return False
    digits = [int(d) for d in value]
    body, check = digits[:-1], digits[-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def model_key(brand: str, model: str) -> str | None:
    """bm:<brand>|<model> when both are known; enforced unique on its own."""
    if normalize(brand) and normalize(model):
        return f"bm:{normalize(brand)}|{normalize(model)}"[:250]
    return None


def identity_key(name: str, brand: str, model: str, gtin: str | None) -> str:
    """Primary identity: gtin:<GTIN-14> > bm:<brand>|<model> > name:<normalized name>.

    A product with a GTIN *and* brand+model is protected by both keys (``model_key`` is stored
    and unique separately), so the same model cannot be tracked twice with and without a GTIN.
    """
    if gtin:
        return f"gtin:{gtin.zfill(14)}"
    return model_key(brand, model) or f"name:{normalize(name)}"[:250]


def clean_url(value: str | None) -> str | None:
    """http(s) URLs without embedded credentials; stored for display only (never fetched)."""
    if value is None or not value.strip():
        return None
    url = value.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("Use an http(s) link.")
    if parts.username or parts.password:
        raise ValueError("Links must not contain credentials.")
    if len(url) > 500:
        raise ValueError("Links are limited to 500 characters.")
    return url
