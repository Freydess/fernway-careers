# Note for Codex: run the sync worker on Render

**Problem.** On Render, the backend runs from the `Dockerfile`, whose `CMD` starts only uvicorn. The sync worker (`python -m app.worker`) never runs. Once `SYNC_MODE=direct` is set, jobs for HubSpot and Notion would be queued and never processed. Render's free plan has no separate background worker service.

**Requested change.** Start the worker next to the API in the same container, for example:

```dockerfile
CMD ["sh", "-c", "python -m app.worker & exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

Things to check:

- With `SYNC_MODE=disabled`, the worker logs "External sync is disabled" and exits. That's fine.
- If the worker crashes, nothing restarts it. Consider a small restart loop, or starting it from the app's lifespan instead.
- Render's free service sleeps when idle. Jobs are created by requests that wake it, so they're processed while it's awake. Stuck jobs can be re-queued with `POST /api/v1/applications/{id}/sync`.

## Second request: fit HubSpot's free plan (10 custom properties)

HubSpot's free CRM allows **10 custom properties for the whole account**. `hubspot_properties()` in `app/integrations.py` and `docs/hubspot-properties.json` use **12**. A PATCH or POST that names a missing property is rejected, so every HubSpot job would fail.

Suggested change, which brings it to exactly 10:

- `candidate_full_name` → use HubSpot's standard `firstname` / `lastname` properties instead. Split on the last space; a single-word name goes in `firstname` only.
- `candidate_timezone` → stop sending it to HubSpot. It's still stored locally and sent to Notion.
- Update `docs/hubspot-properties.json` and `docs/integrations.md` to match, and update any tests that assert the property list.

The user will create the remaining 10 properties in HubSpot by hand, or with a script, after this lands.

**Agreed plan (2026-10-04, chosen by the user).** Use `SYNC_MODE=direct` on Render with `HUBSPOT_ACCESS_TOKEN`, `NOTION_TOKEN` and `NOTION_DATA_SOURCE_ID`. Zapier's free plan has no webhooks and allows only two-step Zaps, so Zapier mode isn't used. Typeform's free plan likely has no webhooks either, so Typeform entries reach HubSpot or Notion through a two-step Zap instead of `/api/v1/webhooks/typeform`.
