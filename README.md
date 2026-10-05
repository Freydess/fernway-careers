# Fernway Employment Backend

FastAPI backend for Fernway's two-sided job marketplace, with seeker and employer accounts, profiles, job search, applications and in-app notifications under `/api/v2`. The existing intake, Typeform, admin review and sync API remains under `/api/v1`. Local development uses SQLite and disables external integrations. See [the marketplace handoff](docs/marketplace-handoff.md) for the complete contract, Render settings, local frontend testing, and ready-to-paste Neon migration/seed commands.

## Current result

- Separate candidates and applications, with legacy candidate/role and marketplace candidate/job uniqueness.
- Cookie sessions, Argon2id passwords, profile snapshots, ownership checks, CSRF protection, and persistent rate limits.
- Employer job posting and review, versioned decisions, and account-specific notifications.
- Strict intake validation, explicit consent, separate portfolio/resume fields, experience and compensation types.
- Signed Typeform completion webhooks and API idempotency keys.
- Admin review, allowed hiring-stage transitions, optimistic version checks, and status history.
- Durable integration jobs created in the same transaction as the application; bounded retries, lease recovery, and failure inspection.
- Exclusive direct HubSpot + Notion mode or Zapier mode, so both routes cannot accidentally run together.
- Alembic migrations, pinned dependencies, tests, and PostgreSQL deployment configuration.

The supplied file has formatting and specification problems. See [the blueprint review](docs/blueprint-review.md) for the corrections and the scope boundaries.

## Run on this computer

The virtual environment, random local API secrets, and migrated SQLite database have been created. From PowerShell in this directory:

```powershell
.\scripts\run.ps1 api
```

Open `http://127.0.0.1:8000/docs` for API documentation. `GET /health` confirms the process is running; `GET /ready` verifies the database migration. The server binds to this computer's loopback address by default.

In another PowerShell terminal:

```powershell
.\scripts\run.ps1 test
.\scripts\run.ps1 smoke
```

The smoke test makes real HTTP requests with synthetic data and retains one sample application. External syncing remains disabled. Run it against local development only.

## Set up on another computer

Install Python 3.12 or newer, then:

```powershell
.\scripts\setup.ps1
.\scripts\run.ps1 api
```

Pass `-PythonPath 'C:\path\to\python.exe'` to the setup script if Python is not on PATH. Setup creates `.venv`, installs `requirements.txt`, generates `.env` only if absent, and runs migrations. On macOS/Linux, use the corresponding `.venv/bin/python` commands.

Do not commit `.env` or `data/`. They are ignored. Separate random admin and intake tokens are generated locally; they are never printed by setup. Retrieve the token you need from `.env` privately. The placeholder values in `.env.example` deliberately fail configuration checks.

## API contract

| Method / path | Authentication | Purpose |
| --- | --- | --- |
| `GET /health`, `GET /ready` | None | Process / database readiness |
| `POST /api/v1/intake` | Intake bearer token + `Idempotency-Key` | Submit a completed candidate application |
| `POST /api/v1/webhooks/typeform` | Typeform HMAC signature | Receive a completed, allowlisted form response |
| `GET /api/v1/applications` | Admin bearer token | Paginated review; optional `status` / `target_role` filters |
| `GET /api/v1/applications/{id}` | Admin bearer token | Read application and candidate fields |
| `PATCH /api/v1/applications/{id}/status` | Admin bearer token | Change stage using `expected_version` |
| `GET /api/v1/applications/{id}/history` | Admin bearer token | Review status changes |
| `POST /api/v1/applications/{id}/sync` | Admin bearer token | Queue the current application in the configured sync mode |
| `GET /api/v1/sync-jobs` | Admin bearer token | Inspect paginated job outcomes without payloads or lease secrets |
| `POST /api/v1/sync-jobs/{id}/retry` | Admin bearer token | Retry a failed job when no newer revision exists |

V1 uses `Authorization: Bearer <token>`. Intake and admin permissions use different secrets. Do not embed either secret in a website, Typeform hidden field, or client-side chatbot. V2 uses HTTP-only sessions through the same-origin Vite/Vercel proxy, and never needs an admin/intake token in the browser. CORS starts empty and can be explicitly configured for an internal client.

