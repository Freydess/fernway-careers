# Integration setup and field mappings

Keep `SYNC_MODE=disabled` during local development. HubSpot signup is deferred until your website exists. Plugins used inside Codex and runtime API credentials in `.env` are separate connections: adding a plugin does not automatically configure this server.

## Canonical input and mappings

| Input | Local storage | HubSpot contact property | Notion property / type |
| --- | --- | --- | --- |
| `full_name` | Candidate full name | `candidate_full_name` / text | `Name` / Title |
| `email` | Candidate unique normalized email | `email` / standard | `Email` / Email |
| `phone` | Candidate phone | `phone` / standard | `Phone` / Phone |
| `timezone` | Candidate timezone | `candidate_timezone` / text | `Timezone` / Rich text |
| `target_role` | Role category; candidate/role uniqueness | `candidate_target_role` / select | `Role` / Select |
| `role_detail` | Particular role or focus | `candidate_role_detail` / text | `Role Details` / Rich text |
| `experience_level` | Label, separately from years | `candidate_experience_level` / select | `Experience` / Select |
| `experience_years` | Decimal years | `candidate_experience_years` / number | `Experience Years` / Number |
| `portfolio_url` | HTTPS portfolio URL | `website` / standard | `Portfolio` / URL |
| `resume_url` | HTTPS resume reference | `candidate_resume_url` / text | `Resume` / URL |
| `compensation_amount`, `compensation_currency`, `compensation_period` | Decimal + currency + pay period | `candidate_salary_expectations` / formatted text | `Salary Expectation` / Rich text |
| `compensation_expectations` | Optional free-text alternative | Same salary field if amount is absent | Same salary property if amount is absent |
| `availability` | Availability text | `candidate_availability` / text | `Availability` / Rich text |
| `fit_summary` | Supplied summary notes | `candidate_fit_summary` / text | `Summary Notes` / Rich text |
| `role_answers` | Branch answers as JSON | Not sent to HubSpot | `Role Answers` / Rich text |
| `consent_to_process` | Required true + server UTC consent time | Local audit only | Local audit only |
| Server application ID | Stable application UUID | `candidate_application_id` / text | `Application ID` / Rich text |
| Server hiring status | Stage + history | `candidate_application_status` / select | `Status` / Status |

Allowed roles: Engineering, Design, Marketing, Operations, Other (stored lowercase). Allowed experience labels: Intern, Junior, Mid, Senior, Lead. Optional fields may be null or omitted. Compensation periods: `hour`, `day`, `month`, `year`, `project`; a numeric amount requires a three-letter uppercase currency code and a period. Currency codes are syntactically checked; the service does not convert currencies.

Supported aliases at the API boundary: `candidate_name → full_name`, `candidate_email → email`, `candidate_phone → phone`, `resume_file → resume_url`, `availability_window → availability`, `summary_of_fit → fit_summary`. A `resume_file` alias must contain a URL, not binary data. The malformed blueprint's `role_interest` and combined `portfolio_or_resume_url` are deliberately excluded; the producer must choose a valid role category and the correct URL field. Do not send both an alias and its canonical name.

## Typeform → local backend

1. Create the deterministic form with branches for all five role categories. Include required full name, email, role, and an explicit Yes/No consent question. The backend accepts completed submissions only; it rejects missing or false consent.
2. Give questions stable references matching the input names in the table. Alternatively set `TYPEFORM_FIELD_MAP_JSON` in `.env` to a JSON object, such as `{"field-name-id":"full_name","field-email-id":"email"}`. ID mappings take precedence over references.
3. Supported branch references: `tech_stack`, `github_url`, `case_study`, `design_system`, `acquisition_channels`, `key_metrics`, and `linkedin_url`. These become `role_answers`. The general portfolio and resume questions need their own references.
4. Set `TYPEFORM_FORM_ID` and a random `TYPEFORM_WEBHOOK_SECRET` in `.env`. Configure the same secret in the Typeform webhook settings. Use the URL `https://<your-backend>/api/v1/webhooks/typeform` after hosting the backend with a valid HTTPS certificate.
5. Subscribe to completed `form_response` events, not partial responses. The server checks the form ID and completion timestamp and deduplicates by form ID plus response token.
6. Deliver a synthetic completed response, verify its application and receipt locally, and confirm that an identical signed redelivery does not create another record.

