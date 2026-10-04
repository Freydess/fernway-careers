// The real marketplace API: the backend's /api/v2, reached through the site's own origin
// (Vercel proxies /api/v2 to Render; Vite does the same in development). The session is
// an HTTP-only cookie the browser sends automatically. Contract: frontend/docs/note-for-codex-marketplace.md

import { ApiError } from './errors.js';

const BASE = '/api/v2';
// Render's free plan sleeps when idle; the first request can take up to a minute.
const SLOW_AFTER_MS = 4000;

export function createApi({ onSlowRequest = () => {} } = {}) {
  async function request(method, path, { body, headers = {} } = {}) {
    const slowTimer = setTimeout(onSlowRequest, SLOW_AFTER_MS);
    let response;
    try {
      response = await fetch(BASE + path, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'We couldn’t reach Fernway. Check your connection and try again.', { code: 'network' });
    } finally {
      clearTimeout(slowTimer);
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (response.ok) return data;
    throw ApiError.fromResponse(response.status, data);
  }

  const get = (path) => request('GET', path);
  const send = (method) => (path, body, headers) => request(method, path, { body: body ?? {}, headers });
  const post = send('POST');
  const put = send('PUT');
  const query = (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
    return search.size ? `?${search}` : '';
  };
  const id = encodeURIComponent;

  return {
    mode: 'live',
    auth: {
      me: async () => (await get('/auth/me')).user,
      register: async (input) => (await post('/auth/register', input)).user,
      login: async (input) => (await post('/auth/login', input)).user,
      logout: () => post('/auth/logout'),
    },
    jobs: {
      list: (params) => get(`/jobs${query(params)}`),
      get: (jobId) => get(`/jobs/${id(jobId)}`),
      apply: (jobId, input, idempotencyKey) => post(`/jobs/${id(jobId)}/apply`, input, { 'Idempotency-Key': idempotencyKey }),
    },
    me: {
      getProfile: () => get('/me/profile'),
      saveProfile: (profile) => put('/me/profile', profile),
      applications: () => get('/me/applications'),
      withdraw: (applicationId, reason) => post(`/me/applications/${id(applicationId)}/withdraw`, reason ? { reason } : {}),
    },
    employer: {
      getCompany: () => get('/employer/company'),
      saveCompany: (company) => put('/employer/company', company),
      jobs: () => get('/employer/jobs'),
      createJob: (job) => post('/employer/jobs', job),
      updateJob: (jobId, job) => put(`/employer/jobs/${id(jobId)}`, job),
      applications: (jobId, params) => get(`/employer/jobs/${id(jobId)}/applications${query(params)}`),
      application: (applicationId) => get(`/employer/applications/${id(applicationId)}`),
      decide: (applicationId, input) => post(`/employer/applications/${id(applicationId)}/decision`, input),
      stage: (applicationId, input) => post(`/employer/applications/${id(applicationId)}/stage`, input),
    },
    notifications: {
      list: (params = { limit: 20 }) => get(`/notifications${query(params)}`),
      markRead: (input) => post('/notifications/read', input),
    },
  };
}
