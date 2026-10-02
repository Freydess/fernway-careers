# Review of the supplied blueprint

Reviewed 2 October 2026. The original file in Downloads was preserved. Its embedded master prompts and chatbot system prompt were treated as reference material for the requested backend and database work.

## Problems and corrections

| Issue in the document | Effect | Resolution in this project |
| --- | --- | --- |
| Section 5 starts an escaped code fence (`\`\`\`json`), contains keys such as `full\_name`, and never properly closes the JSON fence before section 6. Sections 6–7 have escaped heading and list syntax. | Copying this example does not produce a usable JSON contract; later sections render incorrectly. | A valid example is provided in `examples/application.json`, and the generated OpenAPI schema defines the contract. |
| `candidate_name`, `@name`, `full_name`; `target_role`, `role_interest`; and several resume/summary names differ across sections. | Integrations can silently map the wrong fields. | Canonical field names and the explicitly supported aliases are documented in `docs/integrations.md`. Unrecognized input fields fail validation. |
| The AI example has only seven fields and combines portfolio and resume into one URL. | It cannot capture all fields in section 2 or identify which kind of link was supplied. | Portfolio and resume have separate fields. A future chatbot must emit the canonical schema and collect consent before submission. |
| Experience level maps to `years_of_experience`. | Labels such as Junior cannot be stored as a numeric experience value. | Separate `experience_level` and decimal `experience_years` fields. |
| Salary has no currency or pay period. | 35,000 per month and 35,000 per year become indistinguishable. | Numeric compensation requires an explicit currency code and period; free-text expectations are also supported. |
| CRM lifecycle `Lead` is used beside hiring pipeline stages. | Sales lifecycle and application review states become conflated; updating an existing contact can interfere with its lifecycle. | Hiring state has its own local field and custom HubSpot property. `lifecyclestage=lead` is set only when creating a new contact. [HubSpot contacts documentation](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide). |
| Several proposed HubSpot properties are not guaranteed to exist; `notes_last_contact` is unsuitable as arbitrary candidate notes. | Writes fail or use an inappropriate CRM field. | An explicit list of custom `candidate_*` properties is supplied. Fit summaries use a custom field. Check your account schema before syncing. |
| Full name is automatically split into first and last name. | Compound, single-part, and international names may be misrepresented. | Preserve the exact name in `candidate_full_name`; no guessed name split. |
| Notion always uses Create Database Item. | Webhook retries and reapplications create duplicate review cards. | One local application per candidate and role, with Notion lookup by `Application ID` and update when found. |
| The direct Notion API needs a data source identifier. | A database container ID is not interchangeable with the data source ID used by the current integration. | Use `NOTION_DATA_SOURCE_ID` and pin `Notion-Version: 2025-09-03`. [Notion upgrade guide](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03). |
| No backend, relational database, migrations, authentication, retry policy, or failure ownership is specified. | The prompts alone are insufficient to build a reliable backend. | FastAPI, SQLAlchemy, Alembic, separate intake/admin secrets, submission receipts, and a transactional sync queue are implemented. |
| No explicit candidate consent field is collected. | The system cannot record the candidate's permission to process their application. | Required boolean consent, with a server-recorded timestamp. A real intake screen must explain the intended processing and collect the answer. This is a product requirement, not a claim of legal compliance. |
| File URLs are assumed to be directly accessible forever. | A private or expiring upload link may fail when recruiters open it. | Accept validated HTTPS links and forward them as references. Check access and durability with synthetic files before launch; binary storage and file scanning are not included. |
| The logic tree omits Other and Operations, and does not capture all fields requested elsewhere. | Missing or incompatible data reaches the backend. | Configure all required references; Engineering, Design, Marketing, Operations, and Other are supported. Optional experience and compensation fields must remain distinct. |
| Company details, actual job listings, and matching criteria are placeholders. | An AI cannot provide a grounded assessment of job fit. | Fit summaries are stored as supplied notes. No autonomous ranking, rejection, offer, or company-culture claim is generated. |
| Weekly reviews and prompt follow-up are promised, but no review schedule or notification workflow is defined. | The confirmation text may promise behavior the team cannot deliver. | Update intake copy to match your actual process; no email/Slack/Discord messages are sent. |

## Implemented scope

Backend portions of sections 1–3 and 6: local candidate/application persistence, validated intake, signed Typeform completion webhooks, email normalization, role-level reapplications, status history, integration mappings, CRM and Notion adapters, and a Zapier delivery adapter with retries.

The deterministic Typeform path is the initial intake option. A later custom chatbot can submit completed, validated applications to the same intake endpoint through a server. Website/embedding work and the complete live AI recruiter were not part of this backend delivery. No cloud account, live board, Zap, Typeform form, or HubSpot account has been created or modified.

HubSpot signup and connection are deferred until the website is ready, as requested. Local development remains fully usable with `SYNC_MODE=disabled`.

## Skills and plugins recommended before implementation

- **HubSpot plugin**: inspect your actual contact properties and verify CRM mappings once signup is complete. Suggested; connection has not been confirmed.
- **GitHub plugin**: repository management and review when you create a remote repository. Suggested; connection has not been confirmed.
- **Notion plugin** (already installed): inspect or manage the hiring board once a target board is chosen. No live changes were made.
- **Supabase or Neon plugin**, optionally: provision and inspect hosted PostgreSQL if you choose one of those providers. Neither is required for local development; neither was added.
- **`data-analytics:analyze-data-quality` skill**: useful later for auditing imported candidate records, duplicates, missing fields, and source consistency.
- **`skill-creator` skill**: useful later to save project-specific backend conventions, migration checks, and integration setup as a reusable skill. A custom skill is optional; none was created here.

The plugin-management skill was used for plugin discovery and recommendations. Other recommended skills were not needed for this implementation.
