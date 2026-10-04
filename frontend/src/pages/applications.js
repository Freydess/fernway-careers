import { FINAL_STATUSES } from '../../shared/options.js';
import { formatDate, timeAgo } from '../app/format.js';
import { startPage } from '../app/shell.js';
import { confirmDialog, emptyState, errorState, showToast, statusBadge } from '../app/ui.js';
import { h } from '../lib/dom.js';

const { api } = await startPage({ active: 'applications', require: 'seeker' });
const container = document.querySelector('[data-applications]');

const NEXT_STEP = {
  new_applicants: 'The employer hasn’t opened it yet.',
  screening: 'The employer has seen your application and is deciding.',
  interview: 'The employer will contact you about next steps.',
  offered: 'Congratulations! Check your email for the details.',
  hired: 'Congratulations on the new job!',
  rejected: 'Don’t give up: there are more jobs that match you.',
  withdrawn: 'You withdrew this application.',
};

async function load() {
  try {
    render(await api.me.applications());
  } catch (error) {
    container.replaceChildren(errorState(error, load));
  }
}

function render(applications) {
  if (!applications.length) {
    container.replaceChildren(
      emptyState({
        title: 'You haven’t applied to anything yet',
        body: 'Find a job that matches you, then apply with one click.',
        actions: [h('a', { class: 'btn btn-primary', href: 'jobs.html' }, 'See jobs for you')],
      }),
    );
    return;
  }
  const open = applications.filter((application) => !FINAL_STATUSES.has(application.status)).length;
  container.replaceChildren(
    h('p', { class: 'mb-4 text-ink-muted' }, `${applications.length} ${applications.length === 1 ? 'application' : 'applications'}, ${open} still open`),
    h('ul', { class: 'grid gap-3' }, applications.map(card)),
  );
  highlightFromHash();
}

function card(application) {
  const { job } = application;
  return h(
    'li',
    { id: `application-${application.id}`, class: 'panel grid gap-3 p-5 transition-shadow', tabindex: '-1' },
    h(
      'div',
      { class: 'flex flex-wrap items-start justify-between gap-3' },
      h('div', { class: 'grid gap-0.5' }, h('h2', { class: 'font-display text-lg font-semibold' }, h('a', { class: 'hover:text-brand hover:underline', href: `job.html?id=${encodeURIComponent(job.id)}` }, job.title)), h('p', { class: 'font-semibold text-ink-muted' }, job.employer.name)),
      statusBadge(application.status, 'seeker'),
    ),
    h('p', { class: 'text-sm text-ink-muted' }, `Sent ${formatDate(application.created_at)}. Updated ${timeAgo(application.updated_at)}. ${NEXT_STEP[application.status] ?? ''}`),
    application.employer_message ? h('blockquote', { class: 'notice' }, h('p', { class: 'font-semibold' }, `Message from ${job.employer.name}`), h('p', { class: 'mt-1 whitespace-pre-line' }, application.employer_message)) : null,
    application.cover_note ? h('details', { class: 'text-sm' }, h('summary', { class: 'cursor-pointer font-semibold text-ink-muted' }, 'Your note'), h('p', { class: 'mt-2 whitespace-pre-line' }, application.cover_note)) : null,
    FINAL_STATUSES.has(application.status) ? null : h('button', { type: 'button', class: 'btn btn-ghost btn-sm justify-self-start px-2 text-danger', onclick: () => withdraw(application) }, 'Withdraw application'),
  );
}

async function withdraw(application) {
  const { confirmed } = await confirmDialog({
    title: 'Withdraw this application?',
    body: `${application.job.employer.name} will be told you withdrew from ${application.job.title}. You can’t undo this or apply to the same job again.`,
    confirmLabel: 'Withdraw',
    tone: 'danger',
  });
  if (!confirmed) return;
  try {
    await api.me.withdraw(application.id);
    showToast('Application withdrawn.');
    await load();
  } catch (error) {
    showToast(error.message);
  }
}

// Coming from a notification: bring that application into view.
function highlightFromHash() {
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (!target) return;
  target.classList.add('ring-2', 'ring-brand');
  target.scrollIntoView({ block: 'center' });
  target.focus({ preventScroll: true });
}

window.addEventListener('hashchange', highlightFromHash);
load();
