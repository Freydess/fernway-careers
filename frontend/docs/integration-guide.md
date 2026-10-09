# Integration guide: how Fernway's pieces connect

Updated 6 October 2026, for the two-sided marketplace. All services are on free plans.

## The big picture

```text
                        ┌─ demo mode ─► api-demo.js: everything in the visitor's browser
Pages (Vercel) ─────────┤
                        └─ live mode ─► /api/v2/* ──(vercel.json rewrite)──► Render: FastAPI backend ─► Neon Postgres
                                                                                   │
                                                                     sync worker (SYNC_MODE=direct)
                                                                                   ▼
                                                                            HubSpot + Notion
                                                                                   │
                                                              Zapier (2-step Zap) ─┴─► email to the employer

Profile page "Build it with Fern" ─► /api/chat (Vercel function) ─► OpenRouter (the AI key stays on the server)
```

- **Demo mode** is the default. It needs no backend, so the site always works for a presentation.
- **Live mode** starts when `MARKETPLACE_MODE=live` is set on Vercel. The browser calls `/api/v2` on the site's own address and Vercel forwards it to Render, so the backend's sign-in cookie is a normal first-party cookie.
- The pages never write to HubSpot or Notion themselves. The backend's worker does, so nothing is processed twice.

## The site's own server functions

| Route | Does | Answers |
| --- | --- | --- |
| `GET /api/status` | Says which features are on. No secrets. Cached for a minute. | `{ ai: { enabled, mock }, marketplace: { mode } }` |
| `POST /api/chat` | One turn of the AI chat with Fern | `{ reply, fields, complete }`. `503` when no AI key is set, `429` with `retryAfter` when rate-limited, `502` when the AI provider fails. |
| `/api/v2/*` | Not a function: Vercel forwards it to the backend (see `vercel.json`) | The backend's answers |

The same code runs on Vercel (`api/*.js`) and in `npm.cmd run dev` (`vite.config.js`). The old `/api/apply` route and Vercel's `BACKEND_URL` and `INTAKE_API_TOKEN` settings are no longer used.

## The marketplace API (`/api/v2`)

The full contract is in [codex/brief-for-codex.md](codex/brief-for-codex.md). In short:

- **Accounts:** email and password, kept by the backend, with an HTTP-only `fw_session` cookie. Two roles: `seeker` and `employer`.
- **Seekers:** a profile (`GET`/`PUT /me/profile`), open jobs (`GET /jobs`), `POST /jobs/{id}/apply` with consent, and their applications with withdraw.
- **Employers:** company details, jobs (post, edit, close), applicants per job, and decisions on each application.
- **Notifications:** `GET /notifications`, which the bell checks about once a minute.

Applying copies the seeker's profile into the backend's existing `Candidate` and `Application` records as a snapshot, so the original status pipeline, history and HubSpot/Notion sync keep working. Statuses map like this:

| What happens | Status | Employer sees | Seeker sees |
| --- | --- | --- | --- |
| The seeker applies | `new_applicants` | New | Sent |
| The employer opens it | `screening` | Reviewing | Seen by employer |
| The employer accepts | `interview` | Accepted | Accepted |
| Later steps after accepting | `offered`, `hired` | Offer made, Hired | Offer made, Hired |
| The employer rejects | `rejected` | Rejected | Not selected |
| The seeker withdraws | `withdrawn` | Withdrawn | Withdrawn |

`api-demo.js` implements the same contract in the browser, so switching modes changes no page code. The demo content in [`../shared/demo-data.json`](../shared/demo-data.json) is shared with the backend's seed script.

## Fern on OpenRouter

