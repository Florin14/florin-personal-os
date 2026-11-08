# Session State

Resume point for autonomous implementation sessions. Read this first, then
`docs/IMPLEMENTATION_PLAN.md`.

## Working agreement

- Mode: Autonomous Implementation Mode (requested 2026-11-08).
- Branch: `develop` (local commits only; nothing is pushed without approval).
- After each task: tests + lint + types → update plan/this file → commit.
- Never: paid services, production deploys, real financial actions, invented credentials.

## Environment notes

- Dev stack: `docker compose up -d` (Postgres on 127.0.0.1:5433, API :8000, UI :5173).
- Backend venv: `backend/.venv` (uv). Tests: `TEST_DATABASE_URL=postgresql+asyncpg://personal_os:<pw>@127.0.0.1:5433/personal_os_test`
  or `docker compose exec backend pytest`.
- Frontend: `cd frontend && npm test | npm run lint | npx tsc -b --noEmit | npx playwright test`.
- Windows host: Bash heredocs with apostrophes occasionally break; prefer the Write tool for source files.
- Library majors: MUI 9 (no system props — use `sx`), React Router 8, Vite 8, Vitest 5, TS 5.9, ESLint 9.

## Current status

- Phase 0: COMPLETED. Phase 1: COMPLETED locally (CI not yet run on GitHub).
- Current task: see "Next actions".

## Completed milestones

| Date | Milestone | Commit |
|---|---|---|
| 2026-11-08 | Phase 0 docs + Phase 1 foundation | (see git log) |

## Blockers

| Item | Blocker | Workaround |
|---|---|---|
| GitHub Actions run | Changes not pushed (push needs approval) | Workflows validated locally |

## Next actions

1. Phase 2: audit module.
2. Phase 2: events + transactional outbox, jobs + worker.
