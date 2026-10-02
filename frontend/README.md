# Fernway careers page (frontend)

The candidate-facing part of the Personalized Employment System: a careers page where people apply by chatting for about 2 minutes. Applications go to the Python backend in the project root, which stores them and syncs them to HubSpot and Notion.

Fernway is a fictional company created for this project. Change its details in `shared/company.js` and its jobs in `shared/roles.js`. The page and the AI recruiter both read these files.

## Three ways to apply, all on free tiers

| Path | What the candidate sees | Where the answers go | What it needs |
| --- | --- | --- | --- |
| **C · Guided chat** (default) | Quick questions with buttons, then roles that fit, with reasons | `/api/apply` → backend `POST /api/v1/intake` | The backend running |
| **B · AI chat with Fern** | A free-form chat; Fern also answers questions about Fernway | The same as C, after the candidate checks the summary and gives consent | A free [Groq](https://console.groq.com/keys) API key |
| **A · Typeform** | Typeform's own chat-style form, in a popup | Typeform → the backend's signed webhook | A Typeform form ID ([build sheet](docs/integration-guide.md#path-a-typeform-on-the-free-plan)) |

The guided and AI chats end on the same review screen, where everything is editable and consent is required. If Fern is unavailable, the candidate can switch to the guided chat without losing their answers.

## Run it on this computer

You need Node.js 20 or newer (Node 24 LTS is installed). **In PowerShell, type `npm.cmd` instead of `npm`.** Windows blocks the plain `npm` command by default with "running scripts is disabled on this system".

1. Start the backend from the project root: `.\scripts\run.ps1 api`
2. In a second terminal, from this `frontend` folder:

   ```powershell
   npm.cmd install
   npm.cmd run dev
   ```

3. Open <http://localhost:5173>.

The dev server reads the backend's `INTAKE_API_TOKEN` from the project root `.env` automatically. For the AI chat, copy `.env.example` to `.env.local` and add `AI_API_KEY`, or set `AI_MOCK=true` for scripted demo replies. Restart `npm.cmd run dev` after editing any `.env` file.

**No backend running?** Set `INTAKE_DEMO=true` in `.env.local`. The thank-you screen then shows exactly what would have been sent, and nothing is saved. This is useful for presentations.

## Settings

| Where | What | Secret? |
| --- | --- | --- |
| `src/config.js` | Which chat opens first, the mode switch, the Typeform form ID and test mode | No, it ships to the browser |
| `.env.local` locally, Vercel environment variables when deployed | `AI_API_KEY`, `AI_MODEL`, `BACKEND_URL`, `INTAKE_API_TOKEN`, `INTAKE_DEMO`, `AI_MOCK`, `ALLOWED_ORIGINS` (see `.env.example`) | **Yes**, read only by server functions |
| `shared/company.js`, `shared/roles.js` | Company facts, values, perks, hiring process, open roles | No |

You can deep-link a mode for demos: `?intake=ai`, `?intake=guided` or `?intake=typeform`.

## Deploy for free on Vercel

1. Put the project on GitHub (the root `.gitignore` already excludes `.env`, `data/` and `node_modules/`).
2. On [vercel.com](https://vercel.com), import the repository and set **Root Directory** to `frontend`. Vercel detects Vite and deploys `api/*.js` as serverless functions automatically.
3. Under Settings → Environment Variables, add `AI_API_KEY`, `INTAKE_API_TOKEN` and `BACKEND_URL`.

A deployed site can only save applications if the backend is reachable from the internet over HTTPS. Locally it only listens on `127.0.0.1`. Until the backend is hosted, set `INTAKE_DEMO=true` on Vercel for a working demo.

## How it's built

Plain HTML, Tailwind CSS 4 and vanilla JavaScript, bundled by Vite. There's no framework, so every file is readable on its own.

```text
index.html, privacy.html   The two pages
src/main.js                Page wiring: job cards, filters, buttons
src/config.js              Public settings
src/styles.css             Design tokens (light + dark) and components
src/intake/                The application dialog
  intake.js                Mode switching and screens (chat → review → thanks)
  chat-ui.js               Chat bubbles and answer controls ("composers")
  guided.js                Path C script
  ai.js                    Path B client
  review.js                Editable review, consent, thank-you screen
src/lib/                   Helpers: application data, matching, API calls, Typeform embed
shared/                    Company facts, roles and answer options (used by page and server)
server/                    Server logic: apply go-between, AI chat, status
api/                       Thin Vercel wrappers around server/
vite.config.js             Build settings, plus the dev server that runs server/ locally
docs/                      Blueprint review and integration guide
```

## Before you present

Slide-ready screenshots (2× resolution: desktop, phone and dark mode) are in [docs/screenshots/](docs/screenshots/). The AI chat screenshot was taken in demo mode, which is why it shows a "Demo replies" badge.

- [ ] Guided chat: go from start to "Your application is in", then confirm it appears via the backend's admin API (`GET /api/v1/applications`).
- [ ] AI chat: one real conversation with your Groq key, and one with `AI_MOCK=true` as a backup.
- [ ] Typeform: a test in sandbox mode, then one real response with `sandbox: false` (you get 10 free a month).
- [ ] Check on a phone, in dark mode, and using only the keyboard.

See [docs/integration-guide.md](docs/integration-guide.md) for the data contract and setup steps, and [docs/blueprint-issues.md](docs/blueprint-issues.md) for what was wrong with the blueprint and what's still open.
