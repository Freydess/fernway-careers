import { json } from './http.js';

/** GET /api/status: which server features are switched on. Never includes secrets. */
export function handleStatusRequest({ env }) {
  const aiMock = env.AI_MOCK === 'true';
  const intakeDemo = env.INTAKE_DEMO === 'true';
  return json(
    200,
    {
      ai: { enabled: aiMock || Boolean(env.AI_API_KEY), mock: aiMock },
      intake: { enabled: intakeDemo || Boolean(env.INTAKE_API_TOKEN), demo: intakeDemo },
    },
    { 'Cache-Control': 'no-store' },
  );
}
