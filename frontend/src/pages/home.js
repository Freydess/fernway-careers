import { ROLE_AREAS } from '../../shared/options.js';
import { areaLabel, employmentLabel, listAnd } from '../app/format.js';
import { matchJob } from '../app/match.js';
import { startPage, homeFor } from '../app/shell.js';
import { errorState, frond, jobRow, skeletonRows, skillTags } from '../app/ui.js';
import { h, icon } from '../lib/dom.js';

const { api, user } = await startPage();

// Signed-in visitors get buttons that lead to their own pages.
if (user) {
  for (const link of document.querySelectorAll('[data-seeker-cta], [data-employer-cta]')) {
    const isEmployerLink = link.hasAttribute('data-employer-cta');
    if (user.role === 'seeker' && !isEmployerLink) Object.assign(link, { href: 'profile.html', textContent: 'Go to your profile' });
    if (user.role === 'employer' && isEmployerLink) Object.assign(link, { href: 'employer-job.html', textContent: 'Post a job' });
  }
  // The interest form is for people without an account.
  document.querySelector('[data-interest-form]')?.remove();
}

document.querySelector('[data-area-select]').append(...ROLE_AREAS.map((area) => h('option', { value: area.value }, areaLabel(area.value))));

// An example person for the hero, so visitors see what the match meter means.
const SAMPLE_PERSON = { target_role: 'engineering', experience_level: 'junior', skills: ['javascript', 'react', 'css', 'html'], headline: '', about: '' };

const latest = document.querySelector('[data-latest-jobs]');
latest.replaceChildren(skeletonRows(4));

async function load() {
  try {
    const { items, total } = await api.jobs.list({ limit: 50 });
    renderHero(items);
    latest.replaceChildren(items.length ? h('ul', { class: 'row-list' }, items.slice(0, 5).map((job) => jobRow(job))) : h('p', { class: 'muted' }, 'No jobs yet.'));
    document.querySelector('[data-all-jobs-link]').textContent = `See all ${total} jobs`;
    renderEmployers(items);
  } catch (error) {
    latest.replaceChildren(errorState(error, load));
  }
}

function renderHero(jobs) {
  const job = jobs.find((candidate) => candidate.area === 'engineering' && candidate.levels.includes('junior')) ?? jobs[0];
  if (!job) return;
  const match = matchJob(SAMPLE_PERSON, job);
  document.querySelector('[data-hero-sample-body]').replaceChildren(
    h(
      'div',
      { class: 'grid gap-4' },
      h(
        'div',
        { class: 'flex items-start justify-between gap-4' },
        h('div', {}, h('p', { class: 'font-display text-xl font-semibold text-ink' }, job.title), h('p', { class: 'text-ink-muted' }, `${job.employer.name}, ${job.location}`)),
        h('span', { class: 'badge shrink-0' }, employmentLabel(job.employment_type)),
      ),
      h('div', { class: 'flex items-center gap-3' }, frond(match.leaves, { size: 'lg', grow: true, label: `${match.label}: ${match.leaves} of 5` }), h('p', { class: 'font-display text-lg font-semibold text-brand' }, match.label)),
      h('ul', { class: 'grid gap-1 text-sm text-ink' }, match.reasons.map((reason) => h('li', { class: 'flex gap-2' }, icon('check', 'mt-0.5 size-4 shrink-0 text-brand'), reason))),
      skillTags(job.skills, match.matchedSkills),
      h('a', { class: 'link justify-self-start text-sm', href: `job.html?id=${encodeURIComponent(job.id)}` }, 'Open this job'),
    ),
  );
  document.querySelector('[data-hero-sample-caption]').textContent = 'An example: how this job matches someone who knows JavaScript, React, CSS and HTML. Each leaf is one part of the match.';
}

function renderEmployers(jobs) {
  const employers = new Map();
  for (const job of jobs) {
    const entry = employers.get(job.employer.id) ?? { name: job.employer.name, location: job.location, count: 0, areas: new Set() };
    entry.count += 1;
    entry.areas.add(areaLabel(job.area));
    employers.set(job.employer.id, entry);
  }
  document.querySelector('[data-employer-list]').replaceChildren(
    ...[...employers.values()].map((employer) =>
      h(
        'li',
        { class: 'panel grid gap-1 p-4' },
        h('p', { class: 'font-semibold text-ink' }, employer.name),
        h('p', { class: 'text-sm text-ink-muted' }, `${employer.count} open ${employer.count === 1 ? 'job' : 'jobs'} in ${listAnd([...employer.areas]).toLowerCase()}`),
      ),
    ),
  );
}

if (user) document.querySelector('[data-all-jobs-link]').href = user.role === 'employer' ? 'jobs.html' : homeFor(user);
load();
