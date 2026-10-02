// The review step shared by the guided and AI chats: an editable summary of the
// application, the consent checkbox, and the send button. Then the thank-you screen.

import { company } from '../../shared/company.js';
import { AVAILABILITY, CURRENCIES, EXPERIENCE_LEVELS, PAY_PERIODS, ROLE_AREAS } from '../../shared/options.js';
import { ANSWER_LABELS, firstName, guessCurrency, isValidEmail, isValidPhone, listTimezones, normalizeUrl } from '../lib/application.js';
import { h, icon } from '../lib/dom.js';

export const CONSENT_TEXT = `I agree that ${company.name} may store and use these details to review my application, as described in the privacy notice.`;

const SUBMIT_ERRORS = {
  network: 'We couldn’t reach our server. Check your connection and try again.',
  validation: 'A few details need a quick fix. See the highlighted fields.',
  rate_limited: 'Too many applications were sent from this connection. Please try again in a few minutes.',
  too_large: 'Your answers are a little too long. Please shorten the longest ones and try again.',
};

function field({ name, label, hint, required, control }) {
  const errorId = `review-${name}-error`;
  control.id ||= `review-${name}`;
  control.name ||= name;
  control.setAttribute('aria-describedby', [hint && `review-${name}-hint`, errorId].filter(Boolean).join(' '));
  if (required) control.required = true;
  return h(
    'div',
    { class: 'grid content-start gap-1', dataset: { field: name } },
    h('label', { class: 'field-label', for: control.id }, label, required ? null : h('span', { class: 'field-optional' }, ' (optional)')),
    control,
    hint ? h('p', { id: `review-${name}-hint`, class: 'field-hint' }, hint) : null,
    h('p', { id: errorId, class: 'field-error', hidden: true }),
  );
}

const textInput = (value, attributes = {}) => h('input', { class: 'input', type: 'text', value: value ?? '', ...attributes });

function select(value, options, { placeholder } = {}) {
  return h(
    'select',
    { class: 'input' },
    placeholder ? h('option', { value: '', selected: !value }, placeholder) : null,
    options.map((option) => h('option', { value: option.value, selected: option.value === value }, option.label)),
  );
}

