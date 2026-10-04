// Reusable pieces of the interface, built with h() so every value is inserted as text.

import { areaLabel, employmentLabel, formatSalary, skillLabel, statusInfo, timeAgo, workModeLabel } from './format.js';
import { h, icon, uid } from '../lib/dom.js';

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attributes) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

// Leaflets along a gently rising stem, largest at the base like a real fern frond.
const LEAVES = [
  { x: 12, y: 18.6, rx: 6.2, angle: -42, side: -1 },
  { x: 21, y: 15.4, rx: 5.6, angle: 32, side: 1 },
  { x: 30, y: 12.6, rx: 5, angle: -46, side: -1 },
  { x: 38.5, y: 10.2, rx: 4.4, angle: 28, side: 1 },
  { x: 46.5, y: 8.2, rx: 3.8, angle: -50, side: -1 },
];

/** The match meter. leaves: 0–5. */
export function frond(leaves, { label, size = 'md', grow = false } = {}) {
  const width = size === 'lg' ? 96 : size === 'sm' ? 44 : 60;
  const root = svg('svg', {
    viewBox: '0 0 56 26',
    width,
    height: Math.round((width * 26) / 56),
    role: 'img',
    'aria-label': label ?? `Match: ${leaves} of 5`,
    class: `frond shrink-0 ${leaves >= 4 ? 'is-strong' : ''} ${grow ? 'frond-grow' : ''}`,
  });
  root.append(svg('path', { class: 'stem', d: 'M3 23 C 16 19, 33 13, 53 6' }));
  LEAVES.forEach((leaf, index) => {
    const cy = leaf.y + leaf.side * 3.6;
    // The group holds the rotation, so the leaf itself can be animated from its centre.
    const group = svg('g', { transform: `rotate(${leaf.angle} ${leaf.x} ${cy})` });
    const ellipse = svg('ellipse', { class: `leaf ${index < leaves ? 'is-on' : ''}`, cx: leaf.x, cy, rx: leaf.rx, ry: leaf.rx * 0.42 });
    if (grow) ellipse.style.animationDelay = `${index * 0.09}s`;
    group.append(ellipse);
    root.append(group);
  });
  return root;
}

/** Frond plus the words, e.g. "Strong match". */
export function matchBadge(match, { size = 'md', showReasons = false } = {}) {
  if (!match) return null;
  return h(
    'div',
    { class: 'grid gap-1' },
    h('div', { class: 'flex items-center gap-2' }, frond(match.leaves, { size, label: `${match.label}: ${match.leaves} of 5` }), h('span', { class: 'text-sm font-semibold text-ink', 'aria-hidden': 'true' }, match.label)),
    showReasons && match.reasons.length ? h('ul', { class: 'grid gap-0.5 text-sm text-ink-muted' }, match.reasons.map((reason) => h('li', {}, reason))) : null,
  );
}

export function statusBadge(status, viewer) {
  const info = statusInfo(status, viewer);
  return h('span', { class: `status status-${info.tone}` }, icon(info.icon, 'size-4'), info.label);
}

/** Skill tags; skills in `matched` are highlighted (with a check, not colour alone). */
export function skillTags(skills = [], matched = [], { matchedLabel = 'Your skill: ' } = {}) {
  const hits = new Set(matched);
  return h(
    'ul',
    { class: 'flex flex-wrap gap-1.5', 'aria-label': 'Skills' },
    skills.map((skill) =>
      h('li', { class: `tag ${hits.has(skill) ? 'tag-match' : ''}` }, hits.has(skill) ? [icon('check', 'size-3.5'), h('span', { class: 'sr-only' }, matchedLabel)] : null, skillLabel(skill)),
    ),
  );
}

export function fact(name, value) {
  return value ? h('span', { class: 'fact' }, icon(name, 'size-4 shrink-0'), value) : null;
}

