# Integration guide: frontend ↔ backend ↔ Typeform and Groq

## How the data flows

```text
Guided chat (C) ─┐
                 ├─► review + consent ─► /api/apply ──► backend POST /api/v1/intake ─► database ─► HubSpot + Notion
AI chat (B) ─────┘                         (adds the intake token,       (validates, dedupes,      (worker, when
     │                                      honeypot, rate limit)         stores receipts)          SYNC_MODE is set)
     └─► /api/chat ─► Groq (Fern's replies; the AI key stays on the server)

Typeform (A) ─► Typeform ─► backend POST /api/v1/webhooks/typeform (signed) ─► database ─► HubSpot + Notion
```

One route per form: the page never writes to HubSpot or Notion itself, so nothing is processed twice.

## What the page sends

`/api/apply` forwards exactly the backend's intake schema, leaving out empty optional fields. Example from a real local test:

```json
{
  "full_name": "Ploy Srisuk",
  "email": "ploy.test@example.com",
  "phone": "+66 00 000 0000",
  "timezone": "Asia/Bangkok",
  "target_role": "engineering",
  "experience_level": "junior",
  "experience_years": 2,
  "portfolio_url": "https://github.com/ploy-dev",
  "resume_url": "https://drive.google.com/file/d/test-resume/view",
  "compensation_amount": 35000,
  "compensation_currency": "THB",
  "compensation_period": "month",
  "availability": "In 2–4 weeks",
  "fit_summary": "Engineering · Junior level, 2 years · Can start in 2–4 weeks\nLanguages and frameworks: TypeScript, React, Python and PostgreSQL\n\nInterested in: Frontend Engineer, Backend Engineer, Software Engineering Intern",
  "role_answers": {
    "tech_stack": "TypeScript, React, Python and PostgreSQL",
    "applied_via": "Guided chat",
    "interested_roles": "Frontend Engineer, Backend Engineer, Software Engineering Intern"
  },
  "consent_to_process": true
}
```

`role_answers` keys used by the page are `tech_stack`, `case_study`, `acquisition_channels` and `key_metrics` (the backend's Typeform references), plus `highlights`, `interested_roles` and `applied_via` (`Guided chat` or `AI recruiter`). `applied_via` lets you compare the paths, as in the blueprint's Section 7.

Each application gets an `Idempotency-Key`. Retrying the same answers reuses it, so a flaky connection can't create duplicates. Edited answers get a new key.

## The page's server functions

| Route | Does | Notable answers |
| --- | --- | --- |
| `GET /api/status` | Says which features are on (no secrets) | `{ ai: { enabled, mock }, intake: { enabled, demo } }` |
| `POST /api/apply` | Forwards an application to the backend | `201` ok · `422` with `fields: [{ field, message }]` for the form · `429` rate-limited · `502` backend unreachable |
| `POST /api/chat` | One turn with Fern | `{ reply, fields, complete }` · `503` no key · `429` with `retryAfter` |

The same code runs on Vercel (`api/*.js`) and in `npm.cmd run dev` (`vite.config.js`).

## Path B: Fern on Groq's free tier

1. Sign up at [console.groq.com](https://console.groq.com). It's free and needs no card. Then create a key under **API Keys**.
2. Locally, put it in `frontend/.env.local` as `AI_API_KEY=…` and restart the dev server. On Vercel, add it as an environment variable.
3. The default model is `openai/gpt-oss-120b`, which supports strict JSON schemas on Groq. `openai/gpt-oss-20b` is smaller and faster if you hit limits.

The free tier has per-minute and per-day limits; your exact numbers are on Groq's limits page. To stay within them, only the last 16 messages go to the model (earlier facts travel as a compact summary), and reasoning is kept brief. If Groq is busy, Fern waits and retries once, then offers the guided chat.

**Privacy:** candidates' chat messages are processed by Groq. This is stated in the privacy notice.

**Other providers:** `AI_BASE_URL` and `AI_MODEL` accept any OpenAI-compatible provider that supports `response_format: json_schema`. To use Claude instead, which is paid (the cheapest model, Claude Haiku 4.5, costs $1 / $5 per million input/output tokens), replace the provider call in `server/chat-handler.js` with the official Anthropic SDK. That change stays inside one function.

**Demo mode:** `AI_MOCK=true` makes Fern follow a fixed script. It's a backup for presentations without internet or a key.

## Path A: Typeform on the free plan

The free plan allows 10 questions and 10 responses a month, and most likely no branching logic or hidden fields. So this version is a single linear form. Set each question's **reference** (in the question settings) exactly as shown, because the backend maps answers by reference. Choice labels must also match exactly; the backend lowercases them.

| # | Question | Type | Reference | Required |
| --- | --- | --- | --- | --- |
| 1 | What’s your full name? *(add the privacy notice link in the description)* | Short text | `full_name` | Yes |
| 2 | Nice to meet you, {{full name}}! Which area fits you best? | Multiple choice: `Engineering`, `Design`, `Marketing`, `Operations`, `Other` | `target_role` | Yes |
| 3 | What do you do best? Your tech stack, a design project you’re proud of, or a result you’ve driven. | Long text | `fit_summary` | No |
| 4 | How would you describe your experience level? | Multiple choice: `Intern`, `Junior`, `Mid`, `Senior`, `Lead` | `experience_level` | No |
| 5 | A link to your work: GitHub, portfolio, Figma or LinkedIn | Website | `portfolio_url` | No |
| 6 | A link to your resume (set sharing to “anyone with the link”) | Website | `resume_url` | No |
| 7 | When could you start? | Multiple choice: `Immediately`, `In 2–4 weeks`, `In 1–3 months`, `Just exploring` | `availability` | No |
| 8 | Best email to reach you? | Email | `email` | Yes |
| 9 | Phone number | Phone number | `phone` | No |
| 10 | May Fernway store and use these details to review your application? *(link the privacy notice)* | Yes/No | `consent_to_process` | Yes |

The endings text could read: "Thanks! Our team reviews new applications every week and replies within 7 days."

Then:

1. Put the form ID (the end of its share link) in `src/config.js` under `typeform.formId`. The "Typeform" option then appears in the chat window.
2. Keep `sandbox: true` while designing: nothing is recorded and your 10 responses are saved for real tests. Sandbox submissions don't reach the webhook either.
3. The backend owner sets `TYPEFORM_FORM_ID` and `TYPEFORM_WEBHOOK_SECRET`, and points the Typeform webhook at `https://<public backend>/api/v1/webhooks/typeform` (see [`../../docs/integrations.md`](../../docs/integrations.md)).
4. On a paid plan you can add the branch questions back, with references `tech_stack`, `github_url`, `case_study`, `design_system`, `acquisition_channels`, `key_metrics` and `linkedin_url`.

## What was tested (2 October 2026)

Run against the real backend, on a throwaway copy of its database:

- Guided chat from start to finish, using only the keyboard. The backend stored the candidate, the application (structured pay, `https` links, role answers, consent) and one idempotency receipt.
- AI chat (demo mode) through the real `/api/chat` route, then review and send. Stored with `applied_via: AI recruiter`.
- Consent left unticked: blocked with a message, and focus moves to the checkbox.
- The backend's validation errors (bad email, unknown time zone, `http://` link) come back as field-level messages. The honeypot gets a fake success and nothing is forwarded. A missing idempotency key is rejected.
- Phone layout (375 px, no sideways scrolling, chat goes full-screen), dark mode, and the production build.

Not tested here, because each needs an account: live Groq replies, a real Typeform, and Vercel deployment.