function timezoneSelect(value) {
  const zones = listTimezones();
  if (!zones.length) return textInput(value, { placeholder: 'e.g. Asia/Bangkok', autocomplete: 'off' });
  if (value && !zones.includes(value)) zones.unshift(value);
  return select(value, zones.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') })), { placeholder: 'Not specified' });
}

function section(title, ...children) {
  return h('fieldset', { class: 'grid gap-4' }, h('legend', { class: 'mb-1 font-display text-lg font-semibold text-ink' }, title), ...children);
}

/**
 * Renders the review form. onSubmit(app, { honeypot }) must resolve with the result of
 * submitApplication(); on failure the form shows the error and stays editable.
 */
export function renderReview(container, { app, roles, suggestedIds, notice, onBack, onSubmit }) {
  const controls = {
    full_name: textInput(app.full_name, { autocomplete: 'name', maxlength: 200 }),
    email: textInput(app.email, { type: 'email', autocomplete: 'email', inputmode: 'email', maxlength: 254 }),
    phone: textInput(app.phone, { type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 40 }),
    timezone: timezoneSelect(app.timezone),
    target_role: select(app.target_role, ROLE_AREAS, { placeholder: 'Choose an area' }),
    role_detail: textInput(app.role_detail, { maxlength: 200, placeholder: 'e.g. Backend developer' }),
    experience_level: select(app.experience_level, EXPERIENCE_LEVELS, { placeholder: 'Not specified' }),
    experience_years: textInput(app.experience_years, { type: 'number', inputmode: 'decimal', min: 0, max: 80, step: 0.5 }),
    portfolio_url: textInput(app.portfolio_url, { inputmode: 'url', autocomplete: 'url', placeholder: 'github.com/yourname' }),
    resume_url: textInput(app.resume_url, { inputmode: 'url', placeholder: 'drive.google.com/…' }),
    availability: textInput(app.availability, { list: 'review-availability-options', maxlength: 500 }),
    compensation_amount: textInput(app.compensation_amount, { type: 'number', inputmode: 'decimal', min: 0, step: 'any', 'aria-label': 'Pay amount' }),
    compensation_currency: select(app.compensation_currency || guessCurrency(app.timezone), CURRENCIES.map((code) => ({ value: code, label: code }))),
    compensation_period: select(app.compensation_period || 'month', PAY_PERIODS),
    compensation_expectations: textInput(app.compensation_expectations, { maxlength: 500, placeholder: 'e.g. Negotiable, depends on the role' }),
    fit_summary: h('textarea', { class: 'input min-h-28', rows: 5, maxlength: 6000, value: app.fit_summary }),
  };
  controls.compensation_currency.setAttribute('aria-label', 'Currency');
  controls.compensation_period.setAttribute('aria-label', 'Pay period');

  const answerControls = Object.entries(app.role_answers)
    .filter(([key]) => key !== 'interested_roles')
    .map(([key, value]) => ({ key, control: h('textarea', { class: 'input', rows: 2, maxlength: 2000, value }) }));

  const roleInputs = roles.map((role) => {
    const input = h('input', {
      type: 'checkbox',
      id: `review-role-${role.id}`,
      value: role.id,
      checked: app.interested_roles.includes(role.id),
      class: 'mt-1 size-4 shrink-0 accent-brand',
    });
    const suggested = suggestedIds.includes(role.id);
    return {
      input,
      element: h(
        'label',
        { for: input.id, class: 'role-option' },
        input,
        h(
          'span',
          { class: 'grid gap-0.5' },
          h('span', { class: 'flex flex-wrap items-center gap-2 font-semibold text-ink' }, role.title, suggested ? h('span', { class: 'badge' }, 'Suggested for you') : null),
          h('span', { class: 'text-sm text-ink-muted' }, `${role.type} · ${role.location}`),
        ),
      ),
    };
  });

  const consent = h('input', { type: 'checkbox', id: 'review-consent', class: 'mt-1 size-4 shrink-0 accent-brand', checked: app.consent_to_process });
  const consentError = h('p', { id: 'review-consent-error', class: 'field-error', hidden: true });
  consent.setAttribute('aria-describedby', consentError.id);
  // Honeypot: hidden from people (and screen readers); bots that fill every field get caught.
  const honeypot = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' });
  const alertBox = h('div', { class: 'alert', role: 'alert', tabindex: '-1', hidden: true });
  const submitButton = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Send application', icon('send', 'size-4'));

  const form = h(
    'form',
    { class: 'grid gap-8', novalidate: true },
    h(
      'div',
      { class: 'grid gap-2' },
      h('h3', { class: 'font-display text-2xl font-semibold text-ink', tabindex: '-1', 'data-review-heading': true }, 'Check your application'),
      h('p', { class: 'text-ink-muted' }, 'Edit anything that’s off, then send it. A person on our team reads every application.'),
      notice ? h('p', { class: 'notice' }, notice) : null,
    ),
    alertBox,
    section(
      'About you',
      h(
        'div',
        { class: 'grid gap-4 sm:grid-cols-2' },
        field({ name: 'full_name', label: 'Full name', required: true, control: controls.full_name }),
        field({ name: 'email', label: 'Email', required: true, control: controls.email }),
        field({ name: 'phone', label: 'Phone', control: controls.phone, hint: 'Include your country code, like +66.' }),
        field({ name: 'timezone', label: 'Time zone', control: controls.timezone, hint: 'We set this from your device. It helps us plan calls.' }),
      ),
    ),
    section(
      'Your work',
      h(
        'div',
        { class: 'grid gap-4 sm:grid-cols-2' },
        field({ name: 'target_role', label: 'Area', required: true, control: controls.target_role }),
        field({ name: 'role_detail', label: 'Role or focus', control: controls.role_detail }),
        field({ name: 'experience_level', label: 'Experience level', control: controls.experience_level }),
        field({ name: 'experience_years', label: 'Years of experience', control: controls.experience_years }),
        field({ name: 'portfolio_url', label: 'Portfolio, GitHub or LinkedIn', control: controls.portfolio_url }),
        field({ name: 'resume_url', label: 'Resume link', control: controls.resume_url, hint: 'Check it’s shared with “anyone with the link”.' }),
        field({ name: 'availability', label: 'When you could start', control: controls.availability }),
        h('datalist', { id: 'review-availability-options' }, AVAILABILITY.map((value) => h('option', { value }))),
      ),
      answerControls.map(({ key, control }) =>
        field({ name: `answer-${key}`, label: ANSWER_LABELS[key] ?? key.replaceAll('_', ' '), control }),
      ),
    ),
    section(
      'Pay expectations',
      h(
        'div',
        { class: 'grid gap-1', dataset: { field: 'compensation_amount' } },
        h('p', { class: 'field-label' }, 'Amount', h('span', { class: 'field-optional' }, ' (optional)')),
        h('div', { class: 'grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]' }, controls.compensation_amount, controls.compensation_currency, h('div', { class: 'col-span-2 sm:col-span-1' }, controls.compensation_period)),
        h('p', { id: 'review-compensation_amount-error', class: 'field-error', hidden: true }),
      ),
      field({ name: 'compensation_expectations', label: 'Or describe it', control: controls.compensation_expectations }),
    ),
    section(
      'Roles to consider you for',
      h('div', { class: 'grid gap-2' }, roleInputs.map((item) => item.element)),
    ),
    section(
      'Summary for the hiring team',
      field({ name: 'fit_summary', label: 'Summary', control: controls.fit_summary, hint: 'Written from your answers. Edit anything that’s off.' }),
    ),
    h('div', { class: 'hp-field', 'aria-hidden': 'true' }, h('label', {}, 'Leave this field empty', honeypot)),
    h(
      'div',
      { class: 'grid gap-1' },
      h(
        'label',
        { for: consent.id, class: 'flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink' },
        consent,
        h('span', {}, CONSENT_TEXT.replace(' as described in the privacy notice.', ' as described in the '), h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener', class: 'link' }, 'privacy notice'), '.'),
      ),
      consentError,
    ),
    h(
      'div',
      { class: 'flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between' },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: onBack }, icon('back', 'size-4'), 'Back to the chat'),
      submitButton,
    ),
  );

  const errorFor = (name) => form.querySelector(`#review-${CSS.escape(name)}-error`);
  const controlFor = (name) => controls[name] ?? (name === 'consent_to_process' ? consent : null);

  function setError(name, message) {
    const error = errorFor(name === 'consent_to_process' ? 'consent' : name);
    const control = controlFor(name);
    if (!error) return false;
    error.textContent = message;
    error.hidden = false;
    control?.setAttribute('aria-invalid', 'true');
    return true;
  }

  function clearErrors() {
    alertBox.hidden = true;
    for (const error of form.querySelectorAll('.field-error')) error.hidden = true;
    for (const control of form.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
  }

  /** Reads the form into a copy of the application and lists any problems. */
  function read() {
    const value = (name) => controls[name].value.trim();
    const next = {
      ...app,
      full_name: value('full_name'),
      email: value('email'),
      phone: value('phone'),
      timezone: value('timezone'),
      target_role: value('target_role'),
      role_detail: value('role_detail'),
      experience_level: value('experience_level'),
      experience_years: value('experience_years'),
      portfolio_url: normalizeUrl(value('portfolio_url')),
      resume_url: normalizeUrl(value('resume_url')),
      availability: value('availability'),
      compensation_amount: value('compensation_amount'),
      compensation_currency: value('compensation_currency'),
      compensation_period: value('compensation_period'),
      compensation_expectations: value('compensation_expectations'),
      fit_summary: controls.fit_summary.value.trim(),
      role_answers: {
        ...Object.fromEntries(answerControls.map(({ key, control }) => [key, control.value.trim()])),
      },
      interested_roles: roleInputs.filter((item) => item.input.checked).map((item) => item.input.value),
      consent_to_process: consent.checked,
    };

    const problems = [];
    if (!next.full_name) problems.push(['full_name', 'Please add your name.']);
    if (!isValidEmail(next.email)) problems.push(['email', 'Please enter a valid email so we can reply.']);
    if (next.phone && !isValidPhone(next.phone)) problems.push(['phone', 'That number looks too short. Include your country code.']);
    if (!next.target_role) problems.push(['target_role', 'Please choose an area.']);
    if (next.experience_years !== '') {
      const years = Number(next.experience_years);
      if (!Number.isFinite(years) || years < 0 || years > 80) problems.push(['experience_years', 'Please enter a number from 0 to 80.']);
      else next.experience_years = Math.round(years * 10) / 10;
    }
    if (next.portfolio_url === null) problems.push(['portfolio_url', 'Please use a public link, like github.com/yourname.']);
    if (next.resume_url === null) problems.push(['resume_url', 'Please use a public link, like a Google Drive share link.']);
    if (next.compensation_amount !== '') {
      const amount = Number(next.compensation_amount);
      if (!Number.isFinite(amount) || amount < 0 || amount >= 1e10) problems.push(['compensation_amount', 'Please enter a valid amount, or leave it empty.']);
      else next.compensation_amount = Math.round(amount * 100) / 100;
    }
    if (!next.consent_to_process) problems.push(['consent_to_process', 'Please tick this box so we can review your application.']);
    return { next, problems };
  }

  function showAlert(message) {
    alertBox.textContent = message;
    alertBox.hidden = false;
    alertBox.focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    const { next, problems } = read();
    if (problems.length) {
      for (const [name, message] of problems) setError(name, message);
      const first = controlFor(problems[0][0]);
      first?.focus();
      return;
    }
    Object.assign(app, next);
    submitButton.disabled = true;
    submitButton.firstChild.textContent = 'Sending…';
    const result = await onSubmit(app, { honeypot: honeypot.value });
    submitButton.disabled = false;
    submitButton.firstChild.textContent = 'Send application';
    if (result.ok) return;

    const unplaced = (result.fields ?? []).filter(({ field: name, message }) => !setError(name, message));
    const extra = unplaced.map(({ message }) => message).filter(Boolean).join(' ');
    showAlert([SUBMIT_ERRORS[result.error] ?? 'We couldn’t send your application right now. Please try again in a moment.', extra].filter(Boolean).join(' '));
  });

  container.replaceChildren(form);
  container.scrollTop = 0;
  form.querySelector('[data-review-heading]').focus();
}