`examples/application.json` is a valid payload. Required fields: `full_name`, `email`, `target_role`, and `consent_to_process: true`. Optional fields may be absent; reapplication is a full intake replacement, so omitted optional values are cleared. API validation rejects unknown keys, invalid URLs, unsupported choices, and inconsistent compensation. Resume and portfolio URLs must use HTTPS; the backend does not download them.

V1 email is trimmed and lowercased for deduplication; plus suffixes and dots are preserved. An identical normalized payload and idempotency key returns the existing submission with `duplicate: true`. Reusing the key with different data returns 409. A new key updates the same legacy candidate/role application and increments its version. A different role creates a new application for the same candidate. Terminal applications retain their terminal stage when resubmitted. V2 stores a distinct application per job and rejects duplicate applications; v1 intake does not edit marketplace applications.

Status update example:

```json
{"status": "screening", "expected_version": 1}
```

Stages: `new_applicants → screening → interview → offered → hired`. Active stages can become `rejected` or `withdrawn` with a reason. Terminal stages cannot be reopened through this endpoint. Read the current version before updating; a stale version returns 409.

## Database

The original tables (`candidates`, `applications`, `intake_receipts`, `status_events`, `sync_jobs`) are joined by `users`, `sessions`, `employers`, `seeker_profiles`, `jobs`, `notifications`, and `rate_limit_buckets`. Foreign keys, stage/role checks, compensation/experience bounds, partial candidate/role and candidate/job unique indexes, event uniqueness, and job-revision uniqueness are defined in migrations. Timestamps use UTC and responses use the `Z` suffix. Monetary values use decimals, not binary floating point.

```powershell
.\scripts\run.ps1 migrate
.\.venv\Scripts\python.exe -m alembic check
```

Changing `DATABASE_URL` to `postgresql+psycopg://...` and running migrations creates the same schema on PostgreSQL. Changing the URL does **not** copy SQLite data. A data transfer would be a separate step.

`compose.yaml` provides PostgreSQL, a migration job, API, and a standalone worker. The API Docker image now includes its supervised worker. For that optional deployment, add a random URL-safe `POSTGRES_PASSWORD` to `.env`, install Docker, and run `docker compose up --build api` to start the API, its worker, and database dependencies. Docker and a PostgreSQL server are not available on this computer, so this configuration has not been executed here. PostgreSQL migration SQL generation is tested; live PostgreSQL transactions are not yet verified.

## Integrations and worker

See [integration setup and field mappings](docs/integrations.md). Keep `SYNC_MODE=disabled` until accounts and schemas are ready. In disabled mode, new submissions create no outbound jobs. Enable your chosen mode and use the admin application sync endpoint to queue existing local applications.

```powershell
.\scripts\run.ps1 worker
# Or drain currently ready jobs and exit:
.\.venv\Scripts\python.exe -m app.worker --once
```

Run one worker initially. Jobs are leased for five minutes; abandoned leases are recoverable. Transient network, rate-limit, and server failures retry with exponential delay, honoring numeric `Retry-After` values up to one hour. Configuration/authentication/schema failures become `dead`; inspect and retry after correcting settings. Credentials and remote response bodies are not stored in job errors. Adapter calls occur outside application transactions.

The API acknowledges durable local storage, not completed external delivery. Inspect jobs to confirm delivery. Transport is at least once: receivers must deduplicate, especially Zapier. The Notion adapter searches for an existing Application ID after an uncertain create response, but external APIs do not provide a distributed transaction with this database; absolute exactly-once behavior is not guaranteed.

## Verification and remaining setup

Tests use a migrated temporary SQLite database and mock external HTTP responses. They cover auth separation, validation, concurrent duplicate delivery, transaction rollback, multiple roles, status/history behavior, signed webhooks, mappings, retry ordering, permanent errors, lease recovery, and PostgreSQL migration SQL generation. No tests require real credentials or create cloud records.

Local implementation and tests are complete; cloud deployment and frontend live-mode testing remain separate steps. In-app notifications are implemented; email notifications are planned through Zapier from Notion. Password reset, email verification, binary resume uploads, multiple recruiters per company, employer seeker search, direct user messaging, and bidirectional Notion edits remain outside this version. Matching and Fern's profile assistant run in the existing frontend.
