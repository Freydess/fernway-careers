// The application being built up in the chat, and how it becomes the backend's
// intake payload (see the root README: "API contract").

import { AVAILABILITY, EXPERIENCE_LEVELS, PAY_PERIODS, ROLE_AREAS, labelFor } from '../../shared/options.js';

export function createApplication() {
  return {
    full_name: '',
    email: '',
    phone: '',
    timezone: detectTimezone(),
    target_role: '',
    role_detail: '',
    experience_level: '',
    experience_years: '',
    portfolio_url: '',
    resume_url: '',
    compensation_expectations: '',
    compensation_amount: '',
    compensation_currency: '',
    compensation_period: '',
    availability: '',
    fit_summary: '',
    role_answers: {}, // area-specific answers, e.g. { tech_stack: 'Python, SQL' }
    interested_roles: [], // ids from shared/roles.js; folded into role_answers on submit
    consent_to_process: false,
  };
}

export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export function listTimezones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

export const firstName = (fullName) => String(fullName ?? '').trim().split(/\s+/)[0] ?? '';

/** A sensible default currency for the pay question, from the candidate's time zone. */
export function guessCurrency(timezone = '') {
  const byZone = {
    'Asia/Bangkok': 'THB',
    'Asia/Singapore': 'SGD',
    'Asia/Kuala_Lumpur': 'MYR',
    'Asia/Ho_Chi_Minh': 'VND',
    'Asia/Manila': 'PHP',
    'Asia/Jakarta': 'IDR',
    'Asia/Kolkata': 'INR',
    'Asia/Calcutta': 'INR',
    'Asia/Tokyo': 'JPY',
    'Asia/Seoul': 'KRW',
    'Asia/Shanghai': 'CNY',
    'Europe/London': 'GBP',
  };
  if (byZone[timezone]) return byZone[timezone];
  if (timezone.startsWith('Europe/')) return 'EUR';
  if (timezone.startsWith('Australia/')) return 'AUD';
  if (timezone.startsWith('America/Toronto') || timezone.startsWith('America/Vancouver')) return 'CAD';
  return 'USD';
}

/**
 * Turns what the candidate typed into an https:// link the backend accepts.
 * Returns '' for empty input and null when it can't be a public web link.
 */
export function normalizeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw.replace(/^http:\/\//i, 'https://') : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const isIp = /^[\d.]+$/.test(host) || host.startsWith('[');
  if (url.protocol !== 'https:' || url.username || url.password || isIp) return null;
  if (!host.includes('.') || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return null;
  return url.href;
}

export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;

export const isValidPhone = (value) => /^\+?[\d\s().-]{7,40}$/.test(value) && value.replace(/\D/g, '').length >= 7;

/** Readable labels for the area-specific answers, used on the review screen. */
export const ANSWER_LABELS = {
  tech_stack: 'Languages and frameworks',
  case_study: 'A project you’re proud of',
  acquisition_channels: 'Channels you know best',
  key_metrics: 'A result you’re proud of',
  highlights: 'Skills and highlights',
};

/** A short, factual note for the hiring team, written from the guided chat's answers. */
export function buildFitSummary(app) {
  const facts = [
    app.target_role && `${labelFor(ROLE_AREAS, app.target_role)}${app.role_detail ? ` (${app.role_detail})` : ''}`,
    app.experience_level && `${labelFor(EXPERIENCE_LEVELS, app.experience_level)} level${app.experience_years !== '' ? `, ${app.experience_years} ${Number(app.experience_years) === 1 ? 'year' : 'years'}` : ''}`,
    app.availability && availabilityPhrase(app.availability),
  ].filter(Boolean);
  const answers = Object.entries(app.role_answers)
    .filter(([key]) => key !== 'interested_roles')
    .map(([key, value]) => `${ANSWER_LABELS[key] ?? key}: ${value}`);
  return [facts.join(' · '), ...answers].filter(Boolean).join('\n');
}

function availabilityPhrase(availability) {
  if (availability === 'Just exploring') return 'Just exploring for now';
  if (AVAILABILITY.includes(availability)) return `Can start ${availability.toLowerCase()}`;
  return `Availability: ${availability}`;
}

export function formatPay(amount, currency, period) {
  let money;
  try {
    money = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    money = `${amount} ${currency}`;
  }
  return `${money} ${labelFor(PAY_PERIODS, period)}`;
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The exact JSON the backend's POST /api/v1/intake accepts. Empty optional fields are
 * left out (the backend treats absent as "not provided" and rejects empty URLs).
 */
export function toIntakePayload(app, roles) {
  const interested = app.interested_roles.map((id) => roles.find((role) => role.id === id)?.title).filter(Boolean);
  const roleAnswers = { ...app.role_answers };
  if (interested.length) roleAnswers.interested_roles = interested.join(', ');
  const summary = [app.fit_summary.trim(), interested.length ? `Interested in: ${interested.join(', ')}` : '']
    .filter(Boolean)
    .join('\n\n');

  const payload = {
    full_name: app.full_name.trim(),
    email: app.email.trim(),
    phone: app.phone.trim(),
    timezone: app.timezone,
    target_role: app.target_role,
    role_detail: clip(app.role_detail.trim(), 200),
    experience_level: app.experience_level,
    portfolio_url: app.portfolio_url,
    resume_url: app.resume_url,
    compensation_expectations: clip(app.compensation_expectations.trim(), 500),
    availability: clip(app.availability.trim(), 500),
    fit_summary: clip(summary, 8000),
    role_answers: Object.fromEntries(
      Object.entries(roleAnswers)
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .slice(0, 15)
        .map(([key, value]) => [key.slice(0, 100), clip(value.trim(), 2000)]),
    ),
    consent_to_process: app.consent_to_process === true,
  };
  if (app.experience_years !== '' && Number.isFinite(Number(app.experience_years))) {
    payload.experience_years = Math.round(Number(app.experience_years) * 10) / 10;
  }
  // The backend needs amount, currency and period together, or none of them.
  if (app.compensation_amount !== '' && app.compensation_currency && app.compensation_period) {
    payload.compensation_amount = Math.round(Number(app.compensation_amount) * 100) / 100;
    payload.compensation_currency = app.compensation_currency;
    payload.compensation_period = app.compensation_period;
  }
  for (const [key, value] of Object.entries(payload)) {
    const isEmptyObject = typeof value === 'object' && value !== null && !Object.keys(value).length;
    if (value === '' || value == null || isEmptyObject) delete payload[key];
  }
  return payload;
}
