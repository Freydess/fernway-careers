// Picks which marketplace API the site uses:
//   live: the backend's /api/v2 (set MARKETPLACE_MODE=live on Vercel or in .env.local)
//   demo: everything runs in this browser (the default, and a backup for presentations)
// For testing, ?backend=demo or ?backend=live overrides it for the rest of the visit.

const OVERRIDE_KEY = 'fernway-backend-override';

let apiPromise;
let statusPromise;

/** Server features (AI chat, marketplace mode); null when the site runs without server functions. */
export function fetchServerStatus() {
  statusPromise ??= fetch('/api/status', { headers: { Accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return statusPromise;
}

async function chooseMode() {
  const requested = new URLSearchParams(location.search).get('backend');
  try {
    if (requested === 'demo' || requested === 'live') sessionStorage.setItem(OVERRIDE_KEY, requested);
    const override = sessionStorage.getItem(OVERRIDE_KEY);
    if (override) return override;
  } catch {
    if (requested === 'demo' || requested === 'live') return requested;
  }
  const status = await fetchServerStatus();
  return status?.marketplace?.mode === 'live' ? 'live' : 'demo';
}

/** The API for this visit (same methods in both modes). */
export function getApi(options = {}) {
  apiPromise ??= chooseMode().then(async (mode) => {
    const module = mode === 'live' ? await import('./api-live.js') : await import('./api-demo.js');
    return module.createApi(options);
  });
  return apiPromise;
}
