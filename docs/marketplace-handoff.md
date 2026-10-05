# Fernway backend handoff

Implemented locally from `frontend/docs/codex/brief-for-codex.md`. Frontend files were left unchanged. Nothing was pushed or deployed, and no cloud records were created.

## Changes

- `/api/v2` implements the account, profile, public job search/detail, employer company/jobs/review, application, and notification contracts in the brief. `/api/v1` keeps its intake, Typeform, review, and sync behavior.
- Passwords use Argon2id. Sessions store only a SHA-256 token digest, use a 30-day HTTP-only cookie with no Domain attribute, and are revoked on logout or account deactivation.
- Mutation endpoints enforce JSON and the Origin allowlist. All v2 responses, including errors, have `Cache-Control: no-store`. Rate limits are atomic database-backed windows, using the first forwarded IP and the normalized email or user ID.
- Every application stores an immutable profile snapshot, including the account name, email, phone, profile fields and skills. Candidate and Application still drive the existing integration queue.
- Acceptance from `new_applicants` records `screening` and `interview` in one transaction with two version increments and two sync revisions. Opening an application marks it screened once. Notifications belong only to the appropriate account.
- One migration, `0002_marketplace`, creates accounts, sessions, companies, profiles, jobs, notifications and rate-limit storage, and replaces candidate/role uniqueness with the two partial unique indexes. It preserves legacy application records and their receipt/history/sync records. Downgrade is refused after marketplace accounts exist.
- Docker runs `python -m app.start`: migrate first, then start the API and worker; restart an exited worker after five seconds when sync is enabled. Disabled sync starts the worker once, logs its disabled message, and keeps serving the API. Shutdown stops both children.
- HubSpot uses exactly ten custom properties plus standard name/contact fields. Notion receives `Job`, `Employer`, and `Employer Email` for marketplace applications.
- `scripts.seed_demo` reads the shared JSON, creates 8 accounts, 5 companies, 11 jobs, 3 profiles and 4 applications, and leaves existing records and passwords intact on subsequent runs.

## New settings

| Environment variable | Default | Where to set it |
| --- | --- | --- |
| `SESSION_COOKIE_SECURE` | `true` | Keep this on Render. `scripts/run.ps1 api` temporarily uses `false` for its plain-HTTP local server. |
| `ALLOWED_ORIGINS` | `["https://fernway-careers.vercel.app","http://localhost:5173"]` | Default covers the existing site and Vite. Override with a JSON array only if those origins change. |
| `PORT` | `8000` | Docker startup honors Render's port variable. This is a process environment variable, not a Settings field. |
| `DEMO_PASSWORD` | No default | Set privately in the PowerShell process running the seed. It is required only for creating demo accounts, and need not be set on Render. |

The existing Render settings remain required: `DATABASE_URL`, distinct `ADMIN_API_TOKEN` and `INTAKE_API_TOKEN` of at least 32 characters, and `SYNC_MODE=direct` once both destinations are configured. Direct sync also needs `HUBSPOT_ACCESS_TOKEN`, `NOTION_TOKEN` and `NOTION_DATA_SOURCE_ID`. `NOTION_API_VERSION` retains its existing default `2025-09-03`. Create the ten HubSpot properties from `docs/hubspot-properties.json` before enabling direct mode. The Notion text columns are listed in `docs/notion-schema.json`.

No new Render setting requires a value beyond the existing settings above. Secure cookies and the existing site allowlist are the defaults.

## Local frontend integration test

Run in PowerShell:

```powershell
Set-Location -LiteralPath 'C:\CMU\Y2S1\Digital tools\Final project'
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\scripts\run.ps1 api
```

This migrates the configured local SQLite database, then serves the API at `http://127.0.0.1:8000`. The existing Vite proxy forwards `/api/v2` there. In a second PowerShell window, seed that local database after privately choosing a demo password:

```powershell
Set-Location -LiteralPath 'C:\CMU\Y2S1\Digital tools\Final project'
$taskDemoPassword = Read-Host 'Choose a private demo password, 8 to 128 characters' -AsSecureString
$env:DEMO_PASSWORD = [System.Net.NetworkCredential]::new('', $taskDemoPassword).Password
try {
    .\.venv\Scripts\python.exe -m scripts.seed_demo
    if ($LASTEXITCODE -ne 0) { throw 'Demo seed failed.' }
} finally {
    Remove-Item Env:DEMO_PASSWORD -ErrorAction SilentlyContinue
    $taskDemoPassword.Dispose()
}
```

Use the owner and seeker emails in `frontend/shared/demo-data.json` with that password. `.example` addresses are accepted for the fictional demo accounts. Re-running the seed does not change any existing account's password. Signup also works for new accounts.

Claude can test the existing frontend in live mode locally. On the deployed site, `?backend=live` continues to target Render; it cannot reach this local API. Keep Vercel's site in demo mode until the backend is actually deployed and the integration test is complete.

