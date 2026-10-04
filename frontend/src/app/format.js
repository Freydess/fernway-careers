// How values read on the page: pay, dates, labels and application statuses.

import {
  APPLICATION_STATUSES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  PAY_PERIODS,
  ROLE_AREAS,
  WORK_MODES,
  labelFor,
} from '../../shared/options.js';

const LOCALE = 'en-GB';
const disjunction = new Intl.ListFormat('en', { style: 'long', type: 'disjunction' });
const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const DAY = 86_400_000;

export const areaLabel = (value) => (value === 'other' ? 'Other' : labelFor(ROLE_AREAS, value));
export const levelLabel = (value) => labelFor(EXPERIENCE_LEVELS, value);
export const employmentLabel = (value) => labelFor(EMPLOYMENT_TYPES, value);
export const workModeLabel = (value) => labelFor(WORK_MODES, value);
export const levelsLabel = (levels = []) => disjunction.format(levels.map(levelLabel));
export const listAnd = (items) => conjunction.format(items);

function money(amount, currency) {
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Number(amount).toLocaleString(LOCALE)} ${currency}`;
  }
}

const periodWords = (period) => labelFor(PAY_PERIODS, period).replace('per ', 'a ');

/** "฿45,000 to ฿70,000 a month", or null when the employer didn't list pay. */
export function formatSalary(job) {
  if (job.salary_min == null || !job.salary_currency) return null;
  const min = money(job.salary_min, job.salary_currency);
  const range = job.salary_max != null && job.salary_max !== job.salary_min ? `${min} to ${money(job.salary_max, job.salary_currency)}` : min;
  return `${range} ${periodWords(job.salary_period)}`;
}

/** A candidate's own pay expectation, in words. */
export function formatExpectation(profile) {
  if (profile.compensation_amount != null && profile.compensation_currency) {
    return `${money(profile.compensation_amount, profile.compensation_currency)} ${periodWords(profile.compensation_period)}`;
  }
  return profile.compensation_expectations || null;
}

export function timeAgo(iso) {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / DAY);
  if (days < 1) {
    const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (hours < 1) return 'just now';
    return relative.format(-hours, 'hour');
  }
  if (days < 14) return relative.format(-days, 'day');
  if (days < 60) return relative.format(-Math.round(days / 7), 'week');
  return relative.format(-Math.round(days / 30), 'month');
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** viewer: 'seeker' or 'employer'. Returns { label, tone, icon }. */
export function statusInfo(status, viewer) {
  const info = APPLICATION_STATUSES[status] ?? { seeker: status, employer: status, tone: 'neutral', icon: 'clock' };
  return { label: info[viewer], tone: info.tone, icon: info.icon };
}

export function yearsLabel(years) {
  if (years == null || years === '') return null;
  const value = Number(years);
  return `${value} ${value === 1 ? 'year' : 'years'}`;
}

/** "Mid-level, 3 years" style summary of someone's experience. */
export function experienceLabel(level, years) {
  return [level ? levelLabel(level) : null, yearsLabel(years)].filter(Boolean).join(', ');
}