Signatures use HMAC-SHA256 over the exact raw request body, base64-encoded with a `sha256=` prefix. [Typeform's signature specification](https://www.typeform.com/developers/webhooks/secure-your-webhooks/). The webhook receiver needs no API bearer token; Typeform must sign it.

File upload answers map from `file_url` into `resume_url`. No binaries are downloaded. For a private Typeform upload, verify that your chosen review system can access the link; do not assume a webhook URL is a permanent public file. If you need independent file hosting, provision private storage and a controlled access policy before extending the backend to copy uploads.

## Future custom chatbot → local backend

Collect the canonical fields and submit the JSON from your chatbot's server to `POST /api/v1/intake`, with the intake bearer token and a unique `Idempotency-Key` per completed conversation. Use the same key when retrying the same completion. The API validates the structured output before saving anything. It does not parse fenced JSON from chat transcripts or run an LLM.

Do not invent numeric experience from an experience label, infer consent, merge portfolio/resume links, or let the model assign a hiring stage. `fit_summary` is a supplied note for human review, not an automated hiring decision. Real vacancies, company information, and fit criteria are still missing from the supplied blueprint and are needed before implementing matching or a live recruiter.

## Direct mode: HubSpot and Notion

Set `SYNC_MODE=direct` only after both integrations are ready, then restart the API and worker to load the settings. Both adapters receive jobs; a failure in one does not erase the local application or the other target's successful result.

### HubSpot (deferred until website/signup is ready)

1. Create your account later, then create an app/token authorized to read and write CRM contacts. This runtime uses HubSpot's contact API directly, rather than a Codex plugin session.
2. Create the `candidate_recruitment` property group and the custom contact properties described in `docs/hubspot-properties.json`. The JSON is a setup specification: create the group and each property separately in HubSpot, or use the corresponding CRM properties endpoints with an authorized token. It is not a single API request.
3. Set `HUBSPOT_ACCESS_TOKEN` privately in `.env`. Confirm standard `email`, `phone`, and `website` properties exist. Validate the custom property's internal names and enumeration values exactly.
4. Test with a synthetic email. The adapter looks up a contact by email, patches existing contacts, and creates missing contacts. It preserves existing lifecycle values; new contacts receive `lead`.
5. Confirm that resubmitting the candidate does not create another contact and that your applicant data appears in the custom properties.

One contact represents a person; its application-related properties reflect the latest locally updated application for that candidate. Notion and the local database retain one record per role. Real multiple job openings within one discipline would require a `job_id` dimension in the local schema. [HubSpot contact read/create/update behavior](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide).

### Notion

1. Create a private Candidate ATS Tracker table and an internal integration with read, insert, and update capabilities. Share this table with the integration.
2. Configure the property names and types from `docs/notion-schema.json` in the Notion UI. The file is a specification, not a complete API creation payload. Set the board's grouping property to `Status`.
3. Create all seven exact status labels: `New Applicants`, `Screening`, `Interview`, `Offered`, `Hired`, `Rejected`, `Withdrawn`. Configure role and experience options exactly as specified. Use a URL property for Resume in this implementation.
4. Obtain the table's **data source ID**, set `NOTION_DATA_SOURCE_ID`, and set the integration token in `NOTION_TOKEN`. Keep the pinned `NOTION_API_VERSION=2025-09-03` unless you deliberately update and test the adapter.
5. Test a synthetic application and a status change. The adapter searches by `Application ID`, creates when absent, and patches an existing page. It stores the returned page ID locally. Multiple matches are treated as a configuration/data error.

Notion's API separates database containers and data sources; the data source identifier is used by this adapter. [Notion API upgrade guide](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03).

This implementation synchronizes from the backend to the review board. Change hiring stages through the admin API. Manual edits to the board are not imported back and can be overwritten by a later sync. Bidirectional editing needs a separate authenticated webhook/reconciliation workflow.

## Zapier mode (alternative to direct mode)

The blueprint's automation hub remains supported. Use `SYNC_MODE=zapier` and set `ZAPIER_WEBHOOK_URL` to an HTTPS Webhooks by Zapier Catch Hook under `hooks.zapier.com/hooks/catch/`. This mode queues only Zapier jobs, so the backend does not also run direct HubSpot/Notion writes.

The backend sends:

```json
{
  "event_id": "stable-sync-job-uuid",
  "event_type": "application.sync",
  "application": {"id": "application-uuid", "email": "alex@example.com", "status": "new_applicants", "version": 1}
}
```

The real `application` object contains the complete saved snapshot. The same `event_id` is also sent as the `Idempotency-Key` header. A job's snapshot is fixed for retries.

Configure the Zap:

1. Catch the hook. Keep `event_id`, `application.id`, and `application.version` throughout the Zap. Add receiver-side duplicate-event tracking. A successful webhook response only proves Zapier accepted the delivery, not that downstream actions completed.
2. Find/create or update the HubSpot contact by normalized `application.email`. Map custom properties from the table above and preserve existing lifecycle values.
3. Find the Notion row by `Application ID=application.id`; update it when found, otherwise create it. Map the received stage on every sync; do not hardcode New Applicants for subsequent status updates.
4. Ensure an older `application.version` cannot overwrite a newer stored version in the destination. Store the last applied version in your Zap or an additional destination property. Downstream Zap runs may finish out of order even when webhook requests were delivered in order.
5. Configure Zapier failure monitoring and test duplicates and partial failures. Notification steps are optional future work; no messages are sent by this backend.

If Typeform is connected directly to a Zap instead of this backend's signed webhook, add an authenticated request from the Zap to `POST /api/v1/intake`, using canonical JSON and the response token as the idempotency key. Choose one canonical intake route per form to avoid processing the same application twice through independent sources.

## Operational checks

Run the worker after enabling a mode. Applications already saved while syncing was disabled can be queued through `POST /api/v1/applications/{id}/sync`. Inspect `GET /api/v1/sync-jobs` for success, `retry`, or `dead`. Retry failed jobs after fixing the underlying credentials/schema. If a newer revision exists, queue a fresh application sync instead of replaying an older snapshot.

Restart both the API and worker after editing `.env`. Workers only claim targets belonging to the current mode; disabled mode processes no jobs. Changing modes leaves jobs for the previous mode in the database; review them before switching back. Start with one worker and verify hosted operation before increasing concurrency.
