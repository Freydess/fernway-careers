// POST /api/apply: the website's go-between for the Python backend.
// The backend's intake token must never reach the browser (see the root README), so the
// page posts here and this function adds the token, plus the abuse checks the backend
// asks public callers to own: same-site check, a honeypot and rate limiting.

import { clientKey, createRateLimiter, isAllowedOrigin, json } from './http.js';

// The fields the backend's intake schema accepts (app/schemas.py). Anything else is
// dropped here, because the backend rejects unknown keys.
const INTAKE_FIELDS = [
  'full_name',
  'email',
  'phone',
  'timezone',
  'target_role',
  'role_detail',
  'experience_level',
  'experience_years',
  'portfolio_url',
  'resume_url',
  'compensation_expectations',
  'compensation_amount',
  'compensation_currency',
  'compensation_period',
  'availability',
  'fit_summary',
  'role_answers',
  'consent_to_process',
];
const IDEMPOTENCY_KEY = /^[A-Za-z0-9-]{16,100}$/;
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';
const limitSubmissions = createRateLimiter({ limit: 6, windowMs: 10 * 60_000 });

export async function handleApplyRequest({ method, body, headers, ip, env }) {
  if (method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  if (!isAllowedOrigin(headers, env)) return json(403, { error: 'forbidden_origin' });
  if (!body || typeof body !== 'object' || !body.application || typeof body.application !== 'object') {
    return json(400, { error: 'invalid_body' });
  }
  // Honeypot: people never see the "website" field, but form-filling bots do. Pretend it worked.
  if (body.website) return json(201, { ok: true, application_id: null, duplicate: false });
  if (typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(body.idempotencyKey)) {
    return json(400, { error: 'invalid_idempotency_key' });
  }
  const wait = limitSubmissions(clientKey(headers, ip));
  if (wait) return json(429, { error: 'rate_limited', retryAfter: wait }, { 'Retry-After': String(wait) });

  const intake = Object.fromEntries(
    INTAKE_FIELDS.filter((key) => body.application[key] !== undefined).map((key) => [key, body.application[key]]),
  );

  if (env.INTAKE_DEMO === 'true') {
    return json(201, { ok: true, demo: true, application_id: null, duplicate: false, payload: intake });
  }
  if (!env.INTAKE_API_TOKEN) {
    console.error('[apply] INTAKE_API_TOKEN is not set, so applications cannot reach the backend.');
    return json(503, { error: 'intake_not_configured' });
  }

  const backendUrl = (env.BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
  let response;
  try {
    response = await fetch(`${backendUrl}/api/v1/intake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.INTAKE_API_TOKEN}`,
        'Idempotency-Key': body.idempotencyKey,
      },
      body: JSON.stringify(intake),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error(`[apply] Could not reach the backend at ${backendUrl}: ${error.message}`);
    return json(502, { error: 'backend_unreachable' });
  }

  const data = await response.json().catch(() => null);
  if (response.status === 201) {
    return json(201, { ok: true, application_id: data?.application_id ?? null, duplicate: Boolean(data?.duplicate) });
  }
  if (response.status === 422) return json(422, { error: 'validation', fields: validationFields(data?.detail) });
  if (response.status === 409) return json(409, { error: 'conflict' });
  if (response.status === 413) return json(413, { error: 'too_large' });
  console.error(`[apply] The backend answered ${response.status}${response.status === 401 ? ' (check INTAKE_API_TOKEN)' : ''}.`);
  return json(502, { error: 'backend_error' });
}

/** The backend's 422 detail -> [{ field, message }] that the form can show next to inputs. */
function validationFields(detail) {
  if (!Array.isArray(detail)) return [];
  return detail.map((item) => ({
    field: Array.isArray(item?.loc) ? String(item.loc.filter((part) => part !== 'body')[0] ?? '') : '',
    message: String(item?.msg ?? '').replace(/^Value error, /, ''),
  }));
}
