# Note for Codex: turn Fernway into a two-sided job marketplace (backend)

From Claude, who builds the frontend in `frontend/`. Written 2026-10-05.

## What the user wants

Fernway changes from one company's careers page into a job platform like LinkedIn or JobsDB, with two kinds of users:

- **Job seekers** create an account and a profile: background, skills, experience and a resume link. They see jobs that match their skills, pick one and apply. The application goes to that job's employer.
- **Employers / recruiters** create an account, post jobs, get a **notification** when someone applies, review the application, and **accept or reject** it. The seeker sees the result.

Fernway is now the platform's name and Fern is its AI assistant. Employers and jobs are fictional demo data.

## Do these first

The two requests in [`note-for-codex-sync-worker.md`](note-for-codex-sync-worker.md) still apply:

1. Run the sync worker on Render.
2. Fit HubSpot's free limit of 10 custom properties.

## Ground rules

- **Keep `/api/v1` working as it is.** That covers the intake, the Typeform webhook, the admin review endpoints and sync. All new endpoints go under **`/api/v2`**.
- **Keep the hiring stages unchanged.** `new_applicants → screening → interview → offered → hired`, plus `rejected` and `withdrawn`, and the existing `TRANSITIONS`. The marketplace maps onto them (see [Status rules](#status-rules)), so Notion's board and HubSpot's status options stay valid.
- **Reuse `Candidate` and `Application` for submitted applications.** The existing HubSpot and Notion sync then keeps working.
- **Store accounts and sessions in the backend.** Use email and password and an HTTP-only session cookie. No external auth provider and no email verification in v1.
- **Same origin.** The browser calls `https://fernway-careers.vercel.app/api/v2/...`, and Vercel proxies that path to Render with a rewrite (Claude adds this). Cookies therefore belong to the Vercel domain, so **don't set a `Domain` attribute** on cookies. In local development, Vite proxies `/api/v2` to `http://127.0.0.1:8000`.

## Suggested data model

Codex owns the schema; this is a suggestion. Use one Alembic migration.

| Table | Columns (main ones) |
| --- | --- |
| `users` | id, email (unique, lowercased), password_hash, role (`seeker` / `employer`), full_name, is_active, created_at, last_login_at |
| `sessions` | id, user_id, token_hash (SHA-256 of the cookie token), created_at, expires_at, revoked_at |
| `employers` | id, owner_user_id (unique: one company per employer account in v1), name, website, about, location, created_at, updated_at |
| `seeker_profiles` | user_id (PK), phone, location, timezone, headline, about, skills (JSON list), target_role, role_detail, experience_level, experience_years, portfolio_url, resume_url, availability, compensation_amount / currency / period, compensation_expectations, updated_at |
| `jobs` | id, employer_id, title, area (same enum as `target_role`), levels (JSON list of experience levels), employment_type (`full_time` / `part_time` / `contract` / `internship` / `freelance`), work_mode (`remote` / `hybrid` / `onsite`), location, salary_min, salary_max, salary_currency, salary_period, summary, description, skills (JSON list, lowercase), status (`open` / `closed`), created_at, updated_at |
| `notifications` | id, user_id, type, application_id, job_id, title, body, created_at, read_at |
| `candidates` (existing) | add `user_id` (nullable, unique) to link the seeker account |
| `applications` (existing) | add `job_id` (nullable FK; null = legacy v1 rows) and `cover_note`. Replace `uq_candidate_role` with two partial unique indexes: (`candidate_id`, `target_role`) WHERE `job_id IS NULL`, and (`candidate_id`, `job_id`) WHERE `job_id IS NOT NULL`. SQLite and Postgres both support these. |

When a seeker applies, copy their profile into `Candidate` and `Application` (`target_role` = the job's `area`) as a **snapshot**. Later profile edits must not change applications already sent. `consent_to_process` is still required, at the moment of applying.

## API v2 contract

JSON in and out. Errors use FastAPI's `{"detail": ...}`, and validation errors use the same safe 422 format as v1. Where the frontend needs to react to a specific error, also include a `code`, for example `{"detail": "You’ve already applied to this job.", "code": "already_applied"}`. Codes used so far: `already_applied`, `job_closed` and `profile_incomplete`. "Seeker" and "employer" below mean the endpoint requires that role (401 without a session, 403 for the wrong role). A resource that belongs to someone else returns **404**, not 403.

### Accounts

| Method and path | Who | Body | Returns |
| --- | --- | --- | --- |
| `POST /auth/register` | anyone | `{role, email, password, full_name, company_name}` (`company_name` required for employers) | 201 `{user}` + session cookie. 409 if the email is taken. |
| `POST /auth/login` | anyone | `{email, password}` | 200 `{user}` + cookie. 401 `"Wrong email or password."` (same message whether the email exists or not). 429 when rate-limited. |
| `POST /auth/logout` | signed in | – | 204. Revokes the session and clears the cookie. |
| `GET /auth/me` | signed in | – | 200 `{user}`, or 401 |

`user` = `{id, email, role, full_name, company: {id, name} | null}`

### Seekers

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /me/profile` | – | the profile, with null for empty fields, plus `full_name` from the account |
| `PUT /me/profile` | the whole profile (validation as in v1 `Intake`: HTTPS external URLs, IANA timezone, decimals, compensation rules). `skills`: up to 30 strings of up to 40 characters, stored lowercased and trimmed. Also accepts `full_name`, which updates the account's name. | the saved profile |
| `GET /me/applications` | – | `[{id, status, version, created_at, updated_at, cover_note, employer_message, job: {id, title, employer: {id, name}}}]`, newest first |
| `POST /me/applications/{id}/withdraw` | `{reason?}` | the updated application. Moves it to `withdrawn` (default reason "Withdrawn by candidate") and notifies the employer. |
| `POST /jobs/{id}/apply` | `{cover_note?, consent_to_process: true}` + `Idempotency-Key` header | 201 the application (`{id, status, version, created_at, job}`). 409 if already applied to this job or the job is closed. 422 if the profile is missing (a profile must exist with at least `full_name` from the account and one of `skills` or `about`). Notifies the employer. |

### Jobs (public, no account needed)

| Method and path | Returns |
| --- | --- |
| `GET /jobs?q=&area=&level=&work_mode=&employment_type=&limit=&offset=` | `{items: [job], total}`, **open jobs only**, newest first. `q` searches title, summary, skills and company name. |
| `GET /jobs/{id}` | the job, with `employer: {id, name, website, about, location}`. Closed jobs return 404, except to their own employer. |

`job` = `{id, title, area, levels, employment_type, work_mode, location, salary_min, salary_max, salary_currency, salary_period, summary, description, skills, status, created_at, employer: {id, name}}`. Never include employer users' emails in public responses.

### Employers

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /employer/company` / `PUT /employer/company` | `{name, website?, about?, location?}` | the company |
| `GET /employer/jobs` | – | own jobs, open and closed, each with `counts: {new_applicants, screening, interview, offered, hired, rejected, withdrawn}` |
| `POST /employer/jobs` | job input (below) | 201 the job |
| `PUT /employer/jobs/{id}` | job input, including `status` (`open` / `closed`) | the job |
| `GET /employer/jobs/{id}/applications?status=` | – | `[{id, status, version, created_at, candidate: {full_name, headline, target_role, experience_level, experience_years, skills}}]` |
| `GET /employer/applications/{id}` | – | `{id, status, version, created_at, updated_at, cover_note, employer_message, candidate, history, job}`. `candidate` is the full profile snapshot, including `full_name`, `email` and `phone`. `history` is `[{status, at, actor, reason}]`, oldest first. `job` uses the public job shape. **Side effect:** `new_applicants → screening`, recorded as a status event. No notification for this. |
| `POST /employer/applications/{id}/decision` | `{decision: "accept" \| "reject", message?, expected_version}` | the updated application. Notifies the seeker. |
| `POST /employer/applications/{id}/stage` | `{status: "offered" \| "hired", expected_version}` | optional, for after acceptance |

Job input: title 3–120 characters, `area`, `levels` (1–5 of intern/junior/mid/senior/lead), `employment_type`, `work_mode`, location up to 120 characters, summary up to 300, description up to 8000, `skills` (up to 30, lowercase), and optional salary. If a salary is given: min ≤ max, both ≥ 0, a 3-letter currency, and a period from the v1 list.

### Notifications

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /notifications?limit=20` | – | `{unread, items: [{id, type, title, body, application_id, job_id, created_at, read_at}]}`, newest first |
| `POST /notifications/read` | `{ids: [...]}` or `{all: true}` | 204 |

Types and who gets them:
- `application_received` → the employer
- `application_accepted` / `application_rejected` / `application_offered` / `application_hired` → the seeker
- `application_withdrawn` → the employer

The frontend polls `GET /notifications` about once a minute while the tab is visible. Email notifications are planned through Zapier from Notion, so the backend sends no email.

## Status rules

These use the existing `TRANSITIONS`. Every change adds a `StatusEvent` with an actor such as `employer:<user_id>` or `seeker:<user_id>`, bumps `version`, and queues sync jobs as v1 does.

| Action | Change | Notes |
| --- | --- | --- |
| Seeker applies | → `new_applicants` | |
| Employer opens the application | `new_applicants → screening` | automatic, once |
| Employer **accepts** | → `interview` | from `new_applicants`, do both steps in one transaction. `message` becomes `employer_message`, for example "We'd like to interview you; we'll email you." |
| Employer **rejects** | → `rejected` | `reason` = `message`, or "Not selected" if empty |
| Employer marks offered / hired | `interview → offered → hired` | optional |
| Seeker withdraws | → `withdrawn` | any non-final state |

`expected_version` works as in v1 (409 if it's stale).

## Sync changes (HubSpot and Notion)

- Add `job_title`, `employer_name` and `employer_email` to the sync payload for marketplace applications.
- **Notion:** also write the text properties `Job`, `Employer` and `Employer Email`. Claude adds these columns to the Notion database. Zapier will use `Employer Email` to email the employer about new applications.
- **HubSpot:** no new properties (the account is at its limit of 10). For marketplace applications, put `"<job title> at <employer>"` into `candidate_role_detail`.

## Security and privacy (please treat as requirements)

- Hash passwords with **argon2id** (`argon2-cffi`) or bcrypt. Length 8–128. Never log passwords, tokens or cookies.
- Session cookie: name `fw_session`, value `secrets.token_urlsafe(32)`, only its SHA-256 stored. Set `HttpOnly`, `Secure` (except plain-HTTP local development), `SameSite=Lax`, `Path=/`, and a 30-day expiry. Logout revokes it.
- CSRF: every POST, PUT and DELETE under `/api/v2` must have `Content-Type: application/json`. If an `Origin` header is present, it must be in `ALLOWED_ORIGINS` (`https://fernway-careers.vercel.app`, `http://localhost:5173`).
- Rate limits:
  - login: 10 per 15 minutes per IP and email
  - register: 5 per hour per IP
  - apply: 30 per hour per user

  Behind Vercel and Render, use the first `X-Forwarded-For` address.
- **Ownership checks on every employer and seeker endpoint.** Employers see applicants' details **only** for applications to their own jobs. Employers can't browse or search seekers in v1. Public endpoints never expose user emails.
- Accounts can be deactivated with `is_active=false`. That blocks login and hides the company's jobs. An admin-token endpoint for this is enough.

## Demo data

Please add a seed script, for example `python -m scripts.seed_demo`, that loads **`frontend/shared/demo-data.json`**. The frontend's demo mode reads the same file, so both always show the same content. The file has:
- 5 fictional employers, each with an owner account
- 11 jobs, posted a number of days ago
- 3 seekers with profiles
- 4 applications in different stages

Use the `.example` addresses as they are, and read the demo password from an environment variable; never commit it. Running the script twice must not create duplicates.

## Tests worth having

- Employer A can't read, decide on, or list employer B's jobs or applications (404).
- A seeker can't see another seeker's applications, and can't apply twice to the same job.
- Accepting from `new_applicants` gives `interview` with two status events. A stale `expected_version` returns 409.
- A notification is created for the right user on apply, accept, reject and withdraw.
- Login gives the same message for a wrong password and an unknown email. The cookie flags are as listed above.
- v1 tests still pass, and the partial unique indexes behave on SQLite and Postgres.

## What Claude builds (for context)

- Multi-page frontend:
  - home, with job search
  - job detail and apply
  - sign up / log in
  - seeker profile, including "build it with Fern", which reuses the AI and guided chats
  - "My applications"
  - employer dashboard: jobs, post or edit a job, review applications, accept or reject
  - a notification bell
- **Matching runs in the frontend.** It ranks `GET /jobs` results against the seeker's profile by skills, area and level, and shows the reasons.
- Vercel rewrite `/api/v2/:path*` → Render. Updated privacy page.

Please tell the user when the v2 endpoints are deployed, or if you want to change any part of this contract, so the frontend can follow.

## Not in v1

Email verification, password reset by email, resume file upload, multiple recruiters per company, employers searching for seekers, and messaging between users.
