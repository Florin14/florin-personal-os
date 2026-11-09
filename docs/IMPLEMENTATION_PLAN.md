# Personal OS — Implementation Plan

Statuses: `TODO` · `IN PROGRESS` · `COMPLETED` · `BLOCKED`.
A task is `COMPLETED` only after it is implemented **and** verified (tests/checks actually executed).

---

## Phase overview

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, ADRs, module boundaries, schema proposal, threat model, backlog | COMPLETED |
| 1 | Backend/frontend foundation, database, authentication, Docker, CI, basic dashboard | IN PROGRESS (all verified locally; first GitHub Actions run pending) |
| 2 | Automation engine, persistent jobs, scheduler, events/outbox, approvals, notifications, audit | COMPLETED |
| 3 | Discord bot, Oblio monthly invoicing workflow | COMPLETED (live Oblio/Discord not verified: no credentials; mock verified) |
| 4 | Google Calendar, Gmail, Drive, documents, basic expense processing | IN PROGRESS |
| 5 | Bank statement import, reconciliation, shopping & price tracking | COMPLETED (manual price source only; live bank/price sources need licensed providers) |
| 6 | Freelance opportunity discovery, optional AI assistance | COMPLETED (AI verified against a fake Ollama; no real model run) |
| 7 | Home Assistant, location, health, lifestyle, shared planning | IN PROGRESS (Smart Home completed; context/health/sharing await owner scope) |
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

1. `docker compose up --build` starts Postgres, runs migrations, starts the API and the frontend; the dashboard is reachable at `http://localhost:3000`.
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
| P2-2 | `jobs` module + `worker` process/container, admin jobs API | COMPLETED |
| P2-3 | `events` module: transactional outbox, relay to subscriber jobs | COMPLETED |
| P2-4 | `notifications` module: in-app channel, dedupe, API | COMPLETED |
| P2-5 | `approvals` module: risk policy, payload hash/version binding, expiry, step-up MFA | COMPLETED |
| P2-6 | `automation` module: definitions, versions, step registry, engine, dry-run, cancel, emergency stop | COMPLETED |
| P2-7 | Scheduling: cron/interval triggers with timezones, missed-run policy | COMPLETED (webhook triggers deferred to Phase 3) |
| P2-8 | UI: Approval Inbox, Executions & Logs, notifications, audit log | COMPLETED |
| P2-9 | UI: Automation Network (React Flow) + Workflow Builder | COMPLETED |
| P2-10 | Phase 2 E2E and critical-scenario tests | SKIPPED (user requested implementation only, no new tests) |

## Phase 3 — Integrations, Oblio, Discord

### Scope

Provider-adapter framework with encrypted credentials; Oblio invoicing
(real adapter per official API docs + mock); recurring monthly invoice
workflow with mandatory approval and duplicate prevention; private Discord
bot (signed interactions, allowlists, approvals, notifications).

### Tasks

| ID | Task | Status |
|---|---|---|
| P3-1 | `integrations` module: provider registry, encrypted credentials, health checks, error normalization | COMPLETED |
| P3-2 | Oblio adapter (REST, token cache, rate-limit aware) + mock adapter | COMPLETED |
| P3-3 | `invoicing` module: invoice profiles, invoice records, monthly invoice actions + workflow template | COMPLETED |
| P3-4 | `discord` module: signed interactions endpoint, allowlists, /status, approve/reject buttons, channel adapter | COMPLETED (live Discord not verified: no bot credentials) |
| P3-5 | UI: Integrations page, Business & Accounting page | COMPLETED |

## Phase 4 — Google, documents, expenses

| ID | Task | Status |
|---|---|---|
| P4-1 | `google` module: OAuth app (system), PKCE authorization flow, per-workspace accounts, token refresh/revocation, Calendar/Gmail/Drive adapters + mocks | IN PROGRESS |
| P4-2 | `calendar` module: upcoming events, create events/reminders, free/busy, tasks, actions, UI | TODO |
| P4-3 | `documents` module: safe upload storage, metadata, Gmail receipt import, Drive archival, UI | TODO |
| P4-4 | `expenses` module: expenses from documents, categories, monthly summary, UI | TODO |

## Phase 7 — Home Assistant, location, health, lifestyle, shared planning

| ID | Task | Status |
|---|---|---|
| P7-1 | `smarthome` module: Home Assistant provider (live + mock), discovery, state events, opt-in controllable devices, service allowlist, anti-toggle guard, manual override, command log, `smarthome.call_service` action (ADR-025) | COMPLETED (mock walkthrough + simulated live wire format; no real Home Assistant available) |
| P7-2 | UI: Smart Home page (devices, states, controls, overrides, command log) | COMPLETED (desktop/mobile Chromium walkthrough, lint/types/build verified) |
| P7-3 | Location & context rules | BLOCKED — owner decision: whether location data is collected at all, and from which device/app |
| P7-4 | Health & lifestyle | BLOCKED — owner decision: which data (manual only vs. a specific app/export) |
| P7-5 | Shared planning | BLOCKED — owner decision: who shares what (needs multi-user invites, currently CLI-only) |

