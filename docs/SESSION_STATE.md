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

Remaining (resume here):
1. Workflow Builder redesign: `src/features/workflows/builderModel.ts` is written (model, new
   step/trigger helpers, successors). Still to do: custom React Flow node component (trigger /
   condition / action / approval / notify / delay / integration), inspector panel with typed
   forms synced to JSON, execution-state overlay; then rewrite `WorkflowBuilderPage.tsx`,
   `WorkflowEditor.tsx`, `FlowCanvas.tsx`, `NetworkPage.tsx` (these 4 still use MUI).
2. Remove `@mui/*` and `@emotion/*` deps once `grep -rln @mui frontend/src` is empty.
3. Update existing Vitest tests to the new markup (they were written for MUI and are not
   expected to pass yet); run ESLint/Prettier on the whole frontend.
4. Docs: ARCHITECTURE §4.4 + ADR-010 superseded by new ADR for the Tailwind/shadcn stack.
5. Then continue Phase 5 (bank CSV import, reconciliation, shopping/price tracking).
