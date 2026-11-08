"""Descriptor that every domain module exposes to the composition root."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from fastapi import APIRouter


@dataclass(frozen=True, slots=True)
class Module:
    """A self-contained domain module.

    ``name`` must equal the package name under ``app.modules``. Future
    extension points (event handlers, job handlers, scheduled tasks) will be
    added here so modules can be registered without touching each other.
    """

    name: str
    title: str
    description: str
    routers: Sequence[APIRouter] = field(default_factory=tuple)
