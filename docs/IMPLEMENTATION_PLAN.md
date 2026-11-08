# Personal OS — Implementation Plan

Statuses: `TODO` · `IN PROGRESS` · `COMPLETED` · `BLOCKED`.
A task is `COMPLETED` only after it is implemented **and** verified (tests/checks actually executed).

---

## Phase overview

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, ADRs, module boundaries, schema proposal, threat model, backlog | COMPLETED |
| 1 | Backend/frontend foundation, database, authentication, Docker, CI, basic dashboard | IN PROGRESS (all verified locally; first GitHub Actions run pending) |
| 2 | Automation engine, persistent jobs, scheduler, events/outbox, approvals, notifications, audit | IN PROGRESS |
| 3 | Discord bot, Oblio monthly invoicing workflow | TODO |
| 4 | Google Calendar, Gmail, Drive, documents, basic expense processing | TODO |
| 5 | Bank statement import, reconciliation, shopping & price tracking | TODO |
| 6 | Freelance opportunity discovery, optional AI assistance | TODO |
| 7 | Home Assistant, location, health, lifestyle, shared planning | TODO |
| 8 | Performance, monitoring, security hardening (passkeys, rate limiting), disaster recovery | TODO |

---

## Phase 0 — Architecture

| ID | Task | Status |
|---|---|---|
| P0-1 | Requirements analysis and quality attributes ([ARCHITECTURE.md §1](ARCHITECTURE.md)) | COMPLETED |
| P0-2 | System context and container/deployment diagrams | COMPLETED |
| P0-3 | Module boundaries and dependency rules | COMPLETED |
| P0-4 | Database schema proposal | COMPLETED |
| P0-5 | Automation execution lifecycle | COMPLETED |
| P0-6 | Integration capability matrix | COMPLETED |
| P0-7 | Threat model | COMPLETED |
| P0-8 | Cost assumptions | COMPLETED |
| P0-9 | ADRs ([DECISIONS.md](DECISIONS.md)) | COMPLETED |
| P0-10 | MVP backlog and setup checklist (this file, README) | COMPLETED |

## Phase 1 — Foundation

### Scope

Runnable skeleton of the whole product with production-grade foundations:
modular backend, database and migrations, secure authentication with MFA,
workspace isolation, app shell with dashboard, Docker Compose (dev + prod),
CI, and tests.

### Acceptance criteria

1. `docker compose up --build` starts Postgres, runs migrations, starts the API and the frontend; the dashboard is reachable at `http://localhost:5173`.
2. An owner created via CLI can log in, is forced to enroll TOTP (when `AUTH_REQUIRE_MFA=true`), and reaches the dashboard.
3. Unauthenticated requests to protected endpoints return `401`; non-members of a workspace get `404`.
4. Unsafe requests without a valid CSRF token or from a non-allowed origin are rejected.
5. Repeated failed logins lock the account temporarily; TOTP codes cannot be replayed.
6. Sessions can be listed and revoked; logout revokes the session; password change revokes other sessions.
7. Migrations apply on an empty database and match the ORM models.
8. Backend: Ruff, mypy, pytest pass. Frontend: ESLint, `tsc`, Vitest, production build pass. Playwright login E2E passes against the Docker stack.
9. CI workflows exist for lint, type check, tests, image builds and dependency/image scanning.
10. Architecture rules are enforced by tests.

### Tasks

| ID | Task | Status |
|---|---|---|
| P1-1 | Repository structure, `.gitignore`, `.env.example`, README | COMPLETED |
| P1-2 | Backend core: config, DB, logging with redaction, error envelope, middleware | COMPLETED |
| P1-3 | Module registry + architecture rule tests | COMPLETED |
| P1-4 | Identity: users, Argon2id, sessions, CSRF, lockout | COMPLETED |
| P1-5 | Identity: TOTP enrollment/verification, encrypted secrets, replay protection | COMPLETED |
| P1-6 | Identity: session list/revoke, logout, password change | COMPLETED |
| P1-7 | Workspaces: personal/business, memberships, roles, access dependency | COMPLETED |
| P1-8 | System: liveness, readiness, system info | COMPLETED |
| P1-9 | Alembic setup + initial migration + migration tests | COMPLETED |
| P1-10 | Admin CLI: create-user, create-workspace, reset-mfa | COMPLETED |
| P1-11 | Frontend foundation: Vite, TS strict, MUI dark theme, router, Query, Zustand | COMPLETED |
| P1-12 | Generated OpenAPI client | COMPLETED |
| P1-13 | Auth UI: login, MFA verify, MFA enrollment | COMPLETED |
| P1-14 | App shell with navigation for all 13 areas, offline/disconnected banners | COMPLETED |
| P1-15 | Overview dashboard (system status, workspaces, security status, roadmap) | COMPLETED |
| P1-16 | Settings & Security page (sessions, password, MFA status) | COMPLETED |
| P1-17 | Frontend tests (Vitest + Testing Library) | COMPLETED |
| P1-18 | Dockerfiles, `compose.yaml`, `compose.prod.yaml`, health checks | COMPLETED |
| P1-19 | Playwright E2E: login + MFA enrollment + dashboard | COMPLETED |
| P1-20 | GitHub Actions: CI + security scanning | IN PROGRESS — workflows written and YAML-validated; not yet executed (changes not yet committed/pushed to github.com/Florin14/florin-personal-os) |

