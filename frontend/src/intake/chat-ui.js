// The chat window: message bubbles, a typing indicator, and the "composer" at the
// bottom, which changes shape for each question (buttons, a text box, a short form…).
// ask() shows a composer and resolves with the candidate's answer, so a whole
// conversation can be written as one plain async function (see guided.js).

import { formatPay, isValidEmail, isValidPhone, normalizeUrl } from '../lib/application.js';
import { h, icon, prefersReducedMotion, sleep, uid } from '../lib/dom.js';

/** Thrown into a running conversation when the chat is restarted or switched. */
export class FlowCancelled extends Error {
  constructor() {
    super('The chat was restarted');
    this.name = 'FlowCancelled';
  }
}

export function createChat({ log, composer, assistantName }) {
  let pending = null;
  let generation = 0;

  function scrollToEnd() {
    log.scrollTo({ top: log.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function say(from, content) {
    const isBot = from === 'bot';
    log.append(
      h(
        'div',
        { class: isBot ? 'chat-row' : 'chat-row chat-row-user' },
        h(
          'div',
          { class: isBot ? 'chat-bubble chat-bubble-bot' : 'chat-bubble chat-bubble-user' },
          h('span', { class: 'sr-only' }, isBot ? `${assistantName}: ` : 'You: '),
          content,
        ),
      ),
    );
    scrollToEnd();
  }

  function showTyping() {
    const row = h(
      'div',
      { class: 'chat-row', 'aria-hidden': 'true' },
      h('div', { class: 'chat-bubble chat-bubble-bot chat-typing' }, h('span'), h('span'), h('span')),
    );
    log.append(row);
    scrollToEnd();
    return () => row.remove();
  }

  /** Returns a function that throws FlowCancelled if the chat was reset since this call. */
  function checkpoint() {
    const current = generation;
    return () => {
      if (current !== generation) throw new FlowCancelled();
    };
  }

  async function bot(content) {
    const stillCurrent = checkpoint();
    if (!prefersReducedMotion()) {
      const hideTyping = showTyping();
      const length = typeof content === 'string' ? content.length : 80;
      await sleep(Math.min(280 + length * 9, 950));
      hideTyping();
    }
    stillCurrent();
    say('bot', content);
  }

  function ask(spec) {
    const current = generation;
    return new Promise((resolve, reject) => {
      pending = { reject };
      const answer = (value, display) => {
        if (current !== generation) return;
        pending = null;
        composer.focus({ preventScroll: true }); // keep keyboard focus inside the dialog
        composer.replaceChildren();
        if (display) say('user', display);
        resolve(value);
      };
      composer.replaceChildren(buildComposer(spec, answer));
      const target = composer.querySelector('[data-autofocus]') ?? composer.querySelector('input, textarea, select, button');
      target?.focus({ preventScroll: true });
    });
  }

  function reset() {
    generation += 1;
    const waiting = pending;
    pending = null;
    waiting?.reject(new FlowCancelled());
    log.replaceChildren();
    composer.replaceChildren();
  }

  return { bot, ask, reset, say, showTyping, checkpoint };
}

// --- Composers ----------------------------------------------------------------------

function buildComposer(spec, answer) {
  switch (spec.type ?? 'text') {
    case 'choices':
      return choiceComposer(spec, answer);
    case 'multi':
      return multiComposer(spec, answer);
    case 'text':
      return textComposer(spec, answer);
    case 'contact':
      return contactComposer(spec, answer);
    case 'pay':
      return payComposer(spec, answer);
    case 'roles':
      return roleComposer(spec, answer);
    default:
      throw new Error(`Unknown composer type "${spec.type}"`);
  }
}

function fieldError() {
  return h('p', { id: uid('error'), class: 'field-error', hidden: true });
}

function showError(error, input, message) {
  error.textContent = message;
  error.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

function clearError(error, input) {
  error.hidden = true;
  input.removeAttribute('aria-invalid');
}

function labelled(text, input, { hint, error } = {}) {
  return h(
    'div',
    { class: 'grid gap-1' },
    h('label', { class: 'field-label', for: input.id }, text, hint ? h('span', { class: 'field-optional' }, ` ${hint}`) : null),
    input,
    error,
  );
}

/** Buttons for a single choice: options are { value, label, hint? }. */
function choiceComposer({ options, label = 'Choose an answer' }, answer) {
  return h(
    'div',
    { class: 'flex flex-wrap gap-2', role: 'group', 'aria-label': label },
    options.map((option, index) =>
      h(
        'button',
        { type: 'button', class: 'chip', 'data-autofocus': index === 0, onclick: () => answer(option.value, option.label) },
        option.label,
        option.hint ? h('span', { class: 'chip-hint' }, option.hint) : null,
      ),
    ),
  );
}

/** Toggle buttons for several choices: options are plain strings. Resolves with an array. */
function multiComposer({ options, label = 'Choose any that apply', continueLabel = 'Continue' }, answer) {
  const selected = new Set();
  const buttons = options.map((option, index) => {
    const button = h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': 'false',
      'data-autofocus': index === 0,
      onclick: () => {
        if (selected.has(option)) selected.delete(option);
        else selected.add(option);
        button.setAttribute('aria-pressed', String(selected.has(option)));
      },
    }, option);
    return button;
  });
  const finish = () => {
    const chosen = options.filter((option) => selected.has(option));
    answer(chosen, chosen.length ? chosen.join(', ') : 'None of these');
  };
  return h(
    'div',
    { class: 'grid gap-3' },
    h('div', { class: 'flex flex-wrap gap-2', role: 'group', 'aria-label': label }, buttons),
    h('div', { class: 'flex justify-end' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: finish }, continueLabel)),
  );
}

/**
 * A text box with a send button. kind: 'text' | 'url' | 'email' | 'number'.
 * Resolves with the cleaned value, or '' when an optional question is skipped.
 */
function textComposer(spec, answer) {
  const {
    kind = 'text',
    multiline = false,
    placeholder = 'Type your answer…',
    label = 'Your answer',
    optional = false,
    skipLabel = 'Skip',
    maxLength = 2000,
    autocomplete,
    min,
    max,
    step,
  } = spec;
  const error = fieldError();
  const shared = { class: 'input', placeholder, 'aria-label': label, 'aria-describedby': error.id, 'data-autofocus': true };
  const field = multiline
    ? h('textarea', { ...shared, class: 'input chat-textarea', rows: 1, maxlength: maxLength })
    : h('input', {
        ...shared,
        type: kind === 'number' ? 'number' : kind === 'email' ? 'email' : 'text',
        inputmode: { url: 'url', email: 'email', number: 'decimal' }[kind] ?? null,
        maxlength: kind === 'number' ? null : maxLength,
        min,
        max,
        step,
        autocomplete: autocomplete ?? (kind === 'email' ? 'email' : 'off'),
        autocapitalize: kind === 'text' ? 'sentences' : 'off',
        spellcheck: kind === 'text' ? null : 'false',
      });

  function submit() {
    const raw = field.value.trim();
    if (!raw) return optional ? answer('', skipLabel) : showError(error, field, 'Please type an answer.');
    if (kind === 'url') {
      const url = normalizeUrl(raw);
      return url ? answer(url, raw) : showError(error, field, 'That doesn’t look like a public link. Try something like github.com/yourname.');
    }
    if (kind === 'email') {
      return isValidEmail(raw) ? answer(raw, raw) : showError(error, field, 'That email doesn’t look quite right.');
    }
    if (kind === 'number') {
      const number = Number(raw);
      const inRange = Number.isFinite(number) && number >= (min ?? -Infinity) && number <= (max ?? Infinity);
      return inRange ? answer(number, raw) : showError(error, field, `Please enter a number from ${min} to ${max}.`);
    }
    answer(raw, raw);
  }

  if (multiline) {
    field.addEventListener('keydown', (event) => {
      // Enter sends, Shift+Enter adds a line. isComposing keeps Thai/Japanese/Chinese IMEs working.
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    });
    field.addEventListener('input', () => {
      field.style.height = 'auto';
      field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
    });
  }
  field.addEventListener('input', () => clearError(error, field));

  return h(
    'form',
    { class: 'grid gap-2', novalidate: true, onsubmit: (event) => (event.preventDefault(), submit()) },
    h('div', { class: 'flex items-end gap-2' }, field, h('button', { type: 'submit', class: 'btn-send', 'aria-label': 'Send' }, icon('send'))),
    error,
    optional ? h('button', { type: 'button', class: 'link-button justify-self-start', onclick: () => answer('', skipLabel) }, skipLabel) : null,
  );
}

/** Email (required) + phone (optional). Resolves with { email, phone }. */
function contactComposer(_spec, answer) {
  const emailError = fieldError();
  const phoneError = fieldError();
  const email = h('input', {
    id: uid('email'),
    class: 'input',
    type: 'email',
    autocomplete: 'email',
    inputmode: 'email',
    maxlength: 254,
    placeholder: 'you@example.com',
    'aria-describedby': emailError.id,
    'data-autofocus': true,
  });
  const phone = h('input', {
    id: uid('phone'),
    class: 'input',
    type: 'tel',
    autocomplete: 'tel',
    inputmode: 'tel',
    maxlength: 40,
    placeholder: '+66 00 000 0000',
    'aria-describedby': phoneError.id,
  });
  email.addEventListener('input', () => clearError(emailError, email));
  phone.addEventListener('input', () => clearError(phoneError, phone));

  function submit(event) {
    event.preventDefault();
    const emailValue = email.value.trim();
    const phoneValue = phone.value.trim();
    if (!isValidEmail(emailValue)) return showError(emailError, email, 'Please enter a valid email so we can reply.');
    if (phoneValue && !isValidPhone(phoneValue)) {
      return showError(phoneError, phone, 'That number looks too short. Include your country code, like +66.');
    }
    answer({ email: emailValue, phone: phoneValue }, phoneValue ? `${emailValue} · ${phoneValue}` : emailValue);
  }

  return h(
    'form',
    { class: 'grid gap-3', novalidate: true, onsubmit: submit },
    h(
      'div',
      { class: 'grid gap-3 sm:grid-cols-2' },
      labelled('Email', email, { error: emailError }),
      labelled('Phone', phone, { hint: '(optional)', error: phoneError }),
    ),
    h('div', { class: 'flex justify-end' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Continue')),
  );
}

/** Amount + currency + period, or "Prefer not to say" (resolves with null). */
function payComposer({ currency, currencies, periods, skipLabel = 'Prefer not to say' }, answer) {
  const error = fieldError();
  const amount = h('input', {
    id: uid('amount'),
    class: 'input',
    type: 'number',
    inputmode: 'decimal',
    min: 0,
    step: 'any',
    placeholder: 'Amount',
    'aria-label': 'Amount',
    'aria-describedby': error.id,
    'data-autofocus': true,
  });
  const currencySelect = h(
    'select',
    { class: 'input', 'aria-label': 'Currency' },
    currencies.map((code) => h('option', { value: code, selected: code === currency }, code)),
  );
  const periodSelect = h(
    'select',
    { class: 'input', 'aria-label': 'Pay period' },
    periods.map((period) => h('option', { value: period.value, selected: period.value === 'month' }, period.label)),
  );
  amount.addEventListener('input', () => clearError(error, amount));

  function submit(event) {
    event.preventDefault();
    if (amount.value.trim() === '') return showError(error, amount, `Enter an amount, or choose “${skipLabel}”.`);
    const value = Number(amount.value);
    if (!Number.isFinite(value) || value < 0 || value >= 1e10) return showError(error, amount, 'Please enter a valid amount.');
    const rounded = Math.round(value * 100) / 100;
    answer(
      { amount: rounded, currency: currencySelect.value, period: periodSelect.value },
      formatPay(rounded, currencySelect.value, periodSelect.value),
    );
  }

  return h(
    'form',
    { class: 'grid gap-3', novalidate: true, onsubmit: submit },
    h('div', { class: 'grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]' }, amount, currencySelect, h('div', { class: 'col-span-2 sm:col-span-1' }, periodSelect)),
    error,
    h(
      'div',
      { class: 'flex items-center justify-between gap-3' },
      h('button', { type: 'button', class: 'link-button', onclick: () => answer(null, skipLabel) }, skipLabel),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Continue'),
    ),
  );
}

/** Checkboxes for suggested roles (all ticked). Resolves with the chosen role ids. */
function roleComposer({ matches }, answer) {
  const items = matches.map(({ role, reasons }, index) => {
    const id = uid('role');
    const input = h('input', { id, type: 'checkbox', value: role.id, checked: true, class: 'mt-1 size-4 shrink-0 accent-brand', 'data-autofocus': index === 0 });
    const element = h(
      'label',
      { for: id, class: 'role-option' },
      input,
      h('span', { class: 'grid gap-0.5' }, h('span', { class: 'font-semibold text-ink' }, role.title), h('span', { class: 'text-sm text-ink-muted' }, reasons.join(' · '))),
    );
    return { role, input, element };
  });

  function submit(event) {
    event.preventDefault();
    const chosen = items.filter((item) => item.input.checked);
    answer(
      chosen.map((item) => item.role.id),
      chosen.length ? chosen.map((item) => item.role.title).join(', ') : 'None of these for now',
    );
  }

  return h(
    'form',
    { class: 'grid gap-3', onsubmit: submit },
    h('fieldset', { class: 'grid gap-2' }, h('legend', { class: 'sr-only' }, 'Roles you’d like to be considered for'), items.map((item) => item.element)),
    h('div', { class: 'flex justify-end' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Continue')),
  );
}
