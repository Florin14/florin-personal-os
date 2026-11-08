"""Oblio REST API adapter (https://www.oblio.eu/api) and a mock implementation.

Only endpoints documented by Oblio are used:

* ``POST /authorize/token`` (form: client_id = account email, client_secret = API token)
* ``GET  /nomenclature/companies``, ``/nomenclature/series?cif=``
* ``POST /docs/invoice`` (JSON; supports ``idempotencyKey`` "to avoid duplication")
* ``GET  /docs/invoice?cif=&seriesName=&number=``
* ``POST /docs/einvoice`` (send to SPV; response ``code``: -1 not sent, 0 processing,
  1 sent, 2 sent with errors)

The API documentation does not specify what a repeated ``idempotencyKey``
returns, so Personal OS additionally keeps its own unique invoice record per
billing period and never re-issues an invoice it has recorded as issued.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Protocol

import httpx

from app.core.integrations import (
    ProviderError,
    ProviderErrorKind,
    http_client,
    normalize_http_error,
)

PROVIDER = "oblio"
BASE_URL = "https://www.oblio.eu/api"
_DECIMAL_MARK = re.compile(r'"__DEC__(-?[0-9]+(?:\.[0-9]+)?)__"')


def dumps_exact(payload: dict[str, Any]) -> bytes:
    """JSON with Decimals written as exact numeric literals (never via float)."""

    def default(value: object) -> str:
        if isinstance(value, Decimal):
            return f"__DEC__{value:f}__"
        raise TypeError(f"Cannot serialize {type(value).__name__}")

    return _DECIMAL_MARK.sub(r"\1", json.dumps(payload, default=default)).encode("utf-8")


@dataclass(frozen=True, slots=True)
class IssuedDocument:
    series_name: str
    number: str
    link: str | None


@dataclass(frozen=True, slots=True)
class EinvoiceResult:
    sent: bool
    code: int
    text: str


class OblioApi(Protocol):
    async def companies(self) -> list[dict[str, Any]]: ...
    async def series(self, cif: str) -> list[dict[str, Any]]: ...
    async def create_invoice(self, payload: dict[str, Any]) -> IssuedDocument: ...
    async def get_invoice(self, cif: str, series_name: str, number: str) -> dict[str, Any]: ...
    async def send_einvoice(self, cif: str, series_name: str, number: str) -> EinvoiceResult: ...


# Access tokens are cached per credential pair (hash only) inside the process.
_TOKEN_CACHE: dict[str, tuple[str, float]] = {}
_TOKEN_LOCK = asyncio.Lock()


class LiveOblioApi:
    def __init__(self, email: str, api_secret: str, *, base_url: str = BASE_URL) -> None:
        self._email = email
        self._secret = api_secret
        self._base_url = base_url
        self._cache_key = hashlib.sha256(f"{email}\0{api_secret}".encode()).hexdigest()

    async def _token(self, client: httpx.AsyncClient) -> str:
        async with _TOKEN_LOCK:
            cached = _TOKEN_CACHE.get(self._cache_key)
            if cached and cached[1] > time.monotonic() + 60:
                return cached[0]
            response = await client.post(
                "/authorize/token",
                data={"client_id": self._email, "client_secret": self._secret},
            )
            response.raise_for_status()
            body = response.json()
            token = str(body["access_token"])
            expires_in = float(body.get("expires_in") or 3600)
            _TOKEN_CACHE[self._cache_key] = (token, time.monotonic() + expires_in)
            return token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        try:
            async with http_client(self._base_url) as client:
                token = await self._token(client)
                headers = {"Authorization": f"Bearer {token}"}
                if json_body is not None:
                    headers["Content-Type"] = "application/json"
                response = await client.request(
                    method,
                    path,
                    params=params,
                    content=dumps_exact(json_body) if json_body is not None else None,
                    headers=headers,
                )
                if response.status_code == 401:
                    _TOKEN_CACHE.pop(self._cache_key, None)
                response.raise_for_status()
                body = response.json()
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise normalize_http_error(PROVIDER, exc) from exc
        if not isinstance(body, dict) or body.get("status") != 200:
            message = body.get("statusMessage") if isinstance(body, dict) else None
            raise ProviderError(
                PROVIDER, ProviderErrorKind.INVALID_REQUEST, str(message or "unexpected response")
            )
        return body.get("data")

    async def companies(self) -> list[dict[str, Any]]:
        data = await self._request("GET", "/nomenclature/companies")
        return list(data or [])

    async def series(self, cif: str) -> list[dict[str, Any]]:
        data = await self._request("GET", "/nomenclature/series", params={"cif": cif})
        return list(data or [])

    async def create_invoice(self, payload: dict[str, Any]) -> IssuedDocument:
        data = await self._request("POST", "/docs/invoice", json_body=payload)
        return IssuedDocument(
            series_name=str(data["seriesName"]),
            number=str(data["number"]),
            link=data.get("link"),
        )

    async def get_invoice(self, cif: str, series_name: str, number: str) -> dict[str, Any]:
        data = await self._request(
            "GET",
            "/docs/invoice",
            params={"cif": cif, "seriesName": series_name, "number": number},
        )
        return dict(data or {})

    async def send_einvoice(self, cif: str, series_name: str, number: str) -> EinvoiceResult:
        data = await self._request(
            "POST",
            "/docs/einvoice",
            json_body={"cif": cif, "seriesName": series_name, "number": number},
        )
        return EinvoiceResult(
            sent=bool(data.get("sent")),
            code=int(data.get("code", -1)),
            text=str(data.get("text", "")),
        )


@dataclass
class MockOblioApi:
    """Realistic in-memory Oblio used when no credentials are available (``mode=mock``).

    Mirrors the documented response shapes, numbers invoices sequentially per
    series, and honours ``idempotencyKey`` by returning the original document.
    """

    cif: str = "RO00000000"
    invoices: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    by_key: dict[str, IssuedDocument] = field(default_factory=dict)
    counters: dict[str, int] = field(default_factory=dict)

    async def companies(self) -> list[dict[str, Any]]:
        return [{"cif": self.cif, "company": "Mock SRL", "useStock": 0}]

    async def series(self, cif: str) -> list[dict[str, Any]]:
        return [{"type": "Factura", "name": "FCT", "start": "0001", "next": "0001", "default": 1}]

    async def create_invoice(self, payload: dict[str, Any]) -> IssuedDocument:
        for required in ("cif", "client", "seriesName", "products"):
            if not payload.get(required):
                raise ProviderError(
                    PROVIDER, ProviderErrorKind.INVALID_REQUEST, f"{required} is required"
                )
        key = payload.get("idempotencyKey")
        if key and key in self.by_key:
            return self.by_key[key]
        series = str(payload["seriesName"])
        self.counters[series] = self.counters.get(series, 0) + 1
        number = f"{self.counters[series]:04d}"
        document = IssuedDocument(
            series_name=series,
            number=number,
            link=f"https://mock.oblio.local/show_file/{series}-{number}",
        )
        self.invoices[(series, number)] = {"payload": payload, "einvoice": -1}
        if key:
            self.by_key[key] = document
        return document

    async def get_invoice(self, cif: str, series_name: str, number: str) -> dict[str, Any]:
        if (series_name, number) not in self.invoices:
            raise ProviderError(PROVIDER, ProviderErrorKind.INVALID_REQUEST, "document not found")
        return {
            "documentType": "Factura",
            "seriesName": series_name,
            "number": number,
            "link": f"https://mock.oblio.local/show_file/{series_name}-{number}",
            "collects": [],
        }

    async def send_einvoice(self, cif: str, series_name: str, number: str) -> EinvoiceResult:
        document = self.invoices.get((series_name, number))
        if document is None:
            raise ProviderError(PROVIDER, ProviderErrorKind.INVALID_REQUEST, "document not found")
        document["einvoice"] = 1
        return EinvoiceResult(sent=True, code=1, text="Factura a fost trimisa in SPV (mock)")


# One mock instance per CIF so numbering and idempotency persist within a process.
_MOCKS: dict[str, MockOblioApi] = {}


def make_api(*, mode: str, cif: str, email: str, api_secret: str) -> OblioApi:
    if mode == "mock":
        return _MOCKS.setdefault(cif, MockOblioApi(cif=cif))
    return LiveOblioApi(email, api_secret)
