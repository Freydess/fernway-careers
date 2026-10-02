// Calls to the site's own server functions (frontend/api/*.js).

let statusPromise;

/**
 * Which server features are switched on: { ai: { enabled, mock }, intake: { enabled, demo } }.
 * Resolves to null on static hosting without server functions.
 */
export function fetchServerStatus() {
  statusPromise ??= fetch('/api/status', { headers: { Accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return statusPromise;
}

const newKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

let lastAttempt = null;

/**
 * Sends a finished application. Retrying the same payload reuses its Idempotency-Key,
 * so a flaky connection can't create duplicates; changed details get a fresh key
 * (the backend answers 409 if one key is reused for different data).
 */
export async function submitApplication(payload, { honeypot = '' } = {}) {
  const serialized = JSON.stringify(payload);
  if (lastAttempt?.serialized !== serialized) lastAttempt = { serialized, key: newKey() };
  let response;
  try {
    response = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ application: payload, idempotencyKey: lastAttempt.key, website: honeypot }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  const data = await response.json().catch(() => ({}));
  if (response.ok && data.ok) return { ...data, ok: true };
  return { ...data, ok: false, status: response.status, error: data.error ?? `http_${response.status}` };
}