export function renderDone(container, { app, result, onClose, onNewApplication }) {
  const heading = h('h3', { class: 'font-display text-2xl font-semibold text-balance text-ink sm:text-3xl', tabindex: '-1' }, `Thanks, ${firstName(app.full_name)}! Your application is in.`);
  container.replaceChildren(
    h(
      'div',
      { class: 'mx-auto grid max-w-lg gap-6 py-4 text-center sm:py-8' },
      h('div', { class: 'mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-brand' }, icon('check', 'size-7')),
      heading,
      h('p', { class: 'text-ink-muted' }, `${company.reviewPromise} We’ll write to `, h('strong', { class: 'text-ink' }, app.email), '.'),
      result.duplicate ? h('p', { class: 'notice' }, 'We already had this exact application, so nothing was duplicated.') : null,
      result.demo
        ? h(
            'div',
            { class: 'notice grid gap-2 text-left' },
            h('p', {}, h('strong', {}, 'Demo mode: nothing was saved. '), 'The backend isn’t connected (INTAKE_DEMO=true). This is exactly what would be sent to it:'),
            h('pre', { class: 'payload-preview' }, JSON.stringify(result.payload, null, 2)),
          )
        : null,
      h(
        'ol',
        { class: 'grid gap-3 text-left' },
        company.hiringProcess.slice(1).map((stepText, index) =>
          h('li', { class: 'flex gap-3 rounded-xl border border-line p-3 text-sm text-ink' }, h('span', { class: 'step-number' }, String(index + 2)), stepText),
        ),
      ),
      h(
        'div',
        { class: 'flex flex-wrap justify-center gap-3' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: onClose }, 'Done'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: onNewApplication }, 'Start a new application'),
      ),
    ),
  );
  container.scrollTop = 0;
  heading.focus();
}
