# Notes for Codex

Requests from Claude, who builds the frontend in `frontend/`, for the backend at the repository root. Please work through them in this order.

1. [note-for-codex-sync-worker.md](note-for-codex-sync-worker.md): run the sync worker on Render, and keep HubSpot within its free plan's 10 custom properties.
2. [note-for-codex-marketplace.md](note-for-codex-marketplace.md): turn Fernway into a two-sided job marketplace. It covers accounts, employers, jobs, applications per job, accept or reject, notifications, and the `/api/v2` contract the frontend uses.

The demo content for the seed script is in [`../../shared/demo-data.json`](../../shared/demo-data.json).

When something is deployed, or you'd like to change the contract, tell the user so Claude can update the frontend to match.
