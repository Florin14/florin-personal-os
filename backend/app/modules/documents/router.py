"""Document endpoints and Google-backed document actions."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.actions import (
    ActionContext,
    ActionDefinition,
    ActionError,
    ActionRisk,
    RetryableActionError,
)
from app.core.config import Settings
from app.core.dependencies import DbSession
from app.core.errors import DomainError
from app.core.http import ERROR_RESPONSES
from app.core.integrations import ProviderError
from app.modules.documents.service import (
    MAX_DOCUMENT_BYTES,
    Document,
    DocumentService,
    DocumentStatus,
    LocalStorage,
)
from app.modules.google.public import google_api
from app.modules.identity.public import CurrentUser
from app.modules.workspaces.public import Role, WorkspaceAccess, require_workspace_access

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}", tags=["documents"], responses=ERROR_RESPONSES
)
Viewer = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.VIEWER))]
Member = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.MEMBER))]
Admin = Annotated[WorkspaceAccess, Depends(require_workspace_access(Role.ADMIN))]
Category = Literal["invoice", "receipt", "statement", "contract", "other"]


def storage_for(settings: Settings) -> LocalStorage:
    return LocalStorage(settings.documents_dir)


def service(request: Request, db: DbSession) -> DocumentService:
    return DocumentService(db, storage_for(request.app.state.settings))


ServiceDep = Annotated[DocumentService, Depends(service)]


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    filename: str
    mime_type: str
    size_bytes: int
    source: str
    category: Category
    status: DocumentStatus
    document_date: date | None
    vendor: str | None
    amount: Decimal | None
    currency: str | None
    notes: str
    drive_file_id: str | None
    created_at: datetime


class DocumentUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: Category | None = None
    status: DocumentStatus | None = None
    document_date: date | None = None
    vendor: str | None = Field(default=None, max_length=200)
    amount: Annotated[Decimal, Field(ge=0, max_digits=18, decimal_places=2)] | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    notes: str | None = Field(default=None, max_length=4000)


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(
    access: Viewer,
    docs: ServiceDep,
    category: Category | None = None,
    status_filter: Annotated[DocumentStatus | None, Query(alias="status")] = None,
) -> list[DocumentOut]:
    items = await docs.list_documents(
        access.workspace_id,
        category=category,
        status=status_filter.value if status_filter else None,
    )
    return [DocumentOut.model_validate(d) for d in items]


@router.post("/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    access: Member,
    ctx: CurrentUser,
    docs: ServiceDep,
    file: Annotated[UploadFile, File()],
    category: Annotated[Category, Form()] = "other",
) -> DocumentOut:
    content = await file.read(MAX_DOCUMENT_BYTES + 1)
    document, _ = await docs.store(
        access.workspace_id,
        filename=file.filename or "document",
        content=content,
        source="upload",
        actor_user_id=ctx.user.id,
        category=category,
    )
    return DocumentOut.model_validate(document)


@router.get("/documents/{document_id}/content")
async def download_document(document_id: uuid.UUID, access: Viewer, docs: ServiceDep) -> Response:
    document = await docs.get(access.workspace_id, document_id)
    return Response(
        content=docs.content(document),
        media_type=document.mime_type,
        headers={
            # Always a download, never rendered in the app's origin.
            "Content-Disposition": f'attachment; filename="{document.filename}"',
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.patch("/documents/{document_id}", response_model=DocumentOut)
async def update_document(
    document_id: uuid.UUID, body: DocumentUpdateIn, access: Member, docs: ServiceDep
) -> DocumentOut:
    document = await docs.get(access.workspace_id, document_id)
    updated = await docs.update(document, body.model_dump(exclude_unset=True))
    return DocumentOut.model_validate(updated)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: uuid.UUID, access: Admin, ctx: CurrentUser, docs: ServiceDep
) -> None:
    await docs.delete(await docs.get(access.workspace_id, document_id), ctx.user.id)


# ------------------------------------------------------------------ actions

ALLOWED_ATTACHMENT_TYPES = (
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/xml",
    "text/xml",
)
DEFAULT_GMAIL_QUERY = (
    "has:attachment newer_than:31d (factura OR invoice OR bon OR chitanta OR receipt OR "
    "filename:pdf OR filename:xml)"
)


class GmailImportParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(default=DEFAULT_GMAIL_QUERY, max_length=500)
    max_messages: int = Field(default=25, ge=1, le=100)
    category: Category = "invoice"


async def import_gmail(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    """Imports invoice/receipt attachments; message+attachment ids and hashes prevent duplicates."""
    assert isinstance(params, GmailImportParams)
    imported, skipped = 0, 0
    async with ctx.worker.session_factory() as db:
        try:
            _, api = await google_api(
                db, ctx.worker.secret_box, ctx.workspace_id, "gmail", ctx.worker.clock
            )
            attachments = await api.find_attachments(params.query, params.max_messages)
        except ProviderError as exc:
            raise (RetryableActionError if exc.retryable else ActionError)(exc.message) from exc
        docs = DocumentService(db, storage_for(ctx.worker.settings), ctx.worker.clock)
        for att in attachments:
            ref = f"{att.message_id}:{att.attachment_id}"
            if att.mime_type not in ALLOWED_ATTACHMENT_TYPES and not att.filename.lower().endswith(
                (".pdf", ".xml", ".png", ".jpg", ".jpeg")
            ):
                skipped += 1
                continue
            seen = await db.scalar(
                select(Document.id).where(
                    Document.workspace_id == ctx.workspace_id, Document.gmail_attachment_ref == ref
                )
            )
            if seen:
                skipped += 1
                continue
            try:
                content = await api.download_attachment(att.message_id, att.attachment_id)
                _, created = await docs.store(
                    ctx.workspace_id,
                    filename=att.filename,
                    content=content,
                    source="gmail",
                    actor_user_id=None,
                    category=params.category,
                    title=att.subject[:200] or att.filename,
                    metadata={
                        "gmail_message_id": att.message_id,
                        "gmail_attachment_ref": ref,
                        "vendor": att.sender[:200] or None,
                    },
                )
            except DomainError:
                skipped += 1  # unsupported/oversized file
                continue
            except ProviderError as exc:
                raise (RetryableActionError if exc.retryable else ActionError)(exc.message) from exc
            imported += int(created)
            skipped += int(not created)
    return {"imported": imported, "skipped": skipped, "scanned": len(attachments)}


class DriveArchiveParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # YYYY-MM; defaults to the previous month.
    period: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    folder: str = Field(default="Accountant", max_length=100)


async def archive_to_drive(ctx: ActionContext, params: BaseModel) -> dict[str, Any]:
    """Uploads the period's documents to Drive/<root>/<folder>/<YYYY-MM> (accountant-ready)."""
    assert isinstance(params, DriveArchiveParams)
    now = ctx.worker.clock().astimezone(UTC)
    if params.period:
        year, month = (int(x) for x in params.period.split("-"))
    else:
        year, month = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    period = f"{year:04d}-{month:02d}"
    uploaded = 0
    async with ctx.worker.session_factory() as db:
        try:
            config, api = await google_api(
                db, ctx.worker.secret_box, ctx.workspace_id, "drive", ctx.worker.clock
            )
            folder_id = await api.ensure_folder([config.drive_root_folder, params.folder, period])
        except ProviderError as exc:
            raise (RetryableActionError if exc.retryable else ActionError)(exc.message) from exc
        docs = DocumentService(db, storage_for(ctx.worker.settings), ctx.worker.clock)
        candidates = await docs.list_documents(ctx.workspace_id, limit=1000)
        for document in candidates:
            when = document.document_date or document.created_at.date()
            if (when.year, when.month) != (year, month) or document.drive_file_id:
                continue
            try:
                file_id = await api.upload_file(
                    folder_id, document.filename, document.mime_type, docs.content(document)
                )
            except ProviderError as exc:
                raise (RetryableActionError if exc.retryable else ActionError)(exc.message) from exc
            document.drive_file_id = file_id
            document.status = DocumentStatus.ARCHIVED.value
            await db.commit()  # per file: a retry never uploads the same document twice
            uploaded += 1
    return {"period": period, "uploaded": uploaded}


DOCUMENT_ACTIONS = (
    ActionDefinition(
        name="documents.import_gmail_attachments",
        title="Import invoices/receipts from Gmail",
        description="Reads matching Gmail attachments (read-only) into Documents; no duplicates.",
        params_model=GmailImportParams,
        handler=import_gmail,
        side_effecting=False,
        risk=ActionRisk.LOW,
    ),
    ActionDefinition(
        name="documents.archive_to_drive",
        title="Archive month to Google Drive",
        description="Uploads a month's documents into an accountant folder in Drive.",
        params_model=DriveArchiveParams,
        handler=archive_to_drive,
        risk=ActionRisk.LOW,
    ),
)
