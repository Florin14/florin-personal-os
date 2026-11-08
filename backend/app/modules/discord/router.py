"""Discord interactions webhook.

This is the only endpoint meant to be reachable from the public internet
(Discord must call it). It is authenticated exclusively by the Ed25519
signature; it never uses or creates user sessions.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.dependencies import DbSession, SecretBoxDep, SettingsDep
from app.core.http import error_response
from app.core.integrations import ProviderError
from app.modules.discord.provider import load_discord, verify_signature
from app.modules.discord.service import InteractionHandler

router = APIRouter(prefix="/api/v1/integrations/discord", tags=["discord"])

MAX_BODY_BYTES = 64 * 1024


@router.post("/interactions", include_in_schema=False)
async def interactions(
    request: Request, db: DbSession, box: SecretBoxDep, settings: SettingsDep
) -> JSONResponse:
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        return error_response(413, "payload_too_large", "Payload too large.")
    try:
        loaded = await load_discord(db, box)
    except ProviderError:
        return error_response(404, "not_found", "Not found.")
    signature = request.headers.get("x-signature-ed25519", "")
    timestamp = request.headers.get("x-signature-timestamp", "")
    if not verify_signature(loaded.config.public_key, signature, timestamp, body):
        return error_response(401, "invalid_signature", "Invalid request signature.")
    try:
        interaction: Any = json.loads(body)
    except ValueError:
        return error_response(400, "bad_request", "Invalid JSON.")
    if not isinstance(interaction, dict):
        return error_response(400, "bad_request", "Invalid interaction.")
    handler = InteractionHandler(db, loaded.config, settings.public_app_url)
    return JSONResponse(await handler.handle(interaction))