**Acceptance criteria (P7-1/P7-2)**
- Works fully in mock mode without credentials; live mode uses only documented REST endpoints.
- No command reaches Home Assistant unless the device is marked controllable and the service is on
  the domain allowlist; sensitive services are refused for automations.
- Repeated commands faster than the device interval or above 20/hour are refused; overridden devices
  refuse automation commands; every attempt is logged with its outcome.
- State transitions emit `smarthome.state_changed`; continuous sensor readings do not.

**Verified checkpoint (2026-11-09, Codex continuation)**
- Completed Claude's in-progress adapter and ADR-025; added the module, migration
  `20261109_0238cc500048_smarthome`, registry wiring, generated client, lazy `/home` page and
  Command Center integration using the existing Tailwind/Radix components.
- Durable command intents prevent replay after crashes/unknown outcomes; concurrent delivery with
  the same key sends once. Manual-only sensitive commands need explicit UI confirmation; all
  automation controls require approval and respect the engine's emergency stop.
- Backend: Ruff/format/mypy clean, 218 existing pytest tests pass (including migration round trip).
  Frontend: ESLint/Prettier/TypeScript/build clean, 43 existing Vitest tests pass.
- One-off API/service/browser walkthroughs verified mock discovery, policy, state events, overrides,
  cooldowns, 20/hour limit, idempotency/concurrency/timeouts, viewer/member/admin authorization,
  mobile layout and no runtime errors. No new automated tests were added (owner preference).
- P7-3/P7-4/P7-5 retain Claude's owner-decision blockers. Real devices remain unverified.

## Phase 6 — Freelance opportunities & optional AI

| ID | Task | Status |
|---|---|---|
| P6-1 | `ai` module: disabled/Ollama providers, per-workspace feature consent, monthly budget, usage log, redaction, structured outputs (ADR-023) | COMPLETED |
| P6-2 | `opportunities` module: profile, manual + RSS/Atom sources with SSRF-safe fetching, deterministic matching, notifications/event, optional AI summary (ADR-024) | COMPLETED |
| P6-3 | UI: Freelance & Career page (matches, sources, profile) + AI settings card | COMPLETED |

**Acceptance criteria**
- With `AI_PROVIDER=disabled` everything works; AI buttons explain why they are unavailable.
- No AI call happens unless the provider is configured, the feature is enabled for the workspace and
  the monthly budget has room; every attempt (including refusals) is recorded.
- Prompts are redacted; non-conforming AI output is rejected; AI output is never executed.
- Feed URLs that are not https, contain credentials or resolve to non-public addresses are refused
  (also after redirects); oversized or non-XML responses are refused; XML entities are not expanded.
- Re-polling a feed never duplicates listings; scores are deterministic and come with reasons;
  excluded keywords always win.

## Frontend redesign (owner request 2026-11-08)

MUI → Tailwind v4 + shadcn-style Radix primitives + Motion + Lucide + Recharts + React Flow.

| ID | Task | Status |
|---|---|---|
| FR-1 | Design system, command-center shell, neural Command Center | COMPLETED |
| FR-2 | Migrate auth, settings, approvals, executions, business, integrations, calendar, finance | COMPLETED |
| FR-3 | Visual Workflow Builder (typed nodes, inspector, drag-to-connect, JSON sync, validation, run overlay) + Automation Network | COMPLETED |
| FR-4 | Remove `@mui/*` / `@emotion/*`; ESLint + Prettier clean on the whole frontend; existing Vitest suites updated to new markup | COMPLETED |
| FR-5 | Docs: ARCHITECTURE §4.4 + ADR-020 superseding ADR-010 | COMPLETED |

## Phase 5 — Finance imports, reconciliation, shopping & price tracking

| ID | Task | Status |
|---|---|---|
| P5-1 | `banking` module: accounts, CSV statement import (pluggable parsers, preview, duplicate-safe), transactions, undo import, Open Banking provider interface | COMPLETED |
| P5-2 | Reconciliation: deterministic rules + confidence scoring against documents, expenses and issued invoices; suggestions, manual confirm/reject/unmatch, `banking.reconcile` action | COMPLETED |
| P5-3 | UI: Banking & Reconciliation page (accounts, import with preview, transactions, review queue) | COMPLETED |
| P5-4 | `shopping` module: merchants, products (canonical identity), listings, manual price observations, history, thresholds/alerts, provider abstraction (manual source only) | COMPLETED |
| P5-5 | Shopping alerts through notifications + confirmation workflow (approval before any purchase step; no checkout) | COMPLETED |
| P5-6 | UI: Shopping Intelligence page (products, merchant comparison, price history chart, alerts) | COMPLETED |

**Acceptance criteria (banking, P5-1…P5-3)**
- A CSV statement (comma/semicolon/tab, decimal comma or point, common date formats, UTF-8 or
  Windows-1250) can be previewed without persisting anything; unparseable rows are reported per line.
