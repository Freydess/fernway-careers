# Blueprint review: frontend and integration

Reviewed 2 October 2026 against `Personalized_Employment_System_Blueprint.md`. The backend has its own review in [`../../docs/blueprint-review.md`](../../docs/blueprint-review.md); this file covers the frontend side and the issues found while connecting the two.

## Fixed in the frontend

| Problem in the blueprint | What the frontend does instead |
| --- | --- |
| The same data has three sets of field names (Section 2, the Typeform tree and the AI JSON). | Every chat produces the backend's canonical intake fields (`app/schemas.py`). The server go-between drops anything else. |
| Role areas were inconsistent: "Engineering, Design, Marketing, Other" in one place, "Marketing/Operations" in another. | The backend's five areas: Engineering, Design, Marketing, Operations, Other. |
| "Other" had no branch, and branches didn't jump back, so Typeform would show the wrong questions. | The guided chat has a branch for every area, and already-answered questions are skipped. |
| Branches didn't match their own descriptions (case study vs "favorite design system", key metrics vs "acquisition channels"). | Design asks for a case study. Marketing asks for channels *and* a result. Answers go to `role_answers` using the backend's reference names. |
| The Typeform tree never asks for phone, experience, pay or time zone, but they're mapped anyway. | The guided chat asks for all of them; time zone is detected from the device and editable. |
| The button promises "Find your perfect role", but nothing suggests a role. | A matching step suggests up to three open roles, with reasons, before the review. |
| No privacy notice or consent step. | A required consent checkbox (sent as `consent_to_process`) and a [privacy notice](../privacy.html). |
| Path B, built as "frontend widget code", would expose the AI API key. | The key lives only in the `/api/chat` server function. |
| Any public submit address invites spam. | `/api/apply` adds a honeypot field, a same-site check and rate limiting, and keeps the backend's intake token on the server. |
| Typeform file-upload links need a Typeform login to open. | The chats ask for a share link (Google Drive, Dropbox or OneDrive) and check it's a public `https://` link. |
| The AI was told to append JSON to its last message, which is fragile. | Every AI turn is strict structured output, validated on the server. The AI never submits anything; the candidate reviews and sends. |
| `[Company Name]` and `[Insert Company Values/Info]` placeholders. | Fernway's facts and seven open roles live in `shared/`, used by both the page and Fern. |

## Handled by the backend

Wrong HubSpot fields (`notes_last_contact`), custom properties, lifecycle handling, duplicate Notion cards, the Notion data source ID, the broken JSON example, guessed name splitting, pay without currency or period, experience labels vs years, and missing Rejected/Withdrawn stages. See the backend's review for details.

## Still open: decisions for the team

1. **HubSpot's free plan allows only 10 custom properties for the whole account.** `docs/hubspot-properties.json` defines 12, so direct sync will fail on a free account. Drop or merge two of them, for example by storing the time zone inside the fit summary and the application status only in Notion. *(HubSpot / backend owner)*
2. **The backend's Zapier mode needs a paid Zapier plan**, because Webhooks by Zapier is a Premium app. On free plans use `SYNC_MODE=direct`. If your course requires Zapier, you'll need a paid plan or a trial. *(team)*
3. **Typeform's free plan** gives 10 questions per form and 10 responses a month. It most likely has no branching logic, hidden fields or file uploads. The backend docs ask for "branches for all five role categories", which needs a paid plan. A linear 10-question version is in the [integration guide](integration-guide.md#path-a-typeform-on-the-free-plan). *(Typeform owner)*
4. **The Typeform webhook needs the backend on a public HTTPS address**, not `127.0.0.1`. For a demo, a free tunnel such as Cloudflare Tunnel works; otherwise, host the backend. *(backend owner)*
5. **A deployed site only saves applications if the backend is online.** Until it's hosted, use `INTAKE_DEMO=true` on Vercel for presentations. *(team)*
6. **The "we review weekly and reply within 7 days" promise** appears on the page and after applying. Either do it, or change `reviewPromise` in `shared/company.js`. *(team)*
7. **The privacy notice's 12-month retention is a placeholder.** Agree on a real retention and deletion process across the database, HubSpot and Notion. The backend README notes this isn't configured yet. *(team)*
8. **The blueprint file still has its formatting problems**: an unclosed code block that swallows Sections 6–7, raw `##`/`**` symbols, and a broken comparison table. Fix it in the source document if you're handing it in. *(whoever submits it)*
