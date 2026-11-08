
# Personal OS — Claude Code Instructions

## 1. Project Context

You are working on Personal OS, a secure, modular,
self-hosted personal automation platform.

The application manages personal and business
workflows, financial documents, calendar events,
notifications, shopping intelligence, freelance
opportunities, and future smart-home integrations.

The primary user is an experienced full-stack
developer working with React, TypeScript, Python,
FastAPI, PostgreSQL, and Docker.

## 2. Source of Truth

Before making architectural decisions or implementing
new features, read:

- docs/PROJECT_SPEC.md
- docs/ARCHITECTURE.md (if available)
- docs/IMPLEMENTATION_PLAN.md (if available)
- docs/DECISIONS.md (if available)

PROJECT_SPEC.md defines the product requirements.

If the specification conflicts with existing code,
identify the conflict and propose a resolution.

Do not silently change established architectural
decisions.

## 3. Development Principles

Follow these principles:

- Prefer simplicity over unnecessary complexity.
- Build production-quality, maintainable code.
- Follow SOLID principles where appropriate.
- Avoid overengineering and premature optimization.
- Prefer established, well-maintained libraries.
- Keep business logic independent of frameworks.
- Use clear naming and consistent conventions.
- Avoid duplicated logic.
- Keep functions and modules focused.
- Implement features incrementally.
- Never introduce paid services without approval.

Do not add technologies simply because they are
popular.

## 4. Architecture

Use a modular monolith architecture.

Backend:
- Python
- FastAPI
- Pydantic v2
- SQLAlchemy 2
- Alembic
- PostgreSQL

Frontend:
- React
- Vite
- TypeScript (strict mode)
- Material UI
- TanStack Query
- Zustand when appropriate
- React Flow for automation visualization

Infrastructure:
- Docker
- Docker Compose
- GitHub Actions
- Private network access

Keep modules isolated.

Modules must communicate through clearly defined
interfaces, application services, or domain events.

Avoid direct dependencies on another module's
internal implementation.

Do not introduce microservices unless explicitly
requested.

## 5. Backend Rules

- Use async operations when appropriate.
- Use dependency injection for external services.
- Separate API routes from business logic.
- Use typed request and response schemas.
- Validate all external inputs.
- Use database transactions appropriately.
- Create Alembic migrations for schema changes.
- Never use floating-point types for money.
- Use UTC internally and explicit timezones.
- Implement idempotency for external side effects.
- Handle external API errors explicitly.
- Keep integration adapters replaceable.

Do not place business logic inside FastAPI routers.

## 6. Frontend Rules

- Use TypeScript strict mode.
- Prefer functional React components.
- Use reusable MUI components.
- Use TanStack Query for server state.
- Use Zustand only when shared client state is needed.
- Avoid unnecessary Redux.
- Separate API calls from presentation components.
- Implement loading, error, and empty states.
- Support responsive layouts.
- Support dark mode.
- Follow accessibility best practices.
- Avoid unnecessary re-renders.

Use a consistent design system.

## 7. Automation Engine Rules

Automations must support:

- Persistent execution state
- Scheduling
- Domain events
- Retries and timeouts
- Idempotency
- Approval workflows
- Execution history
- Audit logs
- Dry-run mode
- Safe failure recovery

Never execute arbitrary user-provided code.

Financial and irreversible actions must require
appropriate approval.

Do not assume external APIs provide exactly-once
execution guarantees.

## 8. Security Rules

Security is mandatory.

- Never hardcode credentials.
- Never commit secrets.
- Use environment variables or secure secret storage.
- Follow least-privilege principles.
- Validate authentication and authorization.
- Verify webhook signatures.
- Protect against CSRF, SSRF, and injection attacks.
- Avoid exposing sensitive data in logs.
- Encrypt sensitive stored credentials.
- Protect personal and business data separately.
- Never bypass third-party authentication.
- Never expose database services publicly.

Treat AI-generated outputs as untrusted data.

## 9. Integrations

All third-party integrations must use dedicated
provider adapters.

Examples:
- Oblio
- Discord
- Google Calendar
- Gmail
- Google Drive
- Banking providers
- Shopping providers
- Home Assistant

Do not invent API endpoints or capabilities.

Verify current official documentation before
implementing an integration.

If credentials are unavailable, create a mock
adapter with realistic test fixtures.

Never silently replace official integrations
with unauthorized scraping.

## 10. Testing and Quality

Every meaningful feature must include tests.

Use:
- Pytest for backend tests
- Vitest for frontend tests
- Playwright for critical E2E flows

Before marking a task complete:

1. Run relevant tests.
2. Run linting.
3. Run type checks.
4. Verify migrations where applicable.
5. Verify Docker configuration when changed.
6. Review security implications.
7. Document any incomplete functionality.

Never claim tests passed unless they were executed.

## 11. Documentation

Keep documentation updated as the project evolves.

Maintain:

- docs/ARCHITECTURE.md
- docs/IMPLEMENTATION_PLAN.md
- docs/DECISIONS.md

Document new integrations, environment variables,
important commands, and deployment changes.

When an architectural decision is made, record
its motivation and tradeoffs.

## 12. Implementation Workflow

Before implementing a major feature:

1. Read the relevant documentation.
2. Inspect the existing architecture.
3. Identify dependencies.
4. Define a short implementation plan.
5. Implement incrementally.
6. Add tests.
7. Verify functionality.
8. Update documentation.

Do not rewrite unrelated code.

Avoid large, unrelated refactors.

Prefer small, focused changes.

## 13. Project Progress

Use docs/IMPLEMENTATION_PLAN.md to track progress.

Maintain clear task statuses:

- TODO
- IN PROGRESS
- COMPLETED
- BLOCKED

Only mark tasks COMPLETED after implementation
and appropriate verification.

At the end of each implementation session,
summarize:

- What was implemented
- Files changed
- Tests executed and results
- Known limitations
- Next recommended task

## 14. Cost Constraints

The project must remain inexpensive to operate.

Prefer:
- Open-source libraries
- Self-hosted components
- Existing VPS infrastructure
- Free API tiers where appropriate

Avoid:
- Mandatory paid AI providers
- Unnecessary cloud services
- Kubernetes
- Complex distributed infrastructure
- Excessive resource consumption

All optional integrations must be independently
configurable and disableable.

## 15. Working Autonomy

Make reasonable implementation decisions without
asking for confirmation on minor technical details.

Ask for approval before:
- Introducing paid dependencies
- Changing core architecture
- Performing destructive database operations
- Deploying to production
- Executing real financial operations
- Modifying external production resources

Never assume an external action was successful
without verifying its result.

## 16. Primary Objective

Build a secure, scalable, maintainable Personal OS
that is easy to extend with new modules.

Prioritize reliability, developer experience,
low operating costs, and practical usefulness
over unnecessary complexity.
