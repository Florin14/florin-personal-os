# Session State

Resume point for autonomous implementation sessions. Read this first, then
`docs/IMPLEMENTATION_PLAN.md` (task statuses) and `docs/DECISIONS.md`.

## Working agreement

- Mode: Autonomous Implementation Mode (requested 2026-11-08).
- Branch: `develop` (local commits only; nothing is pushed without approval).
- **User preference (2026-11-08): implementation only — do NOT write new tests.** Keep running
  ruff/mypy/tsc/eslint; existing test suites may be run as a regression guard.
- After each task: lint + types → update plan/this file → commit.
- Never: paid services, production deploys, real financial actions, invented credentials.

## Environment notes

- Dev stack: `docker compose up -d` (Postgres 127.0.0.1:5433, API :8000, UI :3000, worker).
  After adding Python deps: `docker compose build migrate && docker compose up -d`.
  After new migrations: `docker compose exec backend alembic upgrade head`.
- Local testing: `AUTH_REQUIRE_MFA=false` makes TOTP enrollment optional. Production
  always requires MFA. After changing the flag, recreate backend/worker and sign in again.
- Backend venv: `backend/.venv` (uv). Tests need
  `TEST_DATABASE_URL=postgresql+asyncpg://personal_os:<POSTGRES_PASSWORD from .env>@127.0.0.1:5433/personal_os_test`.
- Regenerate client after API changes:
  `cd backend && .venv/Scripts/python scripts/export_openapi.py ../frontend/openapi.json && cd ../frontend && npm run generate:api`.
- Windows host: Bash heredocs containing quotes sometimes break; write helper scripts to the
  session scratchpad and run them with `py`.
- Library majors: MUI 9 (no system props — use `sx`), React Router 8, Vite 8, Vitest 5,
  TS 5.9, ESLint 9, SQLAlchemy 2.1 (no `Result.tuples()`), FastAPI 0.16x, Starlette 1.x.

## Architecture snapshot (backend modules)

system · identity (sessions, TOTP, step-up, admin flag) · workspaces · audit (append-only) ·
jobs (+ worker, periodic tasks with advisory locks) · events (outbox → subscriber jobs, `*` wildcard) ·
notifications (in-app + channel adapters) · approvals (payload hash/version binding, risk policy) ·
automation (definitions, versions, engine, triggers, emergency stop, built-in actions) ·
integrations (encrypted connections, provider registry) · oblio (live + mock adapter) ·
invoicing (profiles, duplicate-safe monthly invoices, SPV) · discord (signed interactions, channel adapter).

## Current status

- Phase 0, Phase 1: COMPLETED (CI not yet run on GitHub).
- Phase 2: COMPLETED. Phase 3: COMPLETED (Oblio verified in mock mode end-to-end; live Oblio/Discord
  need credentials).
- Smoke script for the invoice workflow: scratchpad `smoke_invoice.py` (run with
  `docker compose exec -T backend python - < smoke_invoice.py`).

## Completed milestones

| Date | Milestone |
|---|---|
| 2026-11-08 | Phase 0 docs + Phase 1 foundation |
| 2026-11-08 | Phase 2 backend: audit, jobs/worker, events/outbox, notifications, approvals, automation engine, scheduling |
| 2026-11-08 | Phase 2 UI (approvals, executions, network, builder) |
| 2026-11-08 | Phase 3: integrations, Oblio, invoicing, Discord, UI |
| 2026-11-09 | Redesign FR-3: visual Workflow Builder + Automation Network; MUI removed |

## Blockers

| Item | Blocker | Workaround |
|---|---|---|
| GitHub Actions run | Changes not pushed (push needs approval) | Workflows validated locally |
| Live Oblio | No credentials | Mock mode (ADR-018 lists what to verify) |
| Live Discord | No bot credentials | Signature/flow implemented per docs; untested live |
| Google APIs (Phase 4) | No OAuth client credentials | Implement OAuth + adapters per docs, mock mode |

## In progress: frontend redesign (owner request 2026-11-08)

Owner asked to replace MUI with Tailwind v4 + shadcn-style Radix primitives + Motion + Lucide +
Recharts + React Flow ("neural command center", morphcanvas.com reference). Owner company:
FLOZITECH SRL (single employee = owner = administrator).

**Stable checkpoint (2026-11-08, end of day):** typecheck 0 errors, production build OK, all
routes smoke-tested in Chromium without runtime errors (desktop + mobile).

Done (new design):
- Design system: `src/styles/globals.css` tokens, `src/components/ui/{button,form,overlay,surface,alert}.tsx`
- Shell: collapsible sidebar, Ctrl+K command palette, health, notifications, profile, mobile drawer
- Command Center (`src/features/command/*`): neural React Flow map of 9 modules with real data,
  context panel, approvals / upcoming / finance chart / activity / system status sections
- Migrated: auth, settings, approvals, executions (+jobs, emergency stop), business, integrations
  (+Google OAuth connect), calendar & tasks, NEW finance page (documents upload + expenses),
  placeholders, 404.
- Workflow Builder (2026-11-09, FR-3): `builderModel.ts` (model + editing ops + client
  validation mirroring `definition.py`), `builderGraph.ts` (longest-path layering + barycentric
  columns, run overlay mapping), `WorkflowCanvas.tsx` (typed node/edge components),
  `StepInspector.tsx` (typed forms; action params from the catalog's JSON schema; keys commit on
  blur/Enter so partial typing never rewires references), `WorkflowEditor.tsx` (definition is the
  single source of truth; Visual/JSON tabs; drag-to-connect; run panel stays in place and overlays
  the execution; versions can be loaded back), gallery landing page, Automation Network.
  `useAutomationExecutions` hook added. Number params stay strings unless typed `integer`
  (server parses Decimal; never float for money).
- `@mui/*` and `@emotion/*` removed from package.json; `grep @mui|@emotion src` is empty.

- FR-4 (2026-11-09): ESLint (0 problems), Prettier and `tsc` clean on the whole frontend; all
  Vitest suites pass (43 tests; the obsolete theme-switch test was removed — the redesign is
  dark-only); production build OK; all 13 routes smoke-tested in Chromium with 0 runtime errors.

Remaining (resume here):
1. FR-5 docs: ARCHITECTURE §4.4 + ADR superseding ADR-010 for the Tailwind/shadcn stack.
2. Then continue Phase 5 (bank CSV import, reconciliation, shopping/price tracking).

Dev-server note: an old Vite instance owns 127.0.0.1:3000 (PID shows as 0, not killable from the
agent shell) and its dep cache predates the MUI removal, so it answers 504 "outdated optimize
dep". Restart whatever owns :3000 (or `docker compose build frontend && docker compose up -d
frontend`). For agent smoke tests on another port, the backend only trusts
`Origin: http://localhost:3000`, so the Vite proxy must send that header (`headers: { origin }`).