/** A job in a list. match is optional (seekers with a profile). */
export function jobRow(job, { match = null } = {}) {
  const salary = formatSalary(job);
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'row-link grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start', href: `job.html?id=${encodeURIComponent(job.id)}` },
      h(
        'div',
        { class: 'grid min-w-0 gap-1.5' },
        h('h3', { class: 'font-display text-lg leading-snug font-semibold text-ink' }, job.title),
        h('p', { class: 'font-semibold text-ink-muted' }, job.employer.name),
        h('p', { class: 'facts' }, fact('pin', job.location), fact('briefcase', `${employmentLabel(job.employment_type)}, ${workModeLabel(job.work_mode).toLowerCase()}`), fact('money', salary)),
        h('p', { class: 'mt-1 text-ink' }, job.summary),
        h('p', { class: 'text-sm text-ink-muted' }, `${areaLabel(job.area)}. Posted ${timeAgo(job.created_at)}`),
      ),
      match?.leaves ? h('div', { class: 'sm:pt-1' }, matchBadge(match, { size: 'md' })) : null,
    ),
  );
}

/**
 * Job descriptions are plain text: blank lines separate blocks, "- " starts a bullet,
 * and a short line right before bullets works as a heading. Bullets left empty (from the
 * post-a-job template) are skipped.
 */
export function renderDescription(text) {
  const blocks = String(text ?? '')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter((line) => line && line !== '-'))
    .filter((lines) => lines.length);
  return h(
    'div',
    { class: 'grid gap-4 leading-7' },
    blocks.map((lines) => {
      const bullets = lines.filter((line) => line.startsWith('- '));
      if (!bullets.length) return h('p', {}, lines.join(' '));
      const lead = lines.filter((line) => !line.startsWith('- '));
      return h(
        'div',
        { class: 'grid gap-2' },
        lead.length ? h('h3', { class: 'font-display text-lg font-semibold' }, lead.join(' ')) : null,
        h('ul', { class: 'grid list-disc gap-1 pl-5 marker:text-brand' }, bullets.map((line) => h('li', {}, line.slice(2)))),
      );
    }),
  );
}

export function emptyState({ title, body, actions = [] }) {
  return h('div', { class: 'empty' }, h('h3', { class: 'font-display text-lg font-semibold' }, title), body ? h('p', { class: 'max-w-prose text-ink-muted' }, body) : null, actions.length ? h('div', { class: 'flex flex-wrap gap-2' }, actions) : null);
}

export function errorState(error, onRetry) {
  return h(
    'div',
    { class: 'alert grid justify-items-start gap-3', role: 'alert' },
    h('p', {}, error?.message ?? 'That didn’t load.'),
    onRetry ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: onRetry }, 'Try again') : null,
  );
}

export function skeletonRows(count = 3) {
  return h(
    'div',
    { class: 'row-list', 'aria-hidden': 'true' },
    Array.from({ length: count }, () => h('div', { class: 'grid gap-2.5 px-5 py-5' }, h('div', { class: 'skeleton h-5 w-2/5' }), h('div', { class: 'skeleton h-4 w-1/4' }), h('div', { class: 'skeleton h-4 w-4/5' }))),
  );
}

export function loadingText(label = 'Loading…') {
  return h('p', { class: 'sr-only', role: 'status' }, label);
}

// --- Forms ------------------------------------------------------------------------------

/**
 * A labelled input with hint and error slots.
 * kind: 'input' (default), 'textarea' or 'select' (pass options: [{ value, label }]).
 */
export function field({ label, name, kind = 'input', type = 'text', value = '', hint, optional = false, options = [], placeholder, autocomplete, inputmode, maxLength, rows, min, step, required = false, className = '' }) {
  const id = uid(name);
  const hintId = hint ? `${id}-hint` : null;
  const errorId = `${id}-error`;
  const common = { id, name, class: 'input', 'aria-describedby': [hintId, errorId].filter(Boolean).join(' '), required: required || null };
  let control;
  if (kind === 'textarea') {
    control = h('textarea', { ...common, rows: rows ?? 4, placeholder, maxlength: maxLength });
    control.value = value ?? '';
  } else if (kind === 'select') {
    control = h('select', common, options.map((option) => h('option', { value: option.value, selected: String(option.value) === String(value ?? '') }, option.label)));
  } else {
    control = h('input', { ...common, type, value: value ?? '', placeholder, autocomplete, inputmode, maxlength: maxLength, min, step });
  }
  const error = h('p', { id: errorId, class: 'field-error', hidden: true });
  const wrapper = h(
    'div',
    { class: `field ${className}`, dataset: { field: name } },
    h('label', { for: id, class: 'field-label' }, label, optional ? h('span', { class: 'field-optional' }, ' (optional)') : null),
    control,
    hint ? h('p', { id: hintId, class: 'field-hint' }, hint) : null,
    error,
  );
  return { wrapper, control };
}

