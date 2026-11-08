# Architecture Decision Records

Format: each ADR lists context, decision, consequences/tradeoffs, and status.
Statuses: **Accepted**, **Proposed**, **Superseded by ADR-n**.

Do not edit an accepted ADR's decision silently. Add a new ADR that supersedes it.

---

## ADR-001 — Modular monolith

* **Status:** Accepted (2026-11-08)
* **Context:** One primary user, one VPS, ~20 domain areas that will grow over years. Microservices would multiply deployment, observability and consistency costs without a scaling need.
* **Decision:** Single FastAPI application and single Postgres database, split into modules under `app/modules/<name>` with explicit public interfaces (`public.py`) and a central registry. Cross-module calls go through `public.py`; asynchronous coordination will use domain events via a transactional outbox (Phase 2).
* **Consequences:** + simple deployment, ACID transactions across modules when needed, fast refactoring. − Boundaries can erode without enforcement → enforced by an architecture test (`tests/test_architecture.py`). A module can later be extracted if it ever needs independent scaling.

## ADR-002 — PostgreSQL as the only stateful infrastructure (DB, job queue, outbox)

* **Status:** Accepted (2026-11-08)
* **Context:** Spec asks for durable jobs and low infrastructure cost. Load is tiny (single user).
* **Decision:** Use PostgreSQL for data, jobs (`SELECT … FOR UPDATE SKIP LOCKED`), scheduling state and the outbox. One worker process (Phase 2). Redis/a dedicated queue is introduced only when measured throughput, latency or concurrency needs justify it (new ADR required).
* **Consequences:** + one backup target, transactional enqueue with business writes. − Polling latency (seconds), which is acceptable for personal automations.

## ADR-003 — Server-side sessions in HttpOnly cookies (not JWT in localStorage)

* **Status:** Accepted (2026-11-08)
* **Context:** Browser-only first-party client, same-origin deployment, need for immediate revocation (logout, lost device, password change).
* **Decision:** Opaque 256-bit random session token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only the SHA-256 hash is stored in `user_sessions`. Idle and absolute timeouts. Session ID rotation when the authentication level changes (password → MFA verified). CSRF protection via a per-session token returned in a readable cookie and required in the `X-CSRF-Token` header on unsafe methods, plus an `Origin` allowlist check.
* **Consequences:** + instant revocation, no token in JS-accessible storage, simple mental model. − A DB lookup per request (negligible at this scale). Non-browser clients (Discord bot, CLI) will use separate mechanisms (signed interactions / service credentials), not user sessions.

## ADR-004 — TOTP MFA first, passkeys later

* **Status:** Accepted (2026-11-08)
* **Context:** Spec requires MFA or passkeys. Passkeys (WebAuthn) need HTTPS with a stable RP ID, which only exists once the VPN domain is set up.
* **Decision:** Phase 1 implements TOTP (RFC 6238, `pyotp`) with secrets encrypted at rest, replay protection (last used time step stored) and mandatory enrollment when `AUTH_REQUIRE_MFA=true` (default). Passkeys are added in Phase 8 as an additional factor. Lost-device recovery is a server-side CLI command (`reset-mfa`) until recovery codes are added.
* **Consequences:** + works on localhost and behind any reverse proxy today. − TOTP is phishable; mitigated by VPN-only access and later passkeys.

## ADR-005 — Argon2id password hashing

* **Status:** Accepted (2026-11-08)
* **Decision:** `argon2-cffi` with library defaults (Argon2id, RFC 9106 low-memory profile); hashes are transparently rehashed when parameters change. Login for unknown e-mails still performs a hash verification to reduce user-enumeration timing differences.

## ADR-006 — Encryption of stored secrets with Fernet / MultiFernet

* **Status:** Accepted (2026-11-08)
* **Context:** TOTP secrets now, provider credentials and OAuth tokens later must be encrypted at rest.
* **Decision:** `cryptography`'s `MultiFernet`. Keys come from `ENCRYPTION_KEYS` (comma separated; first key encrypts, all keys decrypt). Rotation = prepend a new key, re-encrypt in a background job (Phase 2), remove the old key.
* **Consequences:** + audited primitive, simple rotation. − Key in env means host compromise exposes it; acceptable for a single-tenant VPS, revisit with a secrets manager if the threat model changes.

## ADR-007 — Workspaces model personal/business separation

