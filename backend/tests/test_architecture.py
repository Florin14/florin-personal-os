"""Enforces the module dependency rules documented in docs/ARCHITECTURE.md §4.2."""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parent.parent / "app"
# Composition roots may know every module.
COMPOSITION_ROOTS = {"main.py", "cli.py", "modules/registry.py", "migrations/env.py"}
FRAMEWORK_PACKAGES = ("fastapi", "starlette")


@dataclass(frozen=True)
class Import:
    file: str
    module: str


def _imports() -> list[Import]:
    found: list[Import] = []
    for path in APP_DIR.rglob("*.py"):
        rel = path.relative_to(APP_DIR).as_posix()
        if rel.startswith("migrations/versions/"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                found.extend(Import(rel, alias.name) for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                found.append(Import(rel, node.module))
                # `from app.modules.x import public` style
                found.extend(Import(rel, f"{node.module}.{alias.name}") for alias in node.names)
    return found


IMPORTS = _imports()


def _owner_module(rel: str) -> str | None:
    parts = rel.split("/")
    if parts[0] == "modules" and len(parts) > 2:
        return parts[1]
    return None


def test_imports_were_discovered() -> None:
    assert len(IMPORTS) > 50


def test_core_does_not_depend_on_modules() -> None:
    offenders = [
        i for i in IMPORTS if i.file.startswith("core/") and i.module.startswith("app.modules")
    ]
    assert offenders == []


def test_modules_only_use_public_interfaces_of_other_modules() -> None:
    offenders = []
    for imp in IMPORTS:
        if imp.file in COMPOSITION_ROOTS:
            continue
        owner = _owner_module(imp.file)
        if owner is None or not imp.module.startswith("app.modules."):
            continue
        parts = imp.module.split(".")
        target = parts[2] if len(parts) > 2 else None
        if target is None or target == owner:
            continue
        if parts[:4] != ["app", "modules", target, "public"]:
            offenders.append(imp)
    assert offenders == [], "Cross-module imports must go through <module>.public"


@pytest.mark.parametrize(
    "service_file",
    sorted(p.relative_to(APP_DIR).as_posix() for p in APP_DIR.glob("modules/*/service.py")),
)
def test_services_are_framework_independent(service_file: str) -> None:
    offenders = [
        i for i in IMPORTS if i.file == service_file and i.module.startswith(FRAMEWORK_PACKAGES)
    ]
    assert offenders == []


def test_every_module_is_registered() -> None:
    from app.modules.registry import MODULES

    packages = {p.name for p in (APP_DIR / "modules").iterdir() if (p / "module.py").exists()}
    assert packages == {m.name for m in MODULES}
