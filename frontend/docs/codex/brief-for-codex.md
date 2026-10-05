# Fernway backend: brief for Codex

From Claude, who builds the frontend in `frontend/`, to Codex, who owns the Python backend at the repository root. The user passes messages between us. Updated 5 October 2026. Everything you need is in this one file.

## 1. What to do

Two jobs, in this order:

1. **The sync worker and HubSpot's 10-property limit** ([section 4](#4-job-1-the-sync-worker-and-hubspots-10-property-limit)). Small and self-contained.
2. **The marketplace API, `/api/v2`** ([section 5](#5-job-2-the-marketplace-api-apiv2)). The frontend for it is already built and live in demo mode, waiting for this backend.

Then prepare the deploy ([section 6](#6-deploying)), run the tests ([section 7](#7-tests)), and report back ([section 8](#8-when-youre-done)).

### Working rules

- **Read anything in this folder** for context (the files below are the most useful). **Edit only backend files**: `app/`, `migrations/`, `tests/`, `scripts/`, `docs/`, `Dockerfile`, `requirements.txt`, `README.md`.
- **Don't change anything in `frontend/`.** Claude owns it. If part of the contract should change, say so in your reply and Claude will update the frontend.
- **Keep `/api/v1` working** as it is, with its tests.
- **Don't push to GitHub.** A push deploys to Render and Vercel at once. A local commit is fine.
- **The repository is public.** No secrets, tokens or demo passwords in any file.
- **The user works on Windows, in PowerShell.** Python is `.\.venv\Scripts\python.exe` (there's no global `python`). The user pastes commands exactly as written, so give complete commands without `<placeholders>`. For secrets, say in words where to paste them.

### Useful files

| File | Why |
| --- | --- |
| `frontend/src/app/api-live.js` | The client that will call your endpoints. Match its paths, and the response shapes below, exactly. |
| `frontend/src/app/api-demo.js` | The same contract running in the browser (demo mode): validation, messages, status changes and notification texts. A good reference. If it disagrees with this brief, follow the brief and mention it. |
| `frontend/src/app/errors.js` | How the frontend reads errors |
| `frontend/shared/demo-data.json` | The data for your seed script |
| `frontend/shared/options.js` | The enums (areas, levels, job types, work modes, pay periods, statuses) and their labels |
| `frontend/docs/claude-handoff.md` | Where the whole project stands |
| `frontend/docs/fernway-site-guide.md` | The user's own guide. Part 2 records how Vercel, Render and Neon were set up. |
| `docs/integrations.md`, `docs/hubspot-properties.json`, `docs/notion-schema.json` | Your existing integration docs |

## 2. The project today

**Fernway** is a CMU course project, due within a week of 5 October 2026. It's a two-sided job marketplace, like a small LinkedIn or JobsDB:

- **Job seekers** make an account and a profile (skills, experience, a resume link), see jobs ranked by match, apply, and follow their applications.
- **Employers** post jobs, get a notification for each application, and accept or reject applicants.
- **Fern** is the AI assistant that fills in profiles. Fernway, its employers and its people are fictional.

| Piece | State |
| --- | --- |
| Website | https://fernway-careers.vercel.app on Vercel (project root `frontend/`). Runs in **demo mode**: each visitor's data lives in their own browser, so nothing calls `/api/v2` yet. |
| Rewrite | `frontend/vercel.json` sends `/api/v2/*` to `https://fernway-careers.onrender.com/api/v2/*`. The browser only ever talks to the Vercel address. |
| Backend | https://fernway-careers.onrender.com on Render's free plan: Docker, **redeploys on every push to `main`**, sleeps when idle (up to a minute to wake). Settings: `DATABASE_URL`, `ADMIN_API_TOKEN`, `INTAKE_API_TOKEN`, `SYNC_MODE=disabled`, `PORT=8000`, `NOTION_TOKEN`, `NOTION_DATA_SOURCE_ID`. |
| Database | Neon Postgres (`postgresql+psycopg://…-pooler…`). Tables: `candidates`, `applications`, `intake_receipts`, `status_events`, `sync_jobs`, `alembic_version`. It holds one v1 test application, which the migration must keep valid. |
| Notion | The "Candidate ATS Tracker" database is ready, with the columns from `docs/notion-schema.json` plus text columns `Job`, `Employer` and `Employer Email`. The integration token and data source ID are on Render. |
| HubSpot | Free account not created yet. It waits for job 1. |
| Zapier | Planned: a 2-step Zap from new Notion rows that emails the `Employer Email`. Zapier's free plan has no webhooks, so `SYNC_MODE=zapier` isn't used. |

**Switching the site to live:** once your v2 is deployed, the user sets `MARKETPLACE_MODE=live` on Vercel. Before that, anyone can test live mode in one browser tab by adding `?backend=live` to the address.

## 3. Ground rules for the backend

- **New endpoints go under `/api/v2`.** That leaves `/api/v1` (intake, Typeform webhook, admin review, sync) as it is.
- **Keep the hiring stages unchanged:** `new_applicants → screening → interview → offered → hired`, plus `rejected` and `withdrawn`, with the existing `TRANSITIONS`. The marketplace maps onto them ([section 5.4](#54-status-rules)), so Notion's board and HubSpot's status options stay valid.
- **Reuse `Candidate` and `Application` for submitted applications**, so the existing HubSpot and Notion sync keeps working.
- **Accounts and sessions live in the backend:** email and password with an HTTP-only session cookie. No external auth provider and no email verification in v1.
- **Same origin.** The browser calls `https://fernway-careers.vercel.app/api/v2/…` and Vercel proxies it to Render, so cookies belong to the Vercel domain. **Don't set a `Domain` attribute** on cookies. Locally, Vite proxies `/api/v2` to `http://127.0.0.1:8000`.

## 4. Job 1: the sync worker and HubSpot's 10-property limit

### Run the worker on Render

**Problem.** The `Dockerfile`'s `CMD` starts only uvicorn, so the sync worker (`python -m app.worker`) never runs on Render. Once `SYNC_MODE=direct` is set, HubSpot and Notion jobs would queue forever. Render's free plan has no separate background worker service.

**Change.** Start the worker next to the API in the same container. Combined with the migration step from [section 6](#6-deploying), for example:

```dockerfile
CMD ["sh", "-c", "python -m alembic upgrade head && (python -m app.worker &) && exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

Check that:

- with `SYNC_MODE=disabled`, the worker logs "External sync is disabled" and exits, which is fine
- a crashed worker gets restarted (a small restart loop, or start it from the app's lifespan instead)
- jobs are processed while Render is awake. Requests wake it, and stuck jobs can be re-queued with `POST /api/v1/applications/{id}/sync`.

### Fit HubSpot's free plan (10 custom properties)

HubSpot's free CRM allows **10 custom properties for the whole account**. `hubspot_properties()` in `app/integrations.py` and `docs/hubspot-properties.json` use **12**, and a write that names a missing property is rejected, so every HubSpot job would fail. To get to exactly 10:

- Replace `candidate_full_name` with HubSpot's standard `firstname` / `lastname`. Split on the last space; a one-word name goes in `firstname` only.
- Stop sending `candidate_timezone` to HubSpot. It's still stored locally and sent to Notion.
- Update `docs/hubspot-properties.json`, `docs/integrations.md` and any tests that check the property list.

The user creates the 10 properties in HubSpot afterwards.

**Agreed plan (chosen by the user on 4 October):** `SYNC_MODE=direct` on Render with `HUBSPOT_ACCESS_TOKEN`, `NOTION_TOKEN` and `NOTION_DATA_SOURCE_ID`. Typeform entries reach Notion through Zapier, not through `/api/v1/webhooks/typeform`.

## 5. Job 2: the marketplace API (`/api/v2`)

### 5.1 Data model

You own the schema; this is a suggestion. Use one Alembic migration.

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

When a seeker applies, copy their profile into `Candidate` and `Application` (`target_role` = the job's `area`) as a **snapshot**, so later profile edits don't change applications already sent. `consent_to_process` is still required, at the moment of applying.

### 5.2 General API rules

- JSON in and out.
- Errors use FastAPI's `{"detail": ...}`; validation errors use the same safe 422 format as v1. The frontend reads `detail` as a string, or for 422 as a list of `{loc, msg}` (or `{field, message}`) items, and shows each next to its field.
- Where the frontend reacts to a specific error, add a top-level `code`, for example `{"detail": "You’ve already applied to this job.", "code": "already_applied"}`. Codes used: `already_applied`, `job_closed`, `profile_incomplete`.
- "Seeker" and "employer" below mean the endpoint requires that role: 401 without a session, 403 for the wrong role.
- A resource that belongs to someone else returns **404**, not 403.
- The frontend sends `Content-Type: application/json` on every POST and PUT, even when the body is just `{}`.

### 5.3 Endpoints

**Accounts**

| Method and path | Who | Body | Returns |
| --- | --- | --- | --- |
| `POST /auth/register` | anyone | `{role, email, password, full_name, company_name}` (`company_name` required for employers) | 201 `{user}` + session cookie. 409 if the email is taken. |
| `POST /auth/login` | anyone | `{email, password}` | 200 `{user}` + cookie. 401 `"Wrong email or password."`, the same message whether or not the email exists. 429 when rate-limited. |
| `POST /auth/logout` | signed in | – | 204. Revokes the session and clears the cookie. |
| `GET /auth/me` | signed in | – | 200 `{user}`, or 401 |

`user` = `{id, email, role, full_name, company: {id, name} | null}`

**Seekers**

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /me/profile` | – | the profile, with null for empty fields, plus `full_name` from the account |
| `PUT /me/profile` | the whole profile, validated as in v1 `Intake` (HTTPS external URLs, IANA timezone, decimals, compensation rules). `skills`: up to 30 strings of up to 40 characters, stored lowercased and trimmed. Also accepts `full_name`, which updates the account's name. | the saved profile |
| `GET /me/applications` | – | `[{id, status, version, created_at, updated_at, cover_note, employer_message, job: {id, title, employer: {id, name}}}]`, newest first |
| `POST /me/applications/{id}/withdraw` | `{reason?}` | the updated application. Moves it to `withdrawn` (default reason "Withdrawn by candidate") and notifies the employer. |
| `POST /jobs/{id}/apply` | `{cover_note?, consent_to_process: true}` + `Idempotency-Key` header | 201 the application (`{id, status, version, created_at, job}`). 409 `already_applied` or `job_closed`. 422 `profile_incomplete` if there's no usable profile: it needs `full_name` from the account and at least one of `skills` or `about`. Notifies the employer. |

**Jobs** (public, no account needed)

| Method and path | Returns |
| --- | --- |
| `GET /jobs?q=&area=&level=&work_mode=&employment_type=&limit=&offset=` | `{items: [job], total}`, **open jobs only**, newest first. `q` searches title, summary, skills and company name. |
| `GET /jobs/{id}` | the job, with `employer: {id, name, website, about, location}`. Closed jobs return 404, except to their own employer. |

`job` = `{id, title, area, levels, employment_type, work_mode, location, salary_min, salary_max, salary_currency, salary_period, summary, description, skills, status, created_at, employer: {id, name}}`. Public responses never include employer users' emails.

**Employers**

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /employer/company` / `PUT /employer/company` | `{name, website?, about?, location?}` | the company |
| `GET /employer/jobs` | – | own jobs, open and closed, each with `counts: {new_applicants, screening, interview, offered, hired, rejected, withdrawn}` |
| `POST /employer/jobs` | job input (below) | 201 the job |
| `PUT /employer/jobs/{id}` | job input, including `status` (`open` / `closed`) | the job |
| `GET /employer/jobs/{id}/applications?status=` | – | `[{id, status, version, created_at, candidate: {full_name, headline, target_role, experience_level, experience_years, skills}}]` |
| `GET /employer/applications/{id}` | – | `{id, status, version, created_at, updated_at, cover_note, employer_message, candidate, history, job}`. `candidate` is the full profile snapshot, including `full_name`, `email` and `phone`. `history` is `[{status, at, actor, reason}]`, oldest first. `job` uses the public job shape. **Side effect:** `new_applicants → screening`, recorded as a status event, with no notification. |
| `POST /employer/applications/{id}/decision` | `{decision: "accept" \| "reject", message?, expected_version}` | the updated application. Notifies the seeker. |
| `POST /employer/applications/{id}/stage` | `{status: "offered" \| "hired", expected_version}` | the updated application, for after acceptance |

**Job input:** title 3–120 characters, `area`, `levels` (1–5 of intern / junior / mid / senior / lead), `employment_type`, `work_mode`, location up to 120 characters, summary up to 300, description up to 8000, `skills` (up to 30, lowercase), and an optional salary. If a salary is given: min ≤ max, both ≥ 0, a 3-letter currency, and a period from the v1 list.

**Notifications**

| Method and path | Body | Returns |
| --- | --- | --- |
| `GET /notifications?limit=20` | – | `{unread, items: [{id, type, title, body, application_id, job_id, created_at, read_at}]}`, newest first |
| `POST /notifications/read` | `{ids: [...]}` or `{all: true}` | 204 |

Who gets which type:

- `application_received` and `application_withdrawn` go to the employer.
- `application_accepted`, `application_rejected`, `application_offered` and `application_hired` go to the seeker.

The frontend checks `GET /notifications` about once a minute while the tab is open. The backend sends no email; employer emails go through Zapier from Notion. For titles and bodies, `notify(...)` calls in `api-demo.js` show the wording the demo uses.

### 5.4 Status rules

These use the existing `TRANSITIONS`. Every change adds a `StatusEvent` with an actor such as `employer:<user_id>` or `seeker:<user_id>`, bumps `version`, and queues sync jobs as v1 does.

| Action | Change | Notes |
| --- | --- | --- |
| Seeker applies | → `new_applicants` | |
| Employer opens the application | `new_applicants → screening` | automatic, once |
| Employer **accepts** | → `interview` | From `new_applicants`, do both steps in one transaction. `message` becomes `employer_message`, for example "We'd like to interview you; we'll email you." |
| Employer **rejects** | → `rejected` | `reason` = `message`, or "Not selected" if empty |
| Employer marks offered / hired | `interview → offered → hired` | optional |
| Seeker withdraws | → `withdrawn` | from any non-final state |

`expected_version` works as in v1: 409 if it's stale.

### 5.5 Sync changes (HubSpot and Notion)

- Add `job_title`, `employer_name` and `employer_email` to the sync payload for marketplace applications.
- **Notion:** also write the text properties `Job`, `Employer` and `Employer Email`. The columns already exist. Zapier uses `Employer Email` to email the employer about new applications.
- **HubSpot:** no new properties, because the account is at its limit of 10. For marketplace applications, put `"<job title> at <employer>"` into `candidate_role_detail`.

### 5.6 Security and privacy (requirements)

- Hash passwords with **argon2id** (`argon2-cffi`) or bcrypt. Length 8–128. Never log passwords, tokens or cookies.
- **Session cookie:** name `fw_session`, value `secrets.token_urlsafe(32)`, only its SHA-256 stored. Set `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and a 30-day expiry. Logout revokes it.
- Take `Secure` from a setting that defaults to on (off only for plain-HTTP local development), **not from the request's scheme**: behind Render's proxy, uvicorn sees plain HTTP.
- Send **`Cache-Control: no-store`** on every `/api/v2` response. Vercel proxies them, and they're per user.
- **CSRF:** every POST, PUT and DELETE under `/api/v2` must have `Content-Type: application/json`. If an `Origin` header is present, it must be in `ALLOWED_ORIGINS` (`https://fernway-careers.vercel.app`, `http://localhost:5173`).
- **Rate limits:** login 10 per 15 minutes per IP and email; register 5 per hour per IP; apply 30 per hour per user. Behind Vercel and Render, use the first `X-Forwarded-For` address.
- **Ownership checks on every employer and seeker endpoint.** Employers see applicants' details **only** for applications to their own jobs, and can't browse or search seekers in v1. Public endpoints never expose user emails.
- Accounts can be deactivated with `is_active=false`, which blocks login and hides the company's jobs. An admin-token endpoint for this is enough.

### 5.7 Demo data

Add a seed script, for example `python -m scripts.seed_demo`, that loads **`frontend/shared/demo-data.json`**, the same file the frontend's demo mode uses. It has 5 fictional employers (each with an owner account), 11 jobs posted a number of days ago, 3 seekers with profiles, and 4 applications in different stages.

Use the `.example` email addresses as they are. Read the demo accounts' password from an environment variable; never commit it. Running the script twice must not create duplicates.

## 6. Deploying

- **Migrate on start.** Render redeploys on every push to `main`, and Neon needs the new tables before the new code serves requests. Run `alembic upgrade head` when the container starts, before the worker and uvicorn (see the `CMD` example in [section 4](#4-job-1-the-sync-worker-and-hubspots-10-property-limit)), so a push is the only deploy step.
- **List every new setting** with its default, and say which ones must be set on Render.
- **Seeding runs from the user's PC against Neon**, like the Alembic step in Part 2, step 6 of `frontend/docs/fernway-site-guide.md`: set `DATABASE_URL` and the demo password in the PowerShell window, then run `.\.venv\Scripts\python.exe -m scripts.seed_demo`. Give the exact commands.
- **No push.** When you're done, tell the user. Claude then runs the frontend against your backend locally (`MARKETPLACE_MODE=live`) and tests both sides before anything is pushed.

## 7. Tests

Run the whole suite with `.\.venv\Scripts\python.exe -m pytest`. Tests worth adding:

- Employer A can't read, decide on, or list employer B's jobs or applications (404).
- A seeker can't see another seeker's applications, and can't apply twice to the same job.
- Accepting from `new_applicants` gives `interview` with two status events. A stale `expected_version` returns 409.
- A notification is created for the right user on apply, accept, reject and withdraw.
- Login gives the same message for a wrong password and an unknown email. The cookie flags are as listed above.
- v1 tests still pass, and the partial unique indexes behave on SQLite and Postgres.
- HubSpot gets exactly the 10 custom properties, plus `firstname`/`lastname`.

## 8. When you're done

Reply to the user with:

- what you changed
- the test results
- every new setting, its default, and which ones the user must set on Render
- the exact PowerShell commands to migrate and seed Neon from the user's PC
- anything that differs from this brief

## 9. What the frontend already does (for context)

- Pages: home, job search and job detail with apply, sign up / sign in, seeker profile (with "Build it with Fern"), "My applications", employer dashboard, post or edit a job, applicants by stage, one application with accept / reject / offer / hired, a notification bell, and the privacy notice.
- **Matching runs in the frontend.** It ranks `GET /jobs` results against the seeker's profile by area, level and skills (the skills list and the headline), and shows the reasons. The backend doesn't score anything.
- After 4 seconds without an answer, it tells the user that Fernway's server is waking up.
- Demo mode (`api-demo.js`) implements this whole contract in the browser, so switching to live mode changes no page code.

## 10. Not in v1

Email verification, password reset by email, resume file upload, multiple recruiters per company, employers searching for seekers, and messaging between users.
