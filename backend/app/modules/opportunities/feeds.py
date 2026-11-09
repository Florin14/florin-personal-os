"""RSS 2.0 / RSS 1.0 (RDF) / Atom parsing with defusedxml (no entity expansion, no DTDs)."""

from __future__ import annotations

import hashlib
import html
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from xml.etree.ElementTree import Element

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import ParseError, fromstring

MAX_ITEMS = 200
MAX_TEXT = 20_000


class FeedError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class FeedItem:
    external_id: str
    title: str
    url: str | None
    description: str
    company: str
    posted_at: datetime | None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(element: Element, *names: str) -> Element | None:
    for child in element:
        if _local(child.tag) in names:
            return child
    return None


def _text(element: Element, *names: str) -> str:
    found = _child(element, *names)
    return "".join(found.itertext()).strip() if found is not None else ""


def html_to_text(value: str) -> str:
    """Plain text: tags dropped, entities decoded, whitespace collapsed (never shown as HTML)."""
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()[:MAX_TEXT]


def _date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _atom_link(entry: Element) -> str | None:
    for child in entry:
        if _local(child.tag) == "link" and child.get("rel", "alternate") == "alternate":
            return child.get("href")
    return None


def _http_url(value: str | None) -> str | None:
    """Only http(s) links are kept (no javascript:/data: URLs reach the UI)."""
    if value and re.match(r"^https?://", value.strip(), re.IGNORECASE):
        return value.strip()[:1000]
    return None


def parse_feed(content: bytes) -> list[FeedItem]:
    try:
        root = fromstring(content, forbid_dtd=True)
    except (ParseError, DefusedXmlException) as exc:
        raise FeedError("The document is not a valid RSS/Atom feed.") from exc
    kind = _local(root.tag)
    if kind in ("rss", "RDF"):
        entries = [e for e in root.iter() if _local(e.tag) == "item"]
    elif kind == "feed":
        entries = [e for e in root if _local(e.tag) == "entry"]
    else:
        raise FeedError("The document is not an RSS or Atom feed.")

    items: list[FeedItem] = []
    for entry in entries[:MAX_ITEMS]:
        title = html_to_text(_text(entry, "title"))[:300]
        if not title:
            continue
        if kind == "feed":
            url = _http_url(_atom_link(entry))
            body = _text(entry, "content") or _text(entry, "summary")
            when = _text(entry, "published") or _text(entry, "updated")
            author = _child(entry, "author")
            company = _text(author, "name") if author is not None else ""
            ident = _text(entry, "id")
        else:
            url = _http_url(_text(entry, "link"))
            body = _text(entry, "encoded") or _text(entry, "description")
            when = _text(entry, "pubDate") or _text(entry, "date")
            company = _text(entry, "creator") or _text(entry, "author")
            ident = _text(entry, "guid")
        external = (ident or url or hashlib.sha256(f"{title}|{body}".encode()).hexdigest())[:200]
        items.append(
            FeedItem(
                external_id=external,
                title=title,
                url=url,
                description=html_to_text(body),
                company=html_to_text(company)[:200],
                posted_at=_date(when),
            )
        )
    return items
