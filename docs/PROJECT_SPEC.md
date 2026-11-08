# PERSONAL OS — Master Implementation Specification

## 1. Project Mission

You are acting as a senior software architect, security engineer, frontend engineer, backend engineer, and DevOps engineer.

Your responsibility is to design and implement **Personal OS**, a secure, modular, extensible, event-driven personal automation platform.

The application is primarily intended for one technically experienced Romanian software developer who also operates a Romanian SRL. It may later support a small number of explicitly authorized users, such as a partner.

The main objectives are:

1. Automate recurring personal and business operations.
2. Reduce repetitive manual work.
3. Improve financial visibility and identify savings.
4. Discover relevant freelance opportunities.
5. Provide contextual recommendations.
6. Integrate calendars, documents, invoices, notifications, shopping, and smart-home systems.
7. Provide a beautiful, interactive dashboard inspired by connected neural networks.
8. Preserve privacy, security, data ownership, low operational cost, and maintainability.

The application should be autonomous wherever safe, but must request approval for sensitive, financial, irreversible, or externally consequential actions.

**This is a real production-oriented personal application, not a prototype or demo.**

## 2. Developer Background

The project owner has professional experience with:

- React, TypeScript, JavaScript, Next.js, Material UI
- Python, FastAPI, SQLAlchemy, Pydantic
- PostgreSQL
- Docker and Docker Compose
- GitHub Actions, CI/CD, VPS hosting
- REST APIs, authentication, background jobs, and web applications

Prefer established technologies from this stack.

Do not introduce unnecessary infrastructure, technologies, microservices, or paid services.

## 3. Core Architectural Decisions

Build a modular monolith with explicit module boundaries and event-driven communication.

The system must include:

- React + Vite + TypeScript frontend
- MUI-based component design system
- TanStack Query for server state
- Zustand for limited shared client state
- React Flow for visual workflow editing
- FastAPI backend
- Pydantic v2
- SQLAlchemy 2 and Alembic
- PostgreSQL
- Persistent background job processing
- Scheduler with timezone support
- Integration adapters
- Generic notification and approval services
- Docker Compose deployment
- GitHub Actions CI/CD
- Automated tests
- Audit logs and monitoring

Initially prefer PostgreSQL-backed jobs and a single worker to minimize infrastructure requirements.

Introduce Redis and an appropriate worker queue only when reliability, concurrency, or throughput requirements justify them.

Do not implement Kubernetes or a microservice architecture for the MVP.

Separate business logic from external services using well-defined interfaces.

External API providers must be replaceable without rewriting domain logic.

## 4. Domain Modules

Design clear extension points for:

- Identity & Authentication
- Users & Permissions
- Organizations / Personal Workspaces
- Automation Engine
- Scheduling & Recurring Tasks
- Event Bus
- Integration Management
- Notifications
- Approvals
- Audit & Observability
- Accounting & Invoicing
- Banking & Reconciliation
- Document Management
- Calendar & Reminders
- Shopping & Price Tracking
- Career & Freelance Opportunities
- Smart Home
- Location & Context
- Health & Lifestyle
- Relationships & Shared Planning
- AI & Recommendations

Not every module must be implemented immediately.

Future modules must be registerable without modifying unrelated domain modules.

## 5. Automation Engine

Build a generic automation system supporting:

### Triggers

- Manual execution
- Cron expressions
- Fixed intervals
- Webhook events
- Domain events
- External provider events
- State changes
- Conditional triggers

### Workflow steps

- Typed actions
- Conditions
- Branching
- Approval gates
- Delays
- Notifications
- Controlled retries

### Execution guarantees

- Durable job storage
- Restart recovery
- Idempotency keys
- Concurrency controls
- Retry with exponential backoff
- Timeouts
- Failure classification
- Dead-letter or failed-job inspection
- Audit logging
- Execution history
- Dry-run mode
- Workflow versioning
- Safe cancellation

Use a transactional outbox pattern where consistency between database changes and event publication matters.

Do not claim exactly-once execution of arbitrary external side effects. Design for at-least-once processing with idempotency, reconciliation, and provider-specific safeguards.

An approved action must be bound to the exact version and parameters the user approved. Changes invalidate the approval.

Do not execute arbitrary user-provided Python, JavaScript, SQL, shell commands, or unrestricted HTTP requests from workflow definitions.

## 6. Integration Framework

Create a provider-adapter architecture supporting:

- Provider configuration
- Connection status
- OAuth authentication where supported
- Token refresh
- Credential rotation
- Capability declarations
- Permission scopes
- Health checks
- Rate limits
- Retries
- Webhook verification
- Provider error normalization
- Mock implementations for tests

Provider credentials must never appear in frontend bundles, URLs, ordinary logs, or exported workflow definitions.

Required integrations:

### Oblio

Use the official Oblio REST API.

Support:

