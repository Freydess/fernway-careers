# Fernway job marketplace (frontend)

The website for the Personalized Employment System. **Fernway** is a two-sided job platform, like a small LinkedIn or JobsDB:

- **Job seekers** make an account and a profile (skills, experience, links), see jobs ranked by how well they match, apply with an optional note, and follow each application.
- **Employers** post jobs, get a notification for each application, see how every applicant matches, and accept or reject them with a message.
- **Fern** is the assistant that fills in a seeker's profile through a short chat.

Fernway, its employers and its people are fictional, made for a university project. Live site: <https://fernway-careers.vercel.app>.

## Demo mode and live mode

The site runs the same pages against one of two interchangeable APIs:

| Mode | Where accounts, jobs and applications live | When |
| --- | --- | --- |
| **Demo** (default) | In each visitor's own browser (localStorage), seeded from [`shared/demo-data.json`](shared/demo-data.json) | Always available. No backend needed, so it's also the backup for presentations. |
| **Live** | The Python backend's `/api/v2` at the project root, with its Postgres database | When `MARKETPLACE_MODE=live` is set and the backend's v2 API is deployed |

`GET /api/status` tells each page which mode to use. For testing, add `?backend=demo` or `?backend=live` to any address to override it for the rest of the visit.

In demo mode the sign-in page has **one-click demo accounts** (3 job seekers and 5 employers), and the footer has **Reset demo data**. Each browser tab has its own sign-in while all tabs share the data, so a seeker in one window and an employer in a second window of the same browser see each other's actions straight away. (A private window has separate data.)

## Pages

| Page | Who | What it does |
| --- | --- | --- |
| `index.html` | everyone | Home: what Fernway does, example matches, the employers hiring |
| `jobs.html` | everyone | Search and filter open jobs. Signed-in seekers see them ranked by match. |
| `job.html` | everyone | One job, how you match it, and the apply panel (note + consent) |
| `signup.html`, `signin.html` | everyone | Accounts for seekers and employers |
| `profile.html` | seekers | The profile employers see. **Build it with Fern** fills it in by chat. |
| `applications.html` | seekers | Every application, its status, the employer's message, and withdraw |
| `employer.html` | employers | Dashboard: jobs with applicant counts, and the company details |
| `employer-job.html` | employers | Post, edit, or close a job |
| `applicants.html` | employers | One job's applicants, by stage, sorted by best match |
| `applicant.html` | employers | One application: profile, note, match, contact, history, and the decision (accept, reject, offer, hired) |
| `privacy.html` | everyone | Privacy notice |

A bell in the header shows new notifications (an application arrived, a decision was made). It refreshes about once a minute while the tab is open.

## How matching works

Each job gets 0 to 5 leaflets on a fern frond, with the reasons spelled out:

- **1** if the job is in the seeker's area (engineering, design, and so on)
- **1** if it's at their experience level, or **½** if it's one level away
- **Up to 3** for skills: matching about five of the job's skills fills all three. A skill counts if it's in the profile's skills list or its headline.

A job outside the seeker's area that uses none of their skills scores 0. The same rules, worded for the other side, rank applicants for employers, so both sides always see the same match. The code is short and readable: [`src/app/match.js`](src/app/match.js).

## Fern, the profile helper

**Build it with Fern** on the profile page offers two chats. Both fill in the same profile form, which the seeker checks before saving.