* **Status:** Accepted (2026-11-08)
* **Decision:** Every business record belongs to a `workspace` of `kind` `personal` or `business`. Access requires a `workspace_membership` with a role (`owner`, `admin`, `member`, `viewer`). Non-members receive `404` (not `403`) to avoid leaking existence. Future modules obtain an authorized workspace via `app.modules.workspaces.public.require_workspace_access`.
* **Consequences:** Separation is structural rather than a convention; cross-workspace features (e.g. a combined dashboard) must explicitly iterate authorized workspaces.

## ADR-008 — Typed API client generated from OpenAPI

* **Status:** Accepted (2026-11-08)
* **Decision:** FastAPI's OpenAPI document is exported by `scripts/export_openapi.py`; `openapi-typescript` generates `frontend/src/api/schema.d.ts`; requests use `openapi-fetch`. The generated file is committed and CI fails if it is out of date.
* **Consequences:** + compile-time contract checking with a tiny runtime (~6 KB). − Requires regenerating after API changes (`npm run generate:api`).

## ADR-009 — Python tooling: uv, Ruff, mypy, pytest

* **Status:** Accepted (2026-11-08)
* **Decision:** `uv` manages dependencies (`pyproject.toml` + `uv.lock`), Ruff for lint/format, mypy (strict) for types, pytest + pytest-asyncio + httpx for tests. Tests run against real PostgreSQL (no SQLite substitutes) so constraints and types behave as in production.
* **Supply chain:** `[tool.uv] exclude-newer` and `npm --before` keep newly published packages (< 14 days) out of lock files. Docker images pin uv to a released version.

## ADR-010 — Frontend stack

* **Status:** Accepted (2026-11-08)
* **Decision:** React + Vite + TypeScript (strict), MUI with a custom dark-first theme, TanStack Query (server state), Zustand (theme, current workspace), React Router, self-hosted Inter font (no external font CDN for privacy). React Flow (Automation Network/Workflow Builder) and Recharts (analytics) are added when those areas are built, not before.
* **Consequences:** Bundle size kept lean in Phase 1; placeholder pages exist for all 13 areas so navigation is stable.

## ADR-011 — Same-origin deployment through nginx

* **Status:** Accepted (2026-11-08)
* **Decision:** In production nginx serves the SPA and proxies `/api` to the backend; in development Vite proxies `/api`. The browser therefore only talks to one origin, which keeps cookies first-party. No CORS middleware is installed, so cross-origin browser calls are impossible by default. `ALLOWED_ORIGINS` is used by the Origin-check middleware that rejects unsafe requests from other origins.
* **Consequences:** + no CORS misconfiguration risk. − A future separate client (e.g. a mobile app) must use a different auth mechanism or a new ADR.

## ADR-012 — Migrations as a one-shot container

* **Status:** Accepted (2026-11-08)
* **Decision:** A `migrate` service runs `alembic upgrade head` and exits; `backend` starts only after it completed successfully. A test (`tests/test_migrations.py`) upgrades an empty database, checks the ORM metadata matches (no pending autogenerate diff), and runs downgrade/upgrade round-trips.

## ADR-013 — No public registration; CLI bootstrap

* **Status:** Accepted (2026-11-08)
* **Decision:** Users are created with `python -m app.cli create-user` (password read from a prompt or stdin, never from argv). Inviting additional users through the UI is a later feature that will require owner approval with MFA.

## ADR-014 — Dependency versions and tooling compatibility pins

* **Status:** Accepted (2026-11-08)
* **Context:** Latest majors at implementation time: React 19, MUI 9, React Router 8, Vite 8, Vitest 5, FastAPI 0.16x, Starlette 1.x, SQLAlchemy 2.1, Python 3.13.
* **Decision:** Use current majors, except where the tool chain is not yet compatible: TypeScript **5.9** (openapi-typescript and typescript-eslint do not support TS 6/7 yet) and ESLint **9** (eslint-plugin-jsx-a11y does not support ESLint 10 yet). Revisit when those plugins release support.
* **Consequences:** MUI 9 removed system props on layout components; layout props are passed through `sx`.

## ADR-015 — Domain events are delivered as jobs