## Phase 2 — Automation core

### Scope

Durable, auditable automation engine: audit trail, Postgres-backed jobs and
worker, domain events via transactional outbox, scheduling, typed workflows
with approvals and notifications, and the UI to observe and operate them.

### Acceptance criteria

1. Security-relevant actions produce append-only audit records.
2. Jobs survive worker restarts; expired leases are re-claimed; retries use exponential backoff with jitter; permanently failed jobs are inspectable and retryable.
3. Domain events are written in the same transaction as the state change (outbox) and delivered at least once to subscribers, with idempotent handlers.
4. Cron/interval triggers fire in the configured IANA timezone without duplicate executions.
5. Executions are persisted step by step, support dry-run, cancellation and an emergency stop.
6. An expired approval never executes; a changed payload or version invalidates an approval; a non-member cannot approve; high-risk approvals require fresh MFA in-app.
7. UI shows the automation network, executions/logs, approval inbox and notifications.

### Tasks

| ID | Task | Status |
|---|---|---|
| P2-1 | `audit` module, auth events wired in, admin flag | COMPLETED |
| P2-2 | `jobs` module + `worker` process/container, admin jobs API | TODO |
| P2-3 | `events` module: transactional outbox, relay to subscriber jobs | TODO |
| P2-4 | `notifications` module: in-app channel, dedupe, API | TODO |
| P2-5 | `approvals` module: risk policy, payload hash/version binding, expiry, step-up MFA | TODO |
| P2-6 | `automation` module: definitions, versions, step registry, engine, dry-run, cancel, emergency stop | TODO |
| P2-7 | Scheduling: cron/interval triggers with timezones, missed-run policy | TODO |
| P2-8 | UI: Approval Inbox, Executions & Logs, notifications, audit log | TODO |
| P2-9 | UI: Automation Network (React Flow) + Workflow Builder | TODO |
| P2-10 | Phase 2 E2E and critical-scenario tests | TODO |


---

## MVP backlog (Phases 2–3)

Ordered by dependency. Each item gets acceptance criteria when its phase starts.

### Phase 2 — Automation core
1. `audit` module: append-only audit records, auth events wired in (login, MFA, session revocation).
2. `events` module: domain event types, transactional outbox, in-process dispatcher with durable subscriptions.
3. `jobs` module + `worker` container: claim with `SKIP LOCKED`, leases, retries with exponential backoff + jitter, timeouts, failure classification, failed-job inspection API/UI.
4. `scheduling`: cron and interval triggers with IANA timezones (DST-safe next-fire computation), missed-run policy.
5. `automation`: automations, immutable versions, typed step registry (condition, branch, delay, notify, approval gate, action), executions, step executions, dry-run, cancellation, emergency stop.
6. `approvals`: risk levels, payload hash + version binding, expiry, decision channels, in-app inbox.
7. `notifications`: in-app channel, delivery log, dedupe keys; Discord channel stub.
8. UI: Automation Network (React Flow, read-only graph), Executions & Logs, Approval Inbox.
9. Critical tests: expired approval never executes; changed payload invalidates approval; third party cannot approve; restart recovery; failed jobs visible.

### Phase 3 — Discord + Oblio
1. `integrations` module: provider registry, connections, encrypted credentials, health checks, error normalization, contract test harness.
2. Oblio adapter (verified against official API docs) + mock adapter with fixtures.
3. Monthly invoice workflow with explicit settings (series, VAT config, description, currency, due days, billing period, timezone), mandatory approval, duplicate prevention via idempotency key + provider lookup.
4. Discord bot: signed interactions endpoint, allowlisted users/channels, notifications, approve/reject, `/status`.
5. Critical tests: restarted worker does not issue duplicate invoices; provider timeouts are recoverable.