| Chat | How it works | Needs |
| --- | --- | --- |
| **Guided chat** | Quick questions with buttons, about 2 minutes | Nothing |
| **Chat with AI** | Fern asks in plain language and also answers questions about Fernway | An [OpenRouter](https://openrouter.ai/keys) key (or Groq), or `AI_MOCK=true` for scripted replies |

The AI key stays on the server: the browser talks to `/api/chat`, a small Vercel function that calls the AI provider. If the AI is unavailable, the seeker can switch to the guided chat without losing answers.

## Run it on this computer

You need Node.js 24. **In PowerShell, type `npm.cmd` instead of `npm`.** Windows blocks the plain `npm` command by default with "running scripts is disabled on this system".

In this `frontend` folder:

```powershell
npm.cmd install
```

```powershell
npm.cmd run dev
```

Then open <http://localhost:5173>. The site starts in demo mode, so nothing else needs to run.

For the AI chat, copy `.env.example` to `.env.local` and set `AI_API_KEY` (and `AI_BASE_URL=https://openrouter.ai/api/v1` for OpenRouter), or set `AI_MOCK=true`. Restart `npm.cmd run dev` after editing it.

**Live mode locally:** start the backend from the project root, set `MARKETPLACE_MODE=live` in `.env.local`, and restart. Vite forwards `/api/v2` to `BACKEND_URL` (default `http://127.0.0.1:8000`).

## Settings

| Where | What | Secret? |
| --- | --- | --- |
| `.env.local` locally, Vercel environment variables when deployed | `MARKETPLACE_MODE`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_MOCK`, `ALLOWED_ORIGINS` (see [`.env.example`](.env.example)). Locally also `BACKEND_URL`. | **Yes**, read only by server functions |
| [`vercel.json`](vercel.json) | Sends `/api/v2/*` to the backend on Render, so sign-in cookies stay on the site's own address | No |
| [`shared/company.js`](shared/company.js) | Facts about Fernway. The pages and Fern's instructions both read it. | No |
| [`shared/options.js`](shared/options.js) | Areas, levels, job types, statuses and their labels. Change labels only, never values: the backend checks them. | No |
| [`shared/demo-data.json`](shared/demo-data.json) | Demo employers, jobs, seekers and applications. The backend's seed script loads the same file. | No |

## Deploy for free on Vercel

1. Import the GitHub repository on [vercel.com](https://vercel.com) and set **Root Directory** to `frontend`. Vercel detects Vite and deploys `api/*.js` as functions.
2. Under **Settings → Environment Variables**, add `AI_API_KEY` and `AI_BASE_URL` (or `AI_MOCK=true`).
3. For live mode, check that the address in `vercel.json` is your backend's, add `MARKETPLACE_MODE=live`, and redeploy.

## How it's built

Plain HTML, Tailwind CSS 4 and vanilla JavaScript, bundled by Vite. There's no framework, so every file is readable on its own.

```text
*.html                    One file per page (see the table above)
src/styles.css            Design tokens (light + dark) and components
src/app/                  Shared by every page
  api.js                  Picks demo or live mode
  api-live.js             Client for the backend's /api/v2
  api-demo.js             The same API, running in the browser
  shell.js                Header, notifications bell, footer, page start-up
  ui.js                   Components: tags, badges, forms, dialogs, the match frond
  match.js, format.js     Matching, and how values read on the page
src/pages/                One script per page
src/intake/               Fern: the chat window, guided chat, AI chat, profile builder
src/lib/                  Small helpers (building elements, the profile draft)
shared/                   Company facts, options and demo data (used by pages and server)
server/                   Server logic: AI chat and status
api/                      Thin Vercel wrappers around server/
vite.config.js            Build settings, plus a dev server that runs server/ locally
docs/                     Integration guide, blueprint review, notes for the backend
```

## Before you present

- [ ] Seeker: sign up, build the profile with Fern, check the ranked jobs, apply.
- [ ] Employer (in a second window of the same browser): see the notification, open the application, accept it with a message.
- [ ] Seeker again: the bell and **My applications** show the decision.
- [ ] One real AI chat, and `AI_MOCK=true` ready as a backup.
- [ ] Check on a phone, in dark mode, and with only the keyboard.

[docs/screenshots/](docs/screenshots/) shows the first version of the site, a single company's careers page, before Fernway became a marketplace.

See [docs/integration-guide.md](docs/integration-guide.md) for how the pieces connect, [docs/codex/](docs/codex/) for the backend API contract, and [docs/blueprint-issues.md](docs/blueprint-issues.md) for problems found in the original blueprint.