/** A group of checkboxes (e.g. experience levels). */
export function checkboxGroup({ legend, name, options, values = [], hint }) {
  const errorId = uid(`${name}-error`);
  return h(
    'fieldset',
    { class: 'field', dataset: { field: name }, 'aria-describedby': errorId },
    h('legend', { class: 'field-label mb-1.5' }, legend),
    hint ? h('p', { class: 'field-hint mb-1.5' }, hint) : null,
    h(
      'div',
      { class: 'flex flex-wrap gap-2' },
      options.map((option) => {
        const id = uid(name);
        return h(
          'label',
          { for: id, class: 'role-option min-h-11 items-center py-2' },
          h('input', { type: 'checkbox', id, name, value: option.value, class: 'checkbox mt-0', checked: values.includes(option.value) }),
          h('span', { class: 'text-sm font-semibold' }, option.label),
        );
      }),
    ),
    h('p', { id: errorId, class: 'field-error', hidden: true }),
  );
}

/** Type a skill and press Enter (or a comma) to add it; each tag has a remove button. */
export function skillsInput({ label = 'Skills', name = 'skills', values = [], hint }) {
  let skills = [...values];
  const id = uid(name);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const list = h('ul', { class: 'flex flex-wrap gap-1.5', 'aria-label': `${label} added` });
  const input = h('input', { id, class: 'input', type: 'text', placeholder: 'e.g. Figma', autocomplete: 'off', 'aria-describedby': `${hintId} ${errorId}`, maxlength: 40 });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  function render() {
    list.replaceChildren(
      ...skills.map((skill) =>
        h('li', { class: 'tag' }, skillLabel(skill), h('button', { type: 'button', class: 'tag-remove', 'aria-label': `Remove ${skillLabel(skill)}`, onclick: () => remove(skill) }, icon('close', 'size-3.5'))),
      ),
    );
  }
  function add(raw) {
    const added = [];
    for (const part of String(raw).split(',')) {
      const skill = part.trim().toLowerCase();
      if (skill && skill.length <= 40 && !skills.includes(skill) && skills.length < 30) {
        skills.push(skill);
        added.push(skill);
      }
    }
    input.value = '';
    render();
    if (added.length) live.textContent = `Added ${added.map(skillLabel).join(', ')}`;
  }
  function remove(skill) {
    skills = skills.filter((value) => value !== skill);
    render();
    live.textContent = `Removed ${skillLabel(skill)}`;
    input.focus();
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(input.value);
    } else if (event.key === 'Backspace' && !input.value && skills.length) {
      remove(skills.at(-1));
    }
  });
  input.addEventListener('blur', () => input.value.trim() && add(input.value));
  render();

  const wrapper = h(
    'div',
    { class: 'field', dataset: { field: name } },
    h('label', { for: id, class: 'field-label' }, label),
    h('div', { class: 'flex gap-2' }, input, h('button', { type: 'button', class: 'btn btn-secondary shrink-0', onclick: () => add(input.value) }, 'Add')),
    h('p', { id: hintId, class: 'field-hint' }, hint ?? 'Press Enter after each one. Use the words employers use, like “React” or “Excel”.'),
    list,
    live,
    h('p', { id: errorId, class: 'field-error', hidden: true }),
  );
  return {
    wrapper,
    getValue: () => {
      if (input.value.trim()) add(input.value);
      return [...skills];
    },
    setValue: (next) => {
      skills = [...new Set((next ?? []).map((skill) => String(skill).trim().toLowerCase()).filter(Boolean))].slice(0, 30);
      render();
    },
  };
}