### Later (Phases 4–8) — summarized
See [PROJECT_SPEC.md §14](PROJECT_SPEC.md) and [ARCHITECTURE.md §5](ARCHITECTURE.md).
Known items already identified: recovery codes for MFA, passkeys, IP-based rate limiting,
PWA service worker/offline cache, backups + restore verification, log shipping/monitoring,
WireGuard deployment guide, Home Assistant node guide.

---

## Session log

_(Completion reports are appended here at the end of each implementation session.)_

### 2026-11-08 — Phase 0 + Phase 1

**Implemented**
- Phase 0 documents: ARCHITECTURE.md (context/container diagrams, module rules, schema, lifecycle, capability matrix, threat model, costs, repo layout, env vars), DECISIONS.md (ADR-001…014), this plan, DEPLOYMENT.md, README.md.
- Backend modular monolith: core (config with production guards, DB, JSON logging with redaction, error envelope, request-id/security-header/Origin middleware, Argon2id, Fernet/MultiFernet, TOTP), module registry, `system`, `identity`, `workspaces` modules, Alembic migration, admin CLI.
- Auth: server-side sessions (hashed tokens, HttpOnly/SameSite cookies, idle + absolute expiry, rotation on MFA), CSRF token per session, Origin allowlist, lockout after failed password/TOTP attempts, mandatory TOTP enrollment, TOTP replay protection with row locking, session list/revoke, password change revoking other sessions.
- Workspaces: personal/business kinds, roles, membership-based access (404 for non-members), `require_workspace_access` for future modules.
- Frontend: Vite + React 19 + TS strict + MUI 9 dark-first theme (reduced-motion aware), TanStack Query, Zustand (theme, current workspace), generated OpenAPI client with CSRF middleware, login / MFA verify / MFA enrollment (local QR rendering), route guard, responsive app shell with all 13 areas (planned ones show phase placeholders), overview dashboard, Settings & Security, loading/error/empty/unauthorized/offline/disconnected states, PWA manifest.
- Docker: dev compose (db → migrate → backend → frontend, 127.0.0.1-only ports) and prod compose (nginx with CSP, internal DB network, non-root, read-only FS, cap_drop, resource limits, log rotation).
- CI: ci.yml (lint, format, types, tests, OpenAPI drift, E2E, prod image build) and security.yml (pip-audit, npm audit, Trivy).

**Tests executed (all passing)**
- Backend: 101 pytest tests (local venv and inside the dev container), coverage 89%; Ruff lint + format; mypy --strict.
- Frontend: 35 Vitest tests; ESLint (strict type-checked + jsx-a11y); Prettier; `tsc`; production build.
- E2E: 3 Playwright tests passed against the dev stack and against the production stack (`compose.prod.yaml`, CSP + Secure cookies).
- Migrations: upgrade on empty DB, model/migration diff = none, downgrade→upgrade round trip.
- Docker: dev and prod images built and started; health checks healthy; DB port not published in prod; OpenAPI disabled in prod.

**Known limitations**
- GitHub Actions workflows have not run yet (Phase 1 changes are not committed or pushed); action versions should be pinned to SHAs (Phase 8).
- No IP-based rate limiting; per-account lockout can be abused to lock the owner out (mitigated by VPN-only access). Lockout responses reveal that an account exists.
- No MFA recovery codes or passkeys yet (CLI `reset-mfa` is the recovery path).
- Audit records are not persisted yet (auth events are only logged) — Phase 2.
- CLI `create-user` commits the user and the workspace in separate transactions.
- No PWA service worker/offline cache; JS bundle ~230 KB gzip (route-level code splitting later).
- Dependency audit (local, 2026-11-08): runtime npm deps 0 vulnerabilities, Python runtime deps 0 known vulnerabilities (pip-audit). Dev-only npm tooling has 7 moderate findings (minimatch via typescript-eslint), not shipped.
- Backups/restore scripts and monitoring are not implemented (Phase 8); DEPLOYMENT.md documents manual `pg_dump`.

**Next recommended task**
Commit and push Phase 1, confirm the first CI run, then start Phase 2 with the `audit` module and the transactional outbox/`jobs` foundation (see backlog above).