- Importing the same file twice is rejected; importing an overlapping statement adds only new rows;
  two genuinely identical transactions in one statement are both kept.
- Amounts are stored as NUMERIC (never float); debits are negative.
- An import can be undone (removes its transactions and their matches), audited.
- Reconciliation never matches across workspaces or currencies; every match records the rule and
  a confidence; only a single unambiguous exact candidate (≥ 0.95) is auto-confirmed, everything
  else waits in a review queue; confirmed matches can be undone.
- No bank credentials are ever requested; Open Banking exists only as an interface (ADR-021).

**Acceptance criteria (shopping, P5-4…P5-6)**
- A product cannot be tracked twice in a workspace (same GTIN, or same brand+model, or same name).
- Prices are NUMERIC; observations are append-only (a wrong entry can be deleted, never edited).
- Alerts fire only for newer observations of a product being watched; at most one open
  "below target" alert per product; every alert notifies in-app and emits `shopping.price_alert`.
- Merchant comparison shows each listing's latest price and stock; history is charted per merchant.
- No URL is ever fetched by the server; no scraping; no checkout. Purchase decisions taken by a
  workflow require an approval (ADR-022).




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

### 2026-11-09 — Phase 6 (freelance opportunities + optional AI)

**Implemented**
- `ai` module (ADR-023): disabled (default) / local Ollama providers, per-workspace feature
  consent, monthly request budget, usage log incl. refusals, prompt redaction, schema-validated
  output, no tools. Env: `AI_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `AI_TIMEOUT_SECONDS`,
  `AI_MONTHLY_REQUEST_BUDGET`. No paid provider.
- `opportunities` module (ADR-024): profile, manual listings, user-added RSS/Atom feeds via an
  SSRF-safe fetcher + defusedxml, deterministic explained scoring, periodic polling, one
  notification + `opportunities.matched` event per poll, optional AI summary.
- UI: Freelance & Career page (matches, sources, profile) and an AI card in Settings.

**Verification (executed)**
- ruff + mypy --strict clean; 217 pytest tests pass; migration upgrade/downgrade/check clean.
- tsc, ESLint, Prettier clean; 43 Vitest tests; production build OK.
- Scratch checks: feed parsing, billion-laughs and XXE refused, URL policy incl. DNS→loopback,
  matching determinism/exclusions/rate, redaction; AI gates against a fake Ollama server (consent,
  redacted wire request, invalid output, budget, usage log); API + Chromium walkthroughs incl. a
  real public RSS feed (25 listings, conditional re-poll, no duplicates). Test data removed.
- Found and fixed during verification: localhost feeds accepted at save time; httpx treats 304 as a
  redirect (conditional re-poll failed); schema name collisions with shopping/invoicing; profile
  form remount lost the success message.

**Known limitations**
- No real local model was run (none installed); Ollama integration is verified by wire format only.
- DNS-rebinding window between the address check and the connection (ADR-024).

### 2026-11-09 — Frontend redesign completed + Phase 5

**Implemented**
- Visual Workflow Builder (typed nodes, inspector, drag-to-connect, JSON sync, client validation,
  run overlay), Automation Network; MUI/Emotion removed; lint/format clean (ADR-020).
- `banking`: CSV statement import with preview, duplicate-safe fingerprints, undo, deterministic
  reconciliation with review queue, Open Banking interface only (ADR-021).
- `shopping`: merchants, canonical products (GTIN / brand+model / name), listings, append-only
  manual price observations, alerts (below target, drop %, back in stock) with notifications and
  `shopping.price_alert`, approval-gated `shopping.approve_purchase`, no scraping/checkout (ADR-022).
- UI: Banking & Reconciliation, Shopping Intelligence (price history chart, validated palette).

**Verification (executed)**
- Backend: ruff + mypy --strict clean; 215 pytest tests pass; both migrations upgrade/downgrade and
  `alembic check` clean.
- Frontend: tsc, ESLint, Prettier clean; 43 Vitest tests pass; production build OK.
- End-to-end against the dev stack (scripts in the session scratchpad, data cleaned up): banking API
  + UI walkthroughs; shopping API (identity, URL rules, every alert rule, comparison, the full
  event → workflow → approval → decision chain through the real worker) + UI walkthrough.
- No new automated tests were added (owner preference, 2026-11-08).

**Known limitations**
- Invoices store net amounts; gross payments only reach the review queue (ADR-021 follow-up).
- Only a generic CSV parser; bank-specific parsers need real export samples.
- Prices are manual until a compliant source exists; no automation delete endpoint, so smoke
  automations ("Smoke approve purchase", "Smoke builder …") remain disabled in the dev DB.
- Main JS chunk ~253 KB gzip (Banking/Finance are not lazy-loaded yet).

**Next recommended task**
Phase 6 scoping (freelance discovery + optional AI) — or the follow-ups above if preferred.

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