## Migrate and seed Neon from this PC

These are ready-to-paste commands for the later deployment step. They were not run against Neon during this local implementation. In Neon, copy the SQLAlchemy-compatible pooled URL beginning `postgresql+psycopg://`, then paste it into the first hidden prompt. Paste or choose the demo password in the second hidden prompt. The existing local `.env` supplies the admin/intake settings needed to load backend configuration.

```powershell
Set-Location -LiteralPath 'C:\CMU\Y2S1\Digital tools\Final project'
$taskDatabaseInput = Read-Host 'Paste the Neon pooled SQLAlchemy URL' -AsSecureString
$taskDemoPassword = Read-Host 'Choose a private demo password, 8 to 128 characters' -AsSecureString
$taskPreviousDatabaseUrl = $env:DATABASE_URL
$taskPreviousSyncMode = $env:SYNC_MODE
$env:DATABASE_URL = [System.Net.NetworkCredential]::new('', $taskDatabaseInput).Password
$env:DEMO_PASSWORD = [System.Net.NetworkCredential]::new('', $taskDemoPassword).Password
$env:SYNC_MODE = 'disabled'
try {
    .\.venv\Scripts\python.exe -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw 'Neon migration failed; seed was not run.' }
    .\.venv\Scripts\python.exe -m scripts.seed_demo
    if ($LASTEXITCODE -ne 0) { throw 'Neon seed failed.' }
} finally {
    $env:DATABASE_URL = $taskPreviousDatabaseUrl
    $env:SYNC_MODE = $taskPreviousSyncMode
    Remove-Item Env:DEMO_PASSWORD -ErrorAction SilentlyContinue
    $taskDatabaseInput.Dispose()
    $taskDemoPassword.Dispose()
}
```

This seeds local data in Neon without queueing demo records for external sync. Real applications created with Render's direct mode queue sync normally. Use `POST /api/v1/applications/{id}/sync` with the admin token if you later want a seeded application sent to HubSpot/Notion. Docker also runs migrations on every container start, so a later approved push is sufficient for the schema upgrade; this manual migration can be used before seeding.

## Validation and limits

Completed locally on 5 October 2026: **58 tests passed**, with one existing Starlette/httpx deprecation warning. The real container startup command also passed an HTTP smoke test (`/health`, `/ready`, `/api/v2/jobs` all returned 200, with the v2 no-store header), and the disabled worker message was verified. The temporary smoke server was stopped. The local SQLite database was backed up, migrated to `0002_marketplace`, and still contains its original one application with no foreign-key violations. The seed was tested against temporary databases; the persistent local database has not been seeded because the user chooses the private demo password.

Run the whole suite:

```powershell
Set-Location -LiteralPath 'C:\CMU\Y2S1\Digital tools\Final project'
.\.venv\Scripts\python.exe -m pytest
```

Tests exercise ownership boundaries, role guards, immutable snapshots, cookie flags, expiry/revocation, safe login errors, CSRF and cache headers, rate limits, concurrent replay, notifications, stages/version checks, repeated seeding, ten HubSpot properties, worker supervision, and migration of a populated v1 SQLite database. PostgreSQL migration SQL and both partial-index predicates are checked. Live PostgreSQL transactions and real Render/Vercel/HubSpot/Notion delivery remain unverified locally because no PostgreSQL server or Docker is installed.

## Differences and implementation choices

- Added `profile_snapshot` and `employer_message` to Application and widened status actors to 60 characters, so UUID-based `employer:` actors fit. Candidate still links to one account; snapshots remain per application.
- Added `rate_limit_buckets` to make limits survive API process restarts and work across processes. Limits use windows beginning with the first attempt.
- The optional admin deactivation endpoint is `POST /api/v2/admin/users/{user_id}/active`, with JSON `{"is_active": false}` and the existing admin bearer token. Reactivation uses `true`; previously revoked sessions stay revoked.
- Job salary input requires both minimum and maximum when any salary field is supplied, as specified in the brief. The demo API defaults a missing maximum to the minimum; the live frontend currently submits `null` when that box is blank. For live mode, fill both fields, or Claude can update the frontend to submit the minimum as maximum. No frontend file was changed here.
- Profile input follows v1 compensation validation strictly: currency/period without an amount are rejected. The demo implementation ignores those fields when no amount is supplied; the current live profile form already clears them correctly.
- The seed never resets existing passwords, changes posted jobs, or overwrites reviewed applications. Use the originally chosen demo password when rerunning it.
- No email is sent by this backend. No password-reset, email-verification, file-upload, user-messaging or employer-search endpoints were added.

Implementation references: [Argon2 password hashing](https://argon2-cffi.readthedocs.io/en/stable/howto.html), [Alembic SQLite batch migrations](https://alembic.sqlalchemy.org/en/latest/batch.html).