* **Status:** Accepted (2026-11-08)
* **Context:** Modules must react to each other's state changes without direct coupling, reliably and with retries.
* **Decision:** Publishers write `outbox_events` in their own transaction. A worker relay (every `EVENT_RELAY_INTERVAL_SECONDS`) converts each unpublished event into one job per subscriber (`Module.event_subscriptions`) with idempotency key `event:{event_id}:{job_kind}`, and marks the event published in the same transaction. Retries, timeouts, dead-lettering and inspection are therefore shared with all other background work.
* **Consequences:** + one reliability mechanism, no message broker, at-least-once delivery that survives crashes. − Delivery latency ≈ relay interval + job poll interval (seconds). Handlers must be idempotent.

## ADR-016 — External notification channel adapters

* **Status:** Accepted (2026-11-08)
* **Decision:** The notifications module owns delivery (status, retries, dedupe) and defines the `ChannelAdapter` protocol. Concrete adapters (e.g. Discord, Phase 3) live in their integration module and are registered into `CHANNEL_ADAPTERS` by the worker composition root only when the integration is configured. Unconfigured channels fail visibly (`status=failed`, permanent job failure) instead of silently dropping messages.
* **Consequences:** notifications never imports integration modules; disabling an integration only removes its adapter.

## ADR-017 — Workflow definition language and execution engine

* **Status:** Accepted (2026-11-08)
* **Context:** Workflows must be user-editable, versioned, approvable and safe; the spec forbids executing user-provided code or unrestricted HTTP.
* **Decision:**
  * Definitions are JSON validated by Pydantic: triggers (`manual`, `cron` with IANA timezone, `interval`, `event`) and steps (`condition`, `delay`, `notify`, `approval`, `action`). Workflows must be acyclic (DAG); the engine also caps steps per execution.
  * `action` steps reference **registered, typed actions** (`app.core.actions.ActionDefinition`) declared by modules. Templates only substitute context values (`{{ trigger.x }}`); conditions use a fixed operator set with Decimal arithmetic that fails closed.
  * Every save that changes the definition creates an immutable `automation_versions` row; executions pin the version they started with.
  * The engine processes one step per transaction while holding a row lock on the execution. Side-effecting actions receive the idempotency key `execution:<id>:<step>`; transient errors retry the step via the job system (at-least-once); provider adapters must deduplicate.
  * Approval-gated actions request an approval bound to the rendered params hash and version; the approval is consumed in the same transaction as the side effect.
  * Dry-run renders and validates everything, calls each action's `plan` instead of its handler, skips delays and approvals.
  * A global emergency stop (`automation_controls`) blocks side-effecting actions; it is admin-only and audited.
  * Schedules coalesce missed runs into one execution; idempotency keys per (trigger, slot) prevent duplicates. Event triggers use a wildcard subscription that never receives `automation.*` events (no loops).
* **Consequences:** + safe by construction, testable, resumable. − No loops/iteration constructs; long-running provider calls hold a row lock for their duration (acceptable at personal scale). Webhook triggers are deferred to Phase 3 (they need signature verification per provider).

## ADR-018 — Invoice duplicate prevention with Oblio

* **Status:** Accepted (2026-11-08)
* **Context:** "A restarted worker must not issue duplicate invoices." Oblio documents an `idempotencyKey` "to avoid duplication" but not what a repeated key returns.
* **Decision:** Three layers: (1) `invoices` has a unique `(profile_id, period_start)`; the intent row is committed *before* calling Oblio. (2) Every call for that row uses the same `idempotencyKey` (`pos-<profile>-<YYYY-MM>`), so a retry after an unknown outcome (timeout/crash) is deduplicated by Oblio. (3) A row marked `issued` is never sent again. A row left `pending` after the last retry is shown as "outcome unknown — verify in Oblio" (manual reconciliation) instead of being retried blindly.
* **Additional guard:** issuance is approval-gated (high risk → in-app + fresh TOTP) and re-validates that the profile still produces the approved client/amount/currency; otherwise it fails.
* **To verify with live credentials:** Oblio's behaviour on a repeated `idempotencyKey` (sandbox/support).

## ADR-019 — Discord webhook exposure

* **Status:** Accepted (2026-11-08)
* **Decision:** Only `POST /api/v1/integrations/discord/interactions` may be exposed outside the VPN (Discord must reach it). It accepts only Ed25519-signed requests (5-minute timestamp window), never uses sessions, maps Discord users to accounts through an explicit allowlist, restricts channels, and inherits the approval risk policy (high-risk actions cannot be approved from Discord). Messages contain no confidential titles/amounts unless `include_titles` is enabled.
