"""Administrative CLI (composition root for offline operations).

Examples::

    python -m app.cli generate-key
    python -m app.cli create-user --email me@example.com --display-name "Florin" \
        --business-workspace "My SRL"
    echo "$PASSWORD" | python -m app.cli create-user --email me@example.com \
        --display-name Florin --password-stdin
    python -m app.cli create-workspace --owner-email me@example.com --name "My SRL" --kind business
    python -m app.cli reset-mfa --email me@example.com

Passwords are never accepted as command-line arguments (they would end up in
shell history and process listings).
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import create_engine, create_session_factory
from app.core.errors import DomainError
from app.core.security.encryption import SecretBox, generate_key
from app.modules.identity.service import IdentityService
from app.modules.workspaces.models import WorkspaceKind
from app.modules.workspaces.service import WorkspaceService, slugify


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\r\n")
    first = getpass.getpass("Password: ")
    if first != getpass.getpass("Repeat password: "):
        raise SystemExit("Passwords do not match.")
    return first


async def _with_session(work: Callable[[AsyncSession], Awaitable[None]]) -> None:
    settings = get_settings()
    engine = create_engine(settings)
    try:
        async with create_session_factory(engine)() as session:
            await work(session)
    finally:
        await engine.dispose()


def _identity(session: AsyncSession) -> IdentityService:
    settings = get_settings()
    box = SecretBox([k.get_secret_value() for k in settings.encryption_keys])
    return IdentityService(session, settings, box)


async def create_user(args: argparse.Namespace) -> None:
    password = _read_password(args.password_stdin)

    async def work(session: AsyncSession) -> None:
        user = await _identity(session).create_user(
            args.email, args.display_name, password, timezone=args.timezone, is_admin=args.admin
        )
        workspaces = WorkspaceService(session)
        personal = await workspaces.create_workspace(
            owner_id=user.id,
            name="Personal",
            slug=f"{slugify(args.display_name) or 'user'}-personal-{str(user.id)[:8]}",
            kind=WorkspaceKind.PERSONAL,
            timezone=args.timezone,
        )
        print(f"Created user {user.email} ({user.id}) with workspace '{personal.slug}'.")
        if args.business_workspace:
            business = await workspaces.create_workspace(
                owner_id=user.id,
                name=args.business_workspace,
                kind=WorkspaceKind.BUSINESS,
                timezone=args.timezone,
            )
            print(f"Created business workspace '{business.slug}'.")

    await _with_session(work)


async def create_workspace(args: argparse.Namespace) -> None:
    async def work(session: AsyncSession) -> None:
        owner = await _identity(session).get_user_by_email(args.owner_email)
        workspace = await WorkspaceService(session).create_workspace(
            owner_id=owner.id,
            name=args.name,
            kind=WorkspaceKind(args.kind),
            timezone=args.timezone,
            default_currency=args.currency,
        )
        print(f"Created {workspace.kind} workspace '{workspace.slug}' ({workspace.id}).")

    await _with_session(work)


async def reset_mfa(args: argparse.Namespace) -> None:
    async def work(session: AsyncSession) -> None:
        await _identity(session).reset_mfa(args.email)
        print(f"MFA reset for {args.email}; all sessions revoked. Enroll again at next login.")

    await _with_session(work)


async def discord_register_commands(args: argparse.Namespace) -> None:
    from app.modules.discord.public import COMMANDS, DiscordClient, load_discord

    async def work(session: AsyncSession) -> None:
        settings = get_settings()
        box = SecretBox([k.get_secret_value() for k in settings.encryption_keys])
        loaded = await load_discord(session, box)
        client = DiscordClient(loaded.secrets.bot_token.get_secret_value())
        registered = await client.register_commands(loaded.config.application_id, COMMANDS)
        print(f"Registered {len(registered)} Discord commands.")

    await _with_session(work)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Personal OS admin CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("generate-key", help="Print a new encryption key for ENCRYPTION_KEYS")

    p_user = sub.add_parser("create-user", help="Create a user with a personal workspace")
    p_user.add_argument("--email", required=True)
    p_user.add_argument("--display-name", required=True)
    p_user.add_argument("--timezone", default="Europe/Bucharest")
    p_user.add_argument("--business-workspace", help="Also create a business workspace")
    p_user.add_argument("--password-stdin", action="store_true", help="Read password from stdin")
    p_user.add_argument("--admin", action="store_true", help="Grant system administrator rights")

    p_ws = sub.add_parser("create-workspace", help="Create a workspace owned by a user")
    p_ws.add_argument("--owner-email", required=True)
    p_ws.add_argument("--name", required=True)
    p_ws.add_argument("--kind", choices=[k.value for k in WorkspaceKind], required=True)
    p_ws.add_argument("--timezone", default="Europe/Bucharest")
    p_ws.add_argument("--currency", default="RON")

    p_mfa = sub.add_parser("reset-mfa", help="Remove MFA for a user and revoke their sessions")
    p_mfa.add_argument("--email", required=True)
    sub.add_parser("discord-register-commands", help="Register the bot's slash commands")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "generate-key":
        print(generate_key())
        return 0
    commands = {
        "create-user": create_user,
        "create-workspace": create_workspace,
        "reset-mfa": reset_mfa,
        "discord-register-commands": discord_register_commands,
    }
    try:
        asyncio.run(commands[args.command](args))
    except DomainError as exc:
        print(f"Error: {exc.message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
