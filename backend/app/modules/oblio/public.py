"""Public interface of the Oblio adapter module."""

from app.modules.oblio.client import EinvoiceResult, IssuedDocument, OblioApi
from app.modules.oblio.provider import OblioConfig, load_oblio

__all__ = ["EinvoiceResult", "IssuedDocument", "OblioApi", "OblioConfig", "load_oblio"]
