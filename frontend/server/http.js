// Helpers shared by the server functions (Vercel in production, the Vite dev server locally).
// Every handler takes { method, body, headers, ip, env } and returns { status, body, headers }.

export function json(status, body, headers = {}) {
  return { status, body, headers };
}

/** Requests from the site itself are always allowed; other sites only if listed in ALLOWED_ORIGINS. */
export function isAllowedOrigin(headers, env) {
  const origin = headers.origin;
  // No Origin header means it isn't a cross-site browser request (e.g. curl).
  // Those still go through the backend's full validation.
  if (!origin) return true;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const siteHosts = [headers['x-forwarded-host'], headers.host]
    .filter(Boolean)
    .flatMap((value) => String(value).split(',').map((host) => host.trim()));
  if (siteHosts.includes(originHost)) return true;
  const allowed = String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

/**
 * Best-effort rate limiting, per server instance (serverless instances don't share
 * memory). Returns 0 when the request may go ahead, otherwise seconds to wait.
 */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return function check(key) {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) hits.clear(); // keep memory bounded on long-lived instances
    return 0;
  };
}

export function clientKey(headers, fallbackIp) {
  const forwarded = String(headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || headers['x-real-ip'] || fallbackIp || 'unknown';
}
