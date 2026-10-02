import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles.css';

import { company } from '../shared/company.js';
import { EXPERIENCE_LEVELS, labelFor, ROLE_AREAS } from '../shared/options.js';
import { roles } from '../shared/roles.js';
import { initIntake } from './intake/intake.js';
import { h } from './lib/dom.js';

const intake = initIntake({ notify: showToast });

// Every "Start…" / "Apply" button opens the chat; job cards also pass their role.
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-start-intake]');
  if (!trigger) return;
  event.preventDefault();
  intake.open({ roleId: trigger.dataset.roleId, mode: trigger.dataset.mode });
});

// --- Open roles ---------------------------------------------------------------------

const levelText = (levels) => levels.map((level) => labelFor(EXPERIENCE_LEVELS, level)).join(' / ');

function roleCard(role) {
  return h(
    'li',
    { class: 'card flex flex-col gap-4 p-6' },
    h(
      'div',
      { class: 'flex items-start justify-between gap-3' },
      h('div', {}, h('p', { class: 'eyebrow' }, labelFor(ROLE_AREAS, role.area)), h('h3', { class: 'mt-2 font-display text-xl font-semibold text-ink' }, role.title)),
      h('span', { class: 'badge shrink-0' }, role.type),
    ),
    h('p', { class: 'text-ink-muted' }, role.summary),
    h('p', { class: 'text-sm text-ink-muted' }, `${role.location} · ${levelText(role.levels)}`),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-secondary mt-auto self-start',
        'data-start-intake': true,
        'data-role-id': role.id,
        'aria-label': `Apply for ${role.title} in 2 minutes`,
      },
      'Apply in 2 minutes',
    ),
  );
}

function renderRoles(area) {
  const visible = roles.filter((role) => area === 'all' || role.area === area);
  document.querySelector('[data-role-list]').replaceChildren(...visible.map(roleCard));
}

function renderRoleFilters() {
  const container = document.querySelector('[data-role-filters]');
  const areas = [{ value: 'all', label: 'All roles' }, ...ROLE_AREAS.filter((area) => roles.some((role) => role.area === area.value))];
  const buttons = areas.map((area) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip min-h-10 py-1.5',
        'aria-pressed': String(area.value === 'all'),
        onclick: () => {
          for (const button of buttons) button.setAttribute('aria-pressed', String(button === buttonFor(area.value)));
          renderRoles(area.value);
        },
        dataset: { area: area.value },
      },
      area.label,
    ),
  );
  const buttonFor = (value) => buttons.find((button) => button.dataset.area === value);
  container.replaceChildren(...buttons);
}

// --- Company content (from shared/company.js, the same facts Fern uses) -------------

function renderCompany() {
  document.querySelector('[data-company-about]').textContent = company.about;
  document.querySelector('[data-company-perks]').replaceChildren(
    ...company.perks.map((perk) => h('li', { class: 'flex gap-2' }, h('span', { class: 'text-brand', 'aria-hidden': 'true' }, '✓'), perk)),
  );
  document.querySelector('[data-company-values]').replaceChildren(
    ...company.values.map((value) =>
      h('li', { class: 'card bg-canvas p-6' }, h('h3', { class: 'font-display text-lg font-semibold text-ink' }, value.title), h('p', { class: 'mt-2 text-ink-muted' }, value.text)),
    ),
  );
}

// --- Toast (used after a Typeform submission) ---------------------------------------

let toastTimer;
function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.dataset.visible = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => delete toast.dataset.visible, 7000);
}

renderRoleFilters();
renderRoles('all');
renderCompany();
for (const element of document.querySelectorAll('[data-role-count]')) element.textContent = String(roles.length);
for (const element of document.querySelectorAll('[data-year]')) element.textContent = String(new Date().getFullYear());
for (const element of document.querySelectorAll('[data-fictional-notice]')) element.textContent = company.fictionalNotice;
