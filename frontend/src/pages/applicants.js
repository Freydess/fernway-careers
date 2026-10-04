import { company } from '../../shared/company.js';
import { experienceLabel, skillList, statusInfo, timeAgo } from '../app/format.js';
import { matchJob } from '../app/match.js';
import { startPage } from '../app/shell.js';
import { emptyState, errorState, frond, statusBadge } from '../app/ui.js';
import { h } from '../lib/dom.js';

const { api } = await startPage({ active: 'dashboard', require: 'employer' });
const container = document.querySelector('[data-applicants]');
const params = new URLSearchParams(location.search);
const jobId = params.get('job');

// Tabs group the hiring stages the way an employer thinks about them.
const TABS = [
  { key: 'all', label: 'All', statuses: null },
  { key: 'new', label: 'New', statuses: ['new_applicants'] },
  { key: 'reviewing', label: 'Reviewing', statuses: ['screening'] },
  { key: 'accepted', label: 'Accepted', statuses: ['interview', 'offered', 'hired'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { key: 'withdrawn', label: 'Withdrawn', statuses: ['withdrawn'] },
];
let activeTab = TABS.some((tab) => tab.key === params.get('show')) ? params.get('show') : 'all';
let sortBy = 'match';

async function load() {
  if (!jobId) {
    location.replace('employer.html');
    return;
  }
  try {
    const [jobs, applications] = await Promise.all([api.employer.jobs(), api.employer.applications(jobId)]);
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw Object.assign(new Error('We couldn’t find that job.'), { status: 404 });
    render(job, applications);
  } catch (error) {
    container.replaceChildren(error.status === 404 ? emptyState({ title: 'We couldn’t find that job', actions: [h('a', { class: 'btn btn-primary', href: 'employer.html' }, 'Back to dashboard')] }) : errorState(error, load));
  }
}

function render(job, applications) {
  document.title = `Applicants for ${job.title} · ${company.name}`;
  const list = h('div');
  const tabBar = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Show applicants' });
  const withMatch = applications.map((application) => ({ application, match: matchJob(application.candidate, job, { viewer: 'employer' }) }));

  function draw() {
    const tab = TABS.find((candidate) => candidate.key === activeTab);
    tabBar.replaceChildren(
      ...TABS.map((candidate) => {
        const count = candidate.statuses ? applications.filter((application) => candidate.statuses.includes(application.status)).length : applications.length;
        if (!count && !['all', 'new'].includes(candidate.key)) return null;
        return h('button', { type: 'button', class: 'tab', 'aria-pressed': String(candidate.key === activeTab), onclick: () => select(candidate.key) }, candidate.label, h('span', { class: 'tab-count num' }, count));
      }).filter(Boolean),
    );
    const shown = withMatch.filter(({ application }) => !tab.statuses || tab.statuses.includes(application.status));
    shown.sort((a, b) => (sortBy === 'match' ? (b.match?.leaves ?? 0) - (a.match?.leaves ?? 0) : 0) || b.application.created_at.localeCompare(a.application.created_at));
    if (!shown.length) {
      list.replaceChildren(
        emptyState(
          applications.length
            ? { title: `No ${tab.label.toLowerCase()} applicants`, body: 'Try another tab.' }
            : { title: 'No applications yet', body: 'We’ll send you a notification as soon as someone applies. Jobs with a clear summary and skills get more matches.' },
        ),
      );
      return;
    }
    list.replaceChildren(h('ul', { class: 'row-list' }, shown.map(({ application, match }) => row(application, match))));
  }

  function select(key) {
    activeTab = key;
    const search = new URLSearchParams(location.search);
    if (key === 'all') search.delete('show');
    else search.set('show', key);
    history.replaceState(null, '', `?${search}`);
    draw();
  }

  const sortSelect = h('select', { class: 'input min-h-10 w-auto py-1.5 text-sm', onchange: (event) => ((sortBy = event.target.value), draw()) }, h('option', { value: 'match' }, 'Best match'), h('option', { value: 'newest' }, 'Newest'));
  container.replaceChildren(
    h(
      'div',
      { class: 'flex flex-wrap items-end justify-between gap-4' },
      h('div', {}, h('h1', { class: 'page-title' }, job.title), h('p', { class: 'mt-1 text-ink-muted' }, `${applications.length} ${applications.length === 1 ? 'applicant' : 'applicants'}${job.status === 'closed' ? '. This job is closed.' : ''}`)),
      h('div', { class: 'flex flex-wrap gap-2' }, h('a', { class: 'btn btn-secondary btn-sm', href: `job.html?id=${encodeURIComponent(job.id)}` }, 'View job post'), h('a', { class: 'btn btn-ghost btn-sm', href: `employer-job.html?id=${encodeURIComponent(job.id)}` }, 'Edit job')),
    ),
    h('div', { class: 'mt-6 flex flex-wrap items-end justify-between gap-3' }, tabBar, h('label', { class: 'flex items-center gap-2 text-sm' }, h('span', { class: 'font-semibold' }, 'Sort by'), sortSelect)),
    h('div', { class: 'mt-4' }, list),
  );
  draw();
}

function row(application, match) {
  const { candidate } = application;
  const isNew = application.status === 'new_applicants';
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'row-link grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center', href: `applicant.html?id=${encodeURIComponent(application.id)}` },
      h(
        'div',
        { class: 'grid min-w-0 gap-1' },
        h('p', { class: 'flex items-center gap-2 font-display text-lg font-semibold text-ink' }, isNew ? h('span', { class: 'size-2 shrink-0 rounded-full bg-sun', 'aria-hidden': 'true' }) : null, candidate.full_name),
        h('p', { class: 'text-ink-muted' }, [candidate.headline, experienceLabel(candidate.experience_level, candidate.experience_years)].filter(Boolean).join('. ') || 'No headline'),
        h('p', { class: 'text-sm text-ink-muted' }, `Applied ${timeAgo(application.created_at)}${match?.matchedSkills.length ? `. Has ${skillList(match.matchedSkills, 3)}` : ''}`),
      ),
      match ? h('div', { class: 'flex items-center gap-2' }, frond(match.leaves, { size: 'md', label: `${match.label}: ${match.leaves} of 5` }), h('span', { class: 'text-sm font-semibold', 'aria-hidden': 'true' }, match.label)) : h('span'),
      h('div', { class: 'sm:justify-self-end', title: statusInfo(application.status, 'employer').label }, statusBadge(application.status, 'employer')),
    ),
  );
}

load();
