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
    // Every page waits for this before it draws, and the answer only changes on a redeploy.
    // Browsers reuse it for a minute and Vercel's CDN answers without starting the function,
    // so a change of MARKETPLACE_MODE can take a minute or two to reach everyone.
    { 'Cache-Control': 'public, max-age=60', 'Vercel-CDN-Cache-Control': 'max-age=60, stale-while-revalidate=3600' },
  );
}