| Vercel setting | Value |
| --- | --- |
| `AI_API_KEY` | An OpenRouter key (starts with `sk-or-`) |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` |
| `AI_MODEL` | `openai/gpt-oss-120b` (the default) |

- Fern replies in a strict JSON format (`reply`, `fields`, `complete`). The function checks every field before it reaches the page, and retries once if the provider rejects a reply for breaking the format.
- Only the last 16 messages go to the model; earlier facts travel as a short summary.
- Fern answers questions about Fernway from [`../shared/company.js`](../shared/company.js), so the AI never contradicts the site.
- `AI_MOCK=true` makes Fern follow a fixed script. It's a backup for presentations without a key or internet.
- Without `AI_BASE_URL`, the function uses Groq, where the site first ran.
- **Privacy:** what seekers type in the AI chat is processed by the AI provider. The privacy notice says so.

## Integrations plan (all free)

| Tool | Role | Status |
| --- | --- | --- |
| **Notion** | The hiring board: a "Candidate ATS Tracker" database with a "Pipeline" board grouped by status, plus `Job`, `Employer` and `Employer Email` columns for the marketplace | Working. `Employer Email` must stay a **Text** column: the backend sends it as text, and Notion rejects the whole row if the column is the Email type. |
| **HubSpot** | A CRM contact for each applicant | Working. The 10 custom properties from `docs/hubspot-properties.json` exist (`scripts/setup_hubspot.py` can recreate them). |
| **Backend sync** | Copies applications to Notion and HubSpot (`SYNC_MODE=direct`) | Working. The worker starts with the API on Render (`python -m app.start`). |
| **Zapier** | 2-step Zaps only on the free plan, no webhooks | Working: the employer email Zap. The Typeform Zap is set up by hand, see below. |
| **Typeform** | Quick interest form for people without an account | The form is live: <https://form.typeform.com/to/bjOIEvvs> |
| **UptimeRobot** | Checks the backend every 5 minutes | A **Keyword** monitor on `/health` looking for `"status":"ok"`. A plain HTTP monitor sends `HEAD`, which the backend answers with 405, so it always showed "Down". |

### Zapier: tell employers about new applications

The backend sends no email. Instead, a free 2-step Zap:

1. **Trigger:** Notion, **New Database Item**, in "Candidate ATS Tracker".
2. **Action:** Gmail, **Send Email**. To: the `Employer Email` column. Subject: `New application for {Job}` (keep the space before the job). Body: the applicant's name, the job, and a link to <https://fernway-careers.vercel.app/employer.html>.

Demo employers have `.example` email addresses, which can't receive mail. To see the Zap work, sign up as an employer with your own address.

### Typeform: a quick interest form

The **Fernway interest form** is live at <https://form.typeform.com/to/bjOIEvvs>. It was created through the Typeform API on 6 October 2026. Typeform's free plan allows 10 questions and 10 responses a month, and has no webhooks. So the form goes to Notion through a second 2-step Zap instead of the backend. It suits people who aren't ready to make an account; you then invite them to sign up.

| # | Question | Type | Required |
| --- | --- | --- | --- |
| 1 | What's your full name? *(the description links the privacy notice)* | Short text | Yes |
| 2 | Which area fits you best? | One choice: Engineering, Design, Marketing, Operations, Other | Yes |
| 3 | What are you good at? A few skills or tools. | Long text | No |
| 4 | How would you describe your experience level? *(the description explains each level)* | One choice: Intern, Junior, Mid, Senior, Lead | No |
| 5 | A link to your work: GitHub, portfolio, Figma or LinkedIn | Website | No |
| 6 | A link to your resume (shared with "anyone with the link") | Website | No |
| 7 | When could you start? | One choice: Immediately, In 2–4 weeks, In 1–3 months, Just exploring | No |
| 8 | Best email to reach you? | Email | Yes |
| 9 | Phone number *(Thailand preselected)* | Phone number | No |
| 10 | May Fernway store these details and contact you about jobs? *(links the privacy notice)* | One choice: "Yes, I agree" | Yes |

- **Consent is enforced.** Question 10 has a single required option, so the form can't be sent without agreeing, and a "No" never reaches Notion. Typeform's "send partial responses to integrations" setting is off, so people who stop halfway aren't sent either.
- **Choice labels match the Notion select options exactly** ("Other", not the site's "Something else"; "Mid", not "Mid-level"), so the Zap can fill `Role` and `Experience` without creating new options.
- Ending: "Thanks! We'll email you an invitation to create your Fernway profile, so you can see the jobs that match you.", with a **Visit Fernway** button to the site.

**The Zap** (Typeform **New Entry** → Notion **Create Data Source Item** in "Candidate ATS Tracker"):

| Notion column | Value |
| --- | --- |
| Name | Q1, full name |
| Email | Q8 |
| Phone | Q9 |
| Role | Q2 |
| Experience | Q4 |
| Portfolio | Q5 |
| Resume | Q6 |
| Availability | Q7 |
| Summary Notes | `Skills: ` followed by Q3 |
| Status | New Applicants |
| Job | `Interest form` (typed in) |
| Employer | `Fernway` (typed in) |
| Employer Email | The team's own Gmail address, so the employer email Zap tells the team about each new entry |

Entries reach Notion only, not the backend's database. That's fine for a free plan, but they won't appear in the employer pages.

## What was tested

**5 October 2026, live site in demo mode** (in a browser, desktop and 375 px phone width, light and dark):

- Sign up, build the profile with Fern's guided chat, ranked jobs, apply (consent required), employer notification, open (moves to Reviewing), accept with a message, and the seeker sees Accepted plus the bell.
- Employer dashboard, applicants list and application page, including the accept dialog as a bottom sheet on phones.
- Two tabs of the same browser, a seeker in one and an employer in the other: the seeker applied, and the employer's bell updated within a second without a reload.
- No runtime errors on Vercel.

**4 October 2026, Fern on OpenRouter:** six question-and-answer scenarios against the live `/api/chat`, all passing.

**5 October 2026, live mode on a computer** (the backend's `/api/v2` on a throwaway database, the site with `?backend=live`): sign up as an employer and post a job, sign up as a seeker and save a profile, ranked jobs, apply, sign out and in (and a wrong password), the employer's notification, open (Reviewing), accept with a message, mark an offer, and the seeker's notifications and status. The API answers match the contract, the session cookie flags are right, and requests from other sites are refused. The backend's own tests pass (58).

**5 October 2026, live site on Render and Neon:** the backend migrated Neon on start, the demo data was seeded, and a seeker applied and an employer accepted through https://fernway-careers.vercel.app. The site then switched to live mode (`MARKETPLACE_MODE=live`).

**5–6 October 2026, the integrations:** an application on the live site created the Notion row and the HubSpot contact, and a status change updated both. The employer email Zap sent the alert to a real employer address. UptimeRobot's keyword monitor shows the backend as up.

**6 October 2026, Typeform:** a test entry through the live form created a Notion row with every mapped column filled (Role and Experience as the existing select options, Status "New Applicants", Job "Interest form"). The employer email Zap then sent "New application for Interest form" to the team's Gmail. All services are now tested.
