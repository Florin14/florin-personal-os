"""SSRF-safe HTTPS fetching of user-provided feed URLs (ADR-024).

Policy: https only, default port, no credentials, every resolved address must be globally
routable (checked again on each redirect hop, max 3), 15 s timeout, 2 MB cap, XML content
types only, no proxies from the environment, generic User-Agent. Residual risk: DNS rebinding
between the check and the connection (documented in ADR-024).
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT = httpx.Timeout(15.0, connect=5.0)
USER_AGENT = "PersonalOS-FeedReader/1.0"
XML_TYPES = ("xml", "rss", "atom")
REDIRECT_CODES = frozenset({301, 302, 303, 307, 308})


class FetchRefused(Exception):
    """The URL or response violates the fetch policy."""


class FetchFailed(Exception):
    """A network/HTTP failure that may succeed later."""


@dataclass(frozen=True, slots=True)
class FetchResult:
    not_modified: bool
    content: bytes = b""
    etag: str | None = None
    last_modified: str | None = None


def validate_feed_url(url: str) -> str:
    """Static checks (no network): https, host, default port, no credentials."""
    value = url.strip()
    parts = urlsplit(value)
    if parts.scheme != "https":
        raise FetchRefused("Feed URLs must use https.")
    if not parts.hostname:
        raise FetchRefused("The feed URL has no host.")
    if parts.username or parts.password:
        raise FetchRefused("Feed URLs must not contain credentials.")
    if parts.port not in (None, 443):
        raise FetchRefused("Only the default https port is allowed.")
    try:
        ipaddress.ip_address(parts.hostname)
    except ValueError:
        pass
    else:
        raise FetchRefused("Use a host name, not an IP address.")
    host = parts.hostname.rstrip(".").lower()
    if (
        "." not in host
        or host.endswith((".localhost", ".local", ".internal"))
        or host == "localhost"
    ):
        raise FetchRefused("Use a public host name.")
    if len(value) > 500:
        raise FetchRefused("Feed URLs are limited to 500 characters.")
    return value


async def assert_public_url(url: str) -> None:
    """Save-time check: the host must currently resolve to public addresses only."""
    await _assert_public(urlsplit(validate_feed_url(url)).hostname or "")


async def _assert_public(host: str) -> None:
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise FetchFailed(f"Cannot resolve {host}.") from exc
    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise FetchFailed(f"Cannot resolve {host}.")
    for address in addresses:
        ip = ipaddress.ip_address(str(address).split("%")[0])  # drop IPv6 zone ids
        mapped = getattr(ip, "ipv4_mapped", None)
        if not (mapped or ip).is_global:
            raise FetchRefused(f"{host} resolves to a non-public address.")


async def fetch_feed(
    url: str, etag: str | None = None, last_modified: str | None = None
) -> FetchResult:
    current = validate_feed_url(url)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": (
            "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8"
        ),
    }
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    async with httpx.AsyncClient(
        timeout=TIMEOUT, follow_redirects=False, trust_env=False, headers=headers
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            host = urlsplit(current).hostname or ""
            await _assert_public(host)
            try:
                async with client.stream("GET", current) as response:
                    # 304 first: httpx's ``is_redirect`` is also true for 304 Not Modified.
                    if response.status_code == 304:
                        return FetchResult(
                            not_modified=True, etag=etag, last_modified=last_modified
                        )
                    if response.status_code in REDIRECT_CODES:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchFailed("Redirect without a location.")
                        current = validate_feed_url(urljoin(current, location))
                        continue
                    if response.status_code != 200:
                        raise FetchFailed(f"The feed answered HTTP {response.status_code}.")
                    content_type = response.headers.get("content-type", "").lower()
                    if not any(t in content_type for t in XML_TYPES):
                        raise FetchRefused("The URL did not return an RSS/Atom (XML) document.")
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_BYTES:
                            raise FetchRefused("The feed is larger than 2 MB.")
                    return FetchResult(
                        not_modified=False,
                        content=bytes(body),
                        etag=response.headers.get("etag"),
                        last_modified=response.headers.get("last-modified"),
                    )
            except httpx.TimeoutException as exc:
                raise FetchFailed("The feed did not answer in time.") from exc
            except httpx.HTTPError as exc:
                raise FetchFailed("The feed could not be reached.") from exc
    raise FetchRefused("Too many redirects.")
