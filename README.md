# Personal OS

A secure, modular, self-hosted personal automation platform: a modular monolith
(FastAPI + PostgreSQL) with a React/Tailwind/Radix command-center UI, deployed with Docker Compose.

**Status:** Phase 7 in progress — Smart Home discovery and guarded controls are implemented
(mock walkthrough verified; real Home Assistant hardware not yet tested). See
[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

| Document | Purpose |
|---|---|
| [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) | Product requirements (source of truth) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, module rules, schema, threat model, costs |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision records |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phases, backlog, progress |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment on a VPS |

## Quick start (development)

Requirements: Docker with Compose v2. (Node 24 and Python 3.13 + uv only for running tools outside containers.)

1. **Create the environment file**

   ```bash
   cp .env.example .env
   ```

   Fill in `POSTGRES_PASSWORD` (e.g. `openssl rand -hex 24`) and `ENCRYPTION_KEYS`:

   ```bash
   python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
   ```

2. **Start the stack** (Postgres → migrations → API → Vite dev server)

   ```bash
   docker compose up --build
   ```

3. **Create your user** (password is prompted, never passed as an argument)

   ```bash
   docker compose exec backend python -m app.cli create-user \
       --email you@example.com --display-name "Your Name" --business-workspace "Your SRL"
   ```

4. Open **http://localhost:3000** (use `localhost`, not `127.0.0.1` — the origin must match
   `ALLOWED_ORIGINS`). Sign in with your email and password. Authenticator app (TOTP)
   enrollment is optional locally (`AUTH_REQUIRE_MFA=false`). Set it to `true` to test
   mandatory enrollment, then recreate the backend with `docker compose up -d backend worker`.

| Service | URL (bound to 127.0.0.1 only) |
|---|---|
| Web UI (Vite, hot reload) | http://localhost:3000 |
| API + Swagger UI (dev only) | http://localhost:8000/api/docs |
| PostgreSQL | `localhost:5433` (`POSTGRES_HOST_PORT`) |

To run the frontend directly on your host, keep the backend running on
`http://localhost:8000` and run:

```bash
# Stop the frontend container first if it is already using port 3000.
docker compose stop frontend
cd frontend
npm ci
npm run dev
```

Vite serves **http://localhost:3000** and proxies `/api` to the backend.

## Common commands

```bash
# Backend checks (inside the running container)
docker compose exec backend pytest
docker compose exec backend ruff check app tests && docker compose exec backend ruff format --check app tests
docker compose exec backend mypy app tests

# New migration after changing models
docker compose exec backend alembic revision --autogenerate -m "describe change"
docker compose exec backend alembic upgrade head

# Admin CLI
docker compose exec backend python -m app.cli --help          # create-user, create-workspace, reset-mfa, generate-key

# Frontend checks (from ./frontend, after `npm ci`)
npm run lint && npm run typecheck && npm test && npm run build

# Regenerate the typed API client after backend API changes
cd backend && uv run python scripts/export_openapi.py ../frontend/openapi.json
cd ../frontend && npm run generate:api

# End-to-end tests against the running dev stack
cd frontend && npx playwright install chromium && npm run test:e2e
```

Running backend tests outside Docker: `cd backend && uv sync`, then set
`TEST_DATABASE_URL=postgresql+asyncpg://personal_os:<password>@127.0.0.1:5433/personal_os_test`
and run `uv run pytest`. The test database is created automatically by the dev Postgres container.
**The test suite drops and recreates the schema of that database.**

## Repository layout

```
backend/    FastAPI modular monolith (app/core, app/modules/<module>, migrations, tests)
frontend/   React + Vite + TypeScript + Tailwind/Radix (src/, e2e/, nginx/)
infra/      Postgres init scripts for development
docs/       Specification, architecture, decisions, plan, deployment
.github/    CI and security scanning workflows
```

## Security notes

* No public sign-up. Users are created with the CLI.
* MFA (TOTP) is optional for local testing (`AUTH_REQUIRE_MFA=false`) and mandatory in
  production. Accounts that already enabled MFA still require their authenticator code.
* Never commit `.env`. Rotate `ENCRYPTION_KEYS` by prepending a new key (see ADR-006).
* Lost authenticator: `docker compose exec backend python -m app.cli reset-mfa --email <email>`.
