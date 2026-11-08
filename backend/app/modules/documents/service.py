"""Document metadata (PostgreSQL) + binary content (storage backend)."""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
import unicodedata
import uuid
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow
from app.core.errors import NotFound, ValidationFailed
from app.modules.audit.public import AuditRecorder

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
CATEGORIES = ("invoice", "receipt", "statement", "contract", "other")


class DocumentStatus(StrEnum):
    INBOX = "inbox"
    PROCESSED = "processed"
    ARCHIVED = "archived"


class Document(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("workspace_id", "sha256", name="uq_documents_workspace_sha256"),
        CheckConstraint(
            "category IN ('invoice', 'receipt', 'statement', 'contract', 'other')",
            name="category_valid",
        ),
        CheckConstraint("status IN ('inbox', 'processed', 'archived')", name="status_valid"),
        Index("ix_documents_workspace_created", "workspace_id", "created_at"),
        Index("ix_documents_gmail", "workspace_id", "gmail_message_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    filename: Mapped[str] = mapped_column(String(200))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(300))
    source: Mapped[str] = mapped_column(String(20), default="upload")
    category: Mapped[str] = mapped_column(String(20), default="other")
    status: Mapped[str] = mapped_column(String(20), default=DocumentStatus.INBOX.value)
    document_date: Mapped[date | None] = mapped_column(default=None)
    vendor: Mapped[str | None] = mapped_column(String(200), default=None)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), default=None)
    currency: Mapped[str | None] = mapped_column(String(3), default=None)
    notes: Mapped[str] = mapped_column(Text, default="")
    gmail_message_id: Mapped[str | None] = mapped_column(String(100), default=None)
    gmail_attachment_ref: Mapped[str | None] = mapped_column(String(200), default=None)
    drive_file_id: Mapped[str | None] = mapped_column(String(200), default=None)
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(default=None)


# ------------------------------------------------------------------ storage


class DocumentStorage(Protocol):
    def write(self, key: str, content: bytes) -> None: ...
    def read(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


class LocalStorage:
    """Files under a private directory (Docker volume); keys are content addressed."""

    def __init__(self, root: str) -> None:
        self._root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        path = (self._root / key).resolve()
        if self._root not in path.parents:
            raise ValueError("invalid storage key")  # path traversal guard
        return path

    def write(self, key: str, content: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            return
        fd, tmp = tempfile.mkstemp(dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(content)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()


# --------------------------------------------------------------- validation

_SIGNATURES: tuple[tuple[bytes, str, str], ...] = (
    (b"%PDF-", "application/pdf", ".pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
)


def sniff_type(content: bytes) -> tuple[str, str]:
    """Trust content, not the client's declared type. Only safe document formats."""
    for magic, mime, extension in _SIGNATURES:
        if content.startswith(magic):
            return mime, extension
    head = content[:200].lstrip(b"\xef\xbb\xbf \t\r\n")
    if head.startswith(b"<?xml"):
        return "application/xml", ".xml"  # e-Factura (UBL) files
    raise ValidationFailed(
        "Unsupported file type. Allowed: PDF, PNG, JPEG, XML.", code="unsupported_file_type"
    )


def safe_filename(name: str, extension: str) -> str:
    base = unicodedata.normalize("NFKD", Path(name or "document").name).encode("ascii", "ignore")
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", base.decode()).strip("._") or "document"
    stem = stem[:150]
    if not stem.lower().endswith(extension):
        stem = f"{Path(stem).stem}{extension}"
    return stem


class DocumentService:
    def __init__(
        self,
        session: AsyncSession,
        storage: DocumentStorage,
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        self._db = session
        self._storage = storage
        self._now = clock

    async def store(
        self,
        workspace_id: uuid.UUID,
        *,
        filename: str,
        content: bytes,
        source: str,
        actor_user_id: uuid.UUID | None,
        category: str = "other",
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[Document, bool]:
        """Store a document; returns (document, created). Identical content is deduplicated."""
        if not content:
            raise ValidationFailed("The file is empty.")
        if len(content) > MAX_DOCUMENT_BYTES:
            raise ValidationFailed("The file is larger than 10 MB.", code="file_too_large")
        if category not in CATEGORIES:
            raise ValidationFailed("Unknown category.")
        mime, extension = sniff_type(content)
        digest = hashlib.sha256(content).hexdigest()
        existing = await self._db.scalar(
            select(Document).where(Document.workspace_id == workspace_id, Document.sha256 == digest)
        )
        if existing is not None:
            return existing, False
        key = f"{workspace_id}/{digest[:2]}/{digest}"
        self._storage.write(key, content)
        name = safe_filename(filename, extension)
        document = Document(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            title=(title or Path(name).stem)[:200],
            filename=name,
            mime_type=mime,
            size_bytes=len(content),
            sha256=digest,
            storage_key=key,
            source=source,
            category=category,
            status=DocumentStatus.INBOX.value,
            uploaded_by_user_id=actor_user_id,
            **(metadata or {}),
        )
        self._db.add(document)
        AuditRecorder(self._db).record(
            "documents.stored",
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            target_type="document",
            target_id=document.id,
            details={"source": source, "mime": mime, "size": len(content)},
        )
        await self._db.commit()
        return document, True

    async def list_documents(
        self,
        workspace_id: uuid.UUID,
        *,
        category: str | None = None,
        status: str | None = None,
        limit: int = 200,
    ) -> list[Document]:
        stmt = select(Document).where(Document.workspace_id == workspace_id)
        if category:
            stmt = stmt.where(Document.category == category)
        if status:
            stmt = stmt.where(Document.status == status)
        return list(await self._db.scalars(stmt.order_by(Document.created_at.desc()).limit(limit)))

    async def get(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> Document:
        document = await self._db.scalar(
            select(Document).where(
                Document.id == document_id, Document.workspace_id == workspace_id
            )
        )
        if document is None:
            raise NotFound("Document not found.")
        return document

    def content(self, document: Document) -> bytes:
        return self._storage.read(document.storage_key)

    async def update(self, document: Document, data: dict[str, Any]) -> Document:
        for key in (
            "title",
            "category",
            "status",
            "document_date",
            "vendor",
            "amount",
            "currency",
            "notes",
        ):
            if key in data:
                setattr(document, key, data[key])
        if document.category not in CATEGORIES:
            raise ValidationFailed("Unknown category.")
        await self._db.commit()
        return document

    async def delete(self, document: Document, actor_user_id: uuid.UUID) -> None:
        AuditRecorder(self._db).record(
            "documents.deleted",
            actor_user_id=actor_user_id,
            workspace_id=document.workspace_id,
            target_type="document",
            target_id=document.id,
        )
        key = document.storage_key
        await self._db.delete(document)
        await self._db.commit()
        self._storage.delete(key)
