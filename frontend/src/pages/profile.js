import { AVAILABILITY, CURRENCIES, EXPERIENCE_LEVELS, PAY_PERIODS, ROLE_AREAS } from '../../shared/options.js';
import { safeNext } from '../app/auth-forms.js';
import { areaLabel } from '../app/format.js';
import { startPage } from '../app/shell.js';
import { errorState, field, flash, showFieldErrors, showToast, skillsInput } from '../app/ui.js';
import { openProfileBuilder } from '../intake/profile-builder.js';
import { h } from '../lib/dom.js';
import { detectTimezone, guessCurrency } from '../lib/application.js';

const { api, user } = await startPage({ active: 'profile', require: 'seeker' });
const next = safeNext(new URLSearchParams(location.search).get('next'));
const container = document.querySelector('[data-profile-form]');

const choose = (label) => [{ value: '', label }];
let controls = null;

async function load() {
  try {
    const profile = await api.me.getProfile();
    render(profile);
  } catch (error) {
    container.replaceChildren(errorState(error, load));
  }
}

function render(profile) {
  const timezone = profile.timezone || detectTimezone();
  const availabilityOptions = [...choose('Choose one'), ...AVAILABILITY.map((value) => ({ value, label: value }))];
  if (profile.availability && !AVAILABILITY.includes(profile.availability)) availabilityOptions.push({ value: profile.availability, label: profile.availability });

  const f = {
    full_name: field({ label: 'Full name', name: 'full_name', value: user.full_name, autocomplete: 'name', maxLength: 200 }),
    headline: field({ label: 'Headline', name: 'headline', value: profile.headline, optional: true, maxLength: 120, hint: 'One line about you, like “Product designer who loves research”.' }),
    about: field({ label: 'About you', name: 'about', kind: 'textarea', value: profile.about, rows: 5, maxLength: 4000, hint: 'Your experience in a few sentences, and a project or result you’re proud of.' }),
    location: field({ label: 'Where you live', name: 'location', value: profile.location, optional: true, autocomplete: 'address-level2', placeholder: 'e.g. Chiang Mai' }),
    phone: field({ label: 'Phone', name: 'phone', type: 'tel', value: profile.phone, optional: true, autocomplete: 'tel', hint: 'Only employers you apply to see it.' }),
    target_role: field({ label: 'Area', name: 'target_role', kind: 'select', value: profile.target_role ?? '', options: [...choose('Choose an area'), ...ROLE_AREAS.map((area) => ({ value: area.value, label: areaLabel(area.value) }))] }),
    role_detail: field({ label: 'Kind of role', name: 'role_detail', value: profile.role_detail, optional: true, maxLength: 200, placeholder: 'e.g. Frontend engineering' }),
    experience_level: field({ label: 'Experience level', name: 'experience_level', kind: 'select', value: profile.experience_level ?? '', options: [...choose('Choose a level'), ...EXPERIENCE_LEVELS.map((level) => ({ value: level.value, label: `${level.label} (${level.hint.toLowerCase()})` }))] }),
    experience_years: field({ label: 'Years of experience', name: 'experience_years', type: 'number', value: profile.experience_years ?? '', optional: true, min: 0, step: 0.5, inputmode: 'decimal' }),
    portfolio_url: field({ label: 'Portfolio, GitHub or LinkedIn', name: 'portfolio_url', type: 'url', value: profile.portfolio_url, optional: true, inputmode: 'url', placeholder: 'https://' }),
    resume_url: field({ label: 'Resume link', name: 'resume_url', type: 'url', value: profile.resume_url, optional: true, inputmode: 'url', placeholder: 'https://', hint: 'Google Drive, Dropbox or OneDrive. Set sharing to “anyone with the link”.' }),
    availability: field({ label: 'When you could start', name: 'availability', kind: 'select', value: profile.availability ?? '', options: availabilityOptions, optional: true }),
    compensation_amount: field({ label: 'Amount', name: 'compensation_amount', type: 'number', value: profile.compensation_amount ?? '', min: 0, step: 500, inputmode: 'numeric' }),
    compensation_currency: field({ label: 'Currency', name: 'compensation_currency', kind: 'select', value: profile.compensation_currency ?? guessCurrency(timezone), options: CURRENCIES.map((code) => ({ value: code, label: code })) }),
    compensation_period: field({ label: 'Per', name: 'compensation_period', kind: 'select', value: profile.compensation_period ?? 'month', options: PAY_PERIODS.map((period) => ({ value: period.value, label: period.label.replace('per ', '') })) }),
    compensation_expectations: field({ label: 'Or describe it', name: 'compensation_expectations', value: profile.compensation_expectations, optional: true, maxLength: 500, placeholder: 'e.g. Open to discussion' }),
  };
  const skills = skillsInput({ label: 'Skills and tools', values: profile.skills ?? [] });
  controls = { f, skills, timezone };

  const save = h('button', { type: 'submit', class: 'btn btn-primary px-6' }, next ? 'Save and continue' : 'Save profile');
  const form = h(
    'form',
    { class: 'grid gap-6', novalidate: true },
    h('div', { 'data-error-summary': true }),
    h('fieldset', { class: 'fieldset' }, h('legend', { class: 'fieldset-title float-left mb-1 w-full' }, 'About you'), f.full_name.wrapper, f.headline.wrapper, f.about.wrapper, h('div', { class: 'grid gap-5 sm:grid-cols-2' }, f.location.wrapper, f.phone.wrapper)),
    h(
      'fieldset',
      { class: 'fieldset' },
      h('legend', { class: 'fieldset-title float-left mb-1 w-full' }, 'The work you want'),
      h('div', { class: 'grid gap-5 sm:grid-cols-2' }, f.target_role.wrapper, f.role_detail.wrapper, f.experience_level.wrapper, f.experience_years.wrapper),
      skills.wrapper,
    ),
    h('fieldset', { class: 'fieldset' }, h('legend', { class: 'fieldset-title float-left mb-1 w-full' }, 'Links'), f.portfolio_url.wrapper, f.resume_url.wrapper),
    h(
      'fieldset',
      { class: 'fieldset' },
      h('legend', { class: 'fieldset-title float-left mb-1 w-full' }, 'Start date and pay'),
      f.availability.wrapper,
      h(
        'div',
        { class: 'grid gap-2' },
        h('p', { class: 'field-label' }, 'Pay you’re hoping for ', h('span', { class: 'field-optional' }, '(optional)')),
        h('p', { class: 'field-hint' }, 'It won’t hide any jobs from you. Leave it empty if you’d rather not say.'),
        h('div', { class: 'grid gap-3 sm:grid-cols-[1fr_7rem_8rem]' }, f.compensation_amount.wrapper, f.compensation_currency.wrapper, f.compensation_period.wrapper),
      ),
      f.compensation_expectations.wrapper,
    ),
    h('div', { class: 'sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0' }, save, next ? h('a', { class: 'btn btn-ghost', href: next }, 'Skip for now') : null),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = readForm();
    const errors = [];
    if (!input.full_name) errors.push({ field: 'full_name', message: 'Enter your name.' });
    if (!input.skills.length && !input.about) errors.push({ field: 'about', message: 'Add a few sentences about you, or some skills below, so employers know what you do.' });
    if (errors.length) return showFieldErrors(form, errors);
    showFieldErrors(form, []);
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      await api.me.saveProfile(input);
      if (next) {
        flash('Profile saved.');
        location.href = next;
        return;
      }
      showToast('Profile saved. Jobs for you now use these details.');
    } catch (error) {
      showFieldErrors(form, error.fields?.length ? error.fields : []);
      if (!error.fields?.length) showToast(error.message);
    } finally {
      save.disabled = false;
      save.textContent = next ? 'Save and continue' : 'Save profile';
    }
  });

  container.replaceChildren(form);
}

