"""Public interface of the documents module."""

from app.modules.documents.service import Document, DocumentService, LocalStorage

__all__ = ["Document", "DocumentService", "LocalStorage"]