/** Clears earlier errors, then shows each { field, message } next to its field. */
export function showFieldErrors(form, errors = []) {
  for (const element of form.querySelectorAll('.field-error')) {
    element.hidden = true;
    element.textContent = '';
  }
  for (const control of form.querySelectorAll('[aria-invalid]')) control.removeAttribute('aria-invalid');
  const summary = form.querySelector('[data-error-summary]');
  if (summary) summary.replaceChildren();
  if (!errors.length) return;

  const shown = [];
  for (const { field: name, message } of errors) {
    const wrapper = form.querySelector(`[data-field="${CSS.escape(name)}"]`);
    if (!wrapper) continue;
    const error = wrapper.querySelector('.field-error');
    error.textContent = message;
    error.hidden = false;
    const control = wrapper.querySelector('input, select, textarea');
    control?.setAttribute('aria-invalid', 'true');
    shown.push({ message, control });
  }
  if (summary && shown.length) {
    summary.append(
      h(
        'div',
        { class: 'alert grid gap-2', role: 'alert', tabindex: '-1' },
        h('p', {}, shown.length === 1 ? 'One thing needs fixing:' : `${shown.length} things need fixing:`),
        h('ul', { class: 'grid gap-1 font-normal' }, shown.map(({ message, control }) => h('li', {}, h('a', { class: 'underline', href: `#${control?.id ?? ''}`, onclick: (event) => { event.preventDefault(); control?.focus(); } }, message)))),
      ),
    );
    summary.firstChild.focus();
  } else {
    shown[0]?.control?.focus();
  }
}

/** Puts a button into a busy state while `work` runs. */
export async function withBusy(button, busyLabel, work) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// --- Dialogs ----------------------------------------------------------------------------

/**
 * A confirmation dialog, optionally with a message box.
 * Resolves to { confirmed: boolean, message: string }.
 */
export function confirmDialog({ title, body, confirmLabel, cancelLabel = 'Cancel', tone = 'primary', message = null }) {
  return new Promise((resolve) => {
    const titleId = uid('dialog-title');
    const messageField = message ? field({ label: message.label, name: 'message', kind: 'textarea', value: message.value ?? '', hint: message.hint, optional: true, rows: 4, maxLength: 1000 }) : null;
    const confirmButton = h('button', { type: 'submit', class: `btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}` }, confirmLabel);
    let settled = false;
    // Resolves straight from the buttons and Escape, rather than waiting for the
    // dialog's "close" event (some embedded browsers delay it while not drawing).
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      const text = messageField?.control.value.trim() ?? '';
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve({ confirmed, message: text });
    };
    const dialog = h(
      'dialog',
      { class: 'sheet-dialog', 'aria-labelledby': titleId },
      h(
        'form',
        {
          class: 'grid gap-4 p-5 sm:p-6',
          onsubmit: (event) => {
            event.preventDefault();
            finish(true);
          },
        },
        h('h2', { id: titleId, class: 'font-display text-xl font-semibold' }, title),
        body ? h('p', { class: 'text-ink-muted' }, body) : null,
        messageField?.wrapper,
        h('div', { class: 'flex flex-wrap justify-end gap-2' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => finish(false) }, cancelLabel), confirmButton),
      ),
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('close', () => finish(false));
    document.body.append(dialog);
    dialog.showModal();
    (messageField?.control ?? confirmButton).focus();
  });
}

// --- Toast ------------------------------------------------------------------------------

let toastTimer;
export function showToast(message) {
  let toast = document.querySelector('#toast');
  if (!toast) {
    toast = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.dataset.visible = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => delete toast.dataset.visible, 5000);
}

/** Shows a message saved before a page change (e.g. "Job posted" after redirecting). */
export function flash(message) {
  try {
    sessionStorage.setItem('fernway-flash', message);
  } catch {
    // Not important if it's lost.
  }
}
export function showFlash() {
  try {
    const message = sessionStorage.getItem('fernway-flash');
    if (message) {
      sessionStorage.removeItem('fernway-flash');
      showToast(message);
    }
  } catch {
    // Storage blocked.
  }
}