function readForm() {
  const { f, skills, timezone } = controls;
  const value = (name) => f[name].control.value.trim();
  const amount = value('compensation_amount');
  return {
    full_name: value('full_name'),
    headline: value('headline') || null,
    about: value('about') || null,
    location: value('location') || null,
    phone: value('phone') || null,
    timezone: timezone || null,
    target_role: value('target_role') || null,
    role_detail: value('role_detail') || null,
    experience_level: value('experience_level') || null,
    experience_years: value('experience_years') === '' ? null : Number(value('experience_years')),
    skills: skills.getValue(),
    portfolio_url: withHttps(value('portfolio_url')),
    resume_url: withHttps(value('resume_url')),
    availability: value('availability') || null,
    compensation_amount: amount === '' ? null : Number(amount),
    compensation_currency: amount === '' ? null : value('compensation_currency'),
    compensation_period: amount === '' ? null : value('compensation_period'),
    compensation_expectations: value('compensation_expectations') || null,
  };
}

/** People often paste "github.com/name"; add the https:// for them. */
function withHttps(url) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url.replace(/^http:\/\//i, 'https://') : `https://${url}`;
}

/** Puts what Fern collected into the form (without saving: the person checks it first). */
function fillFromFern(collected) {
  if (!controls) return;
  const { f, skills } = controls;
  for (const [name, value] of Object.entries(collected)) {
    if (name === 'skills') {
      if (value?.length) skills.setValue([...new Set([...skills.getValue(), ...value])]);
    } else if (f[name] && value != null && value !== '') {
      if (f[name].control.tagName === 'SELECT' && ![...f[name].control.options].some((option) => option.value === String(value))) {
        f[name].control.append(h('option', { value: String(value) }, String(value)));
      }
      f[name].control.value = String(value);
    }
  }
  showToast('Fern filled in your profile. Check it, then save.');
  container.querySelector('form')?.querySelector('input, select, textarea')?.focus();
}

document.querySelector('[data-open-fern]').addEventListener('click', () => {
  openProfileBuilder({ known: controls ? readForm() : {}, onDone: fillFromFern });
});

load();