- Connection configuration
- Client and product metadata
- Invoice preparation
- Invoice issuance
- Invoice retrieval
- Email sending where configured
- SPV submission/status verification where supported
- Document archival
- Duplicate prevention using stable idempotency keys

Implement a recurring monthly invoice workflow.

The workflow must initially require manual approval before issuance.

Handle timezone, billing period, invoice series, tax configuration, service descriptions, currency, and due dates as explicit settings.

Never fabricate fiscal rules or invoice values.

### Discord

Implement a private Discord bot supporting:

- Notifications
- Slash commands
- Approval requests
- Approve/reject interactions
- Status requests
- Error notifications
- Optional quick task creation

Verify interaction signatures and authenticated user identities.

Restrict actions to allowlisted Discord users and configured channels.

Do not expose confidential invoice, banking, or personal data unnecessarily.

High-risk actions must require an authenticated in-app confirmation.

### Google Calendar

Implement OAuth-based integration supporting:

- Read calendars/events
- Create events
- Update events
- Recurring reminders
- Availability queries
- Manual and automated task scheduling

Use minimal OAuth scopes and handle token expiration, revoked access, and quota limits.

### Gmail and Google Drive

Support authorized email/document discovery, invoice attachments, receipt archival, and accountant-ready folders.

Use minimal permissions and respect Google API policies.

Avoid duplicate processing.

Keep personal and business document access separated.

### Banking

Start with safe file-based statement import.

Support CSV initially and additional formats through replaceable parsers.

Create a future Open Banking provider interface.

Do not assume unrestricted access to BT Go or BT Pay APIs.

Never collect banking passwords, bypass authentication, or automate banking UI login.

Reconciliation should match transactions and documents using deterministic rules, confidence scoring, and manual review for uncertain matches.

### eMAG and Shopping

Implement a generic shopping provider abstraction.

Support:

- Manual product URLs
- Canonical product identity
- Price observations
- Price history
- Price alerts
- Merchant comparison
- Stock availability
- User-defined purchase thresholds
- Confirmation workflows

Do not assume eMAG Marketplace seller APIs can access ordinary consumer purchases.

Use authorized email-derived information, documented APIs, licensed data sources, and compliant integrations.

Do not bypass captchas, anti-bot restrictions, or authentication controls.

Automatic checkout is not a requirement for the MVP.

### Home Assistant

Integrate through documented APIs.

Support device discovery, state retrieval, approved commands, and automation events.

Prefer local control.

Prevent unsafe repeated toggling and provide manual overrides.

## 7. Database and Data Architecture

Use PostgreSQL as the primary transactional database.

Propose normalized schemas for:

- Users
- Workspaces
- Memberships
- Integration connections
- Encrypted credentials metadata
- Automations
- Automation versions
- Triggers
- Workflow executions
- Step executions
- Scheduled jobs
- Events
- Outbox entries
- Approval requests
- Notifications
- Audit records
- Documents and attachments
- Invoices
- Bank transactions
- Reconciliation matches
- Products and merchants
- Price observations
- Opportunity listings
- User preferences
- Device states
- Location rules

Use appropriate unique constraints, foreign keys, indexes, retention policies, and migration scripts.

Use UTC timestamps internally while preserving relevant local timezones and recurrence semantics.

Use precise decimal types for financial amounts. Never use floating-point types for money.

Model personal/business separation explicitly and enforce it in all data access paths.

Store document metadata in PostgreSQL and actual binary content in an appropriate storage backend.

## 8. Frontend UX/UI

The product should feel like a premium personal command center.

Design direction:

- Dark-mode-first
- Clean typography
- High contrast and accessible components
- Modern card-based dashboards
- Restrained glass-like visual effects
- Smooth transitions
- Interactive node connections
- Responsive layouts
- Mobile-friendly PWA
- Consistent icons and states

Create these application areas:

1. Overview Dashboard
2. Automation Network
3. Workflow Builder
4. Executions & Logs
5. Approval Inbox
6. Finance
7. Business & Accounting
8. Shopping Tracker
9. Calendar & Tasks
10. Freelance Opportunities
11. Smart Home
12. Integrations
13. Settings & Security

The network overview and workflow editor must be separate experiences.

Do not sacrifice usability for visual effects.

Include loading, empty, error, disconnected, unauthorized, and offline states.

Provide accessible keyboard navigation and reduced-motion support.

Use Recharts for analytics and React Flow for visual automation graphs.

Generate typed API clients from the FastAPI OpenAPI schema where appropriate.

## 9. Security Requirements

Treat security as a release-blocking requirement.

Implement:

- Authentication with MFA or passkeys
- Strict authorization and workspace isolation
- Secure session handling
- CSRF protection where applicable
- Validated CORS configuration
- HTTPS for applicable endpoints
- Private VPN-first deployment
- Encrypted secrets
- Minimal provider permissions
- OAuth token rotation/revocation handling
- Webhook signature verification
- Replay protection
- Input validation
- SSRF protection
- Safe file-upload handling
- Sensitive-data redaction
- Structured audit logs
- Rate limiting
- Secure backups
- Dependency and container vulnerability scanning
- No unnecessary public database exposure
- Emergency stop for side-effecting automations

Define risk-based approval policies.

A Discord approval alone must not authorize banking transfers, destructive administrative operations, or other high-risk actions.

AI output must be treated as untrusted input.

Do not send sensitive documents, bank statements, credentials, or precise location data to external AI providers without explicit permission and suitable safeguards.

## 10. AI Architecture

AI must remain optional.

Implement a replaceable AI provider interface supporting:

- Disabled mode
- Configurable cloud provider
- Optional Ollama/local provider
- Request budgeting
- Usage tracking
- Model configuration
- Safe tool-calling
- Structured outputs
- Failure handling

Use deterministic logic wherever possible.

AI can assist with:

- Document classification
- Receipt understanding
- Ambiguous transaction classification
- Product recommendations
- Freelance opportunity matching
- Summarization
- Natural-language task creation
- Recommendation explanations

AI must not autonomously perform financial transactions or irreversible actions.

Do not require a paid AI API for core features.

## 11. Deployment and Operations

Provide:

- Dockerfiles
- Docker Compose development and production configuration
- Environment variable examples
- PostgreSQL persistent volumes
- Health checks
- Safe startup and migration process
- GitHub Actions workflows
- Deployment documentation
- Backup and restore scripts
- Log rotation
- Basic resource monitoring
- Recovery instructions

The system must run on an existing Linux VPS.

Document how a future Raspberry Pi or mini PC could connect as a private Home Assistant node.

Do not require Raspberry Pi hardware for the MVP.

Prefer a private WireGuard-based or otherwise appropriately licensed secure network.

Make optional services configurable and disabled by default.

Target low idle resource consumption.

## 12. Testing Requirements

Implement:

- Backend unit tests
- API integration tests
- Frontend component tests
- Workflow engine tests
- Approval state machine tests
- Duplicate prevention tests
- Provider adapter contract tests
- Mock provider responses
- Authentication and authorization tests
- Database migration tests
- E2E tests for critical workflows

Critical scenarios:

- A restarted worker must not issue duplicate invoices.
- An expired approval must not execute.
- A changed action payload invalidates a previous approval.
- A revoked OAuth credential stops the affected workflow safely.
- A third party cannot approve another user's action.
- Provider timeouts must be recoverable.
- Failed jobs must be visible and inspectable.
- Backup restoration must be verifiable.

## 13. Cost Control

Prefer free and self-hosted technologies when appropriate.

Document all potentially paid dependencies.

Never silently add a paid service.

Implement configurable budgets for AI usage and external API usage.

Design the application so that optional integrations can be disabled without affecting the core system.

A new feature must not require additional infrastructure unless justified.

## 14. Implementation Process

Do not attempt to implement the entire product in one giant code-generation pass.

Work incrementally using the following phases.

Phase 0: Architecture, requirements validation, project structure, architecture decision records, implementation backlog.

Phase 1: Backend/frontend foundation, database, authentication, Docker, CI, and basic dashboard.

Phase 2: Automation engine, persistent jobs, scheduler, events, approvals, notifications, audit.

Phase 3: Discord bot and Oblio monthly invoicing workflow.

Phase 4: Google Calendar, Gmail, Drive, documents, basic expense processing.

Phase 5: Finance imports, reconciliation, shopping and price tracking.

Phase 6: Freelance opportunity discovery and optional AI assistance.

Phase 7: Home Assistant, location, health, lifestyle, and shared planning.

Phase 8: Performance, monitoring, security hardening, disaster recovery, and scaling improvements.

For every phase:

1. Define scope and acceptance criteria.
2. Document important architectural decisions.
3. Implement working code.
4. Add automated tests.
5. Update API and operational documentation.
6. Verify Docker-based execution.
7. Identify remaining risks and limitations.
8. Produce a concise completion report.

Do not claim a phase is complete unless the implementation exists and the tests or checks have actually been performed.

Never invent API capabilities, credentials, production access, or successful test results.

When external integration access is unavailable, implement a tested mock adapter and document the exact configuration required for live access.

## 15. Initial Deliverables

Start by producing:

- Architecture Decision Records
- System context diagram
- Container/deployment diagram
- Module boundaries and dependency rules
- Database schema proposal
- Automation execution lifecycle
- Integration capability matrix
- Threat model
- MVP backlog
- Cost assumptions
- Step-by-step setup checklist
- Repository structure

Then implement Phase 1.

Preserve the long-term architectural principles without overengineering the first release.

The final objective is a secure, maintainable, low-cost personal automation platform that can grow module by module for years.
