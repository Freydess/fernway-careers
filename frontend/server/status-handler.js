import { json } from './http.js';

/** GET /api/status: which server features are switched on. Never includes secrets. */
export function handleStatusRequest({ env }) {
  const aiMock = env.AI_MOCK === 'true';
  return json(
    200,
    {
      ai: { enabled: aiMock || Boolean(env.AI_API_KEY), mock: aiMock },
      // "live" = accounts, jobs and applications come from the backend's /api/v2.
      // Anything else = demo mode, where the marketplace runs in the visitor's browser.
      marketplace: { mode: env.MARKETPLACE_MODE === 'live' ? 'live' : 'demo' },
    },
    { 'Cache-Control': 'no-store' },
  );
}
