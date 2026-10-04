// The profile draft Fern's chats fill in, plus small helpers for its answers.

import { PAY_PERIODS, labelFor } from '../../shared/options.js';

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

export function formatPay(amount, currency, period) {
  let money;
  try {
    money = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    money = `${amount} ${currency}`;
  }
  return `${money} ${labelFor(PAY_PERIODS, period)}`;
}
