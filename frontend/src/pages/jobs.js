import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, ROLE_AREAS, WORK_MODES } from '../../shared/options.js';
import { areaLabel } from '../app/format.js';
import { rankJobs } from '../app/match.js';
import { startPage } from '../app/shell.js';
import { emptyState, errorState, jobRow, skeletonRows } from '../app/ui.js';
import { h } from '../lib/dom.js';

const { api, user } = await startPage({ active: 'jobs' });
const isSeeker = user?.role === 'seeker';

const form = document.querySelector('[data-filters]');
const results = document.querySelector('[data-results]');
const count = document.querySelector('[data-count]');
const sortSelect = document.querySelector('[data-sort]');
const FILTERS = ['q', 'area', 'level', 'work_mode', 'employment_type'];

const fill = (name, options) => form.elements[name].append(...options.map((option) => h('option', { value: option.value }, option.label)));
fill('area', ROLE_AREAS.map((area) => ({ value: area.value, label: areaLabel(area.value) })));
fill('level', EXPERIENCE_LEVELS);
fill('work_mode', WORK_MODES);
fill('employment_type', EMPLOYMENT_TYPES);

// Filters live in the URL, so a search can be shared and the back button keeps it.
const params = new URLSearchParams(location.search);
for (const name of FILTERS) form.elements[name].value = params.get(name) ?? '';
sortSelect.value = params.get('sort') === 'newest' ? 'newest' : 'match';

// Wide screens always show every filter; phones show them when one is in use.
const moreFilters = document.querySelector('[data-more-filters]');
const wide = window.matchMedia('(min-width: 1024px)');
const syncFilters = () => {
  if (wide.matches || FILTERS.slice(1).some((name) => params.get(name))) moreFilters.open = true;
};
syncFilters();
wide.addEventListener('change', syncFilters);

let profile = null;
if (isSeeker) {
  document.querySelector('[data-title]').textContent = 'Jobs for you';
  profile = await api.me.getProfile().catch(() => null);
  const hasProfile = profile && (profile.skills?.length || profile.target_role || profile.experience_level);
  document.querySelector('[data-intro]').textContent = hasProfile
    ? 'Ranked by how well each job matches your profile. Each leaf on the frond is one part of the match.'
    : 'Search by skill, job title or company.';
  document.querySelector('[data-sort-wrapper]').hidden = !hasProfile;
  if (!hasProfile) {
    document.querySelector('[data-profile-notice]').append(
      h('p', { class: 'notice flex flex-wrap items-center gap-x-3 gap-y-2' }, 'Add your skills and experience to see how well each job matches you.', h('a', { class: 'link', href: 'profile.html?next=jobs.html' }, 'Complete your profile')),
    );
  }
  if (!hasProfile) profile = null;
}

function currentFilters() {
  return Object.fromEntries(FILTERS.map((name) => [name, form.elements[name].value.trim()]).filter(([, value]) => value));
}

function syncUrl(filters) {
  const search = new URLSearchParams(filters);
  if (profile && sortSelect.value === 'newest') search.set('sort', 'newest');
  history.replaceState(null, '', search.size ? `?${search}` : location.pathname);
}

let requestId = 0;
async function load() {
  const filters = currentFilters();
  syncUrl(filters);
  const mine = ++requestId;
  results.replaceChildren(skeletonRows(4));
  count.textContent = 'Loading jobs…';
  try {
    const { items } = await api.jobs.list({ ...filters, limit: 100 });
    if (mine !== requestId) return;
    render(items, filters);
  } catch (error) {
    if (mine !== requestId) return;
    count.textContent = 'Jobs didn’t load';
    results.replaceChildren(errorState(error, load));
  }
}

function render(jobs, filters) {
  count.textContent = `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}${Object.keys(filters).length ? ' match your filters' : ' open now'}`;
  if (!jobs.length) {
    results.replaceChildren(
      emptyState({
        title: 'No jobs match those filters',
        body: filters.q ? `Try a shorter word than “${filters.q}”, or clear some filters.` : 'Try clearing some filters.',
        actions: [h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => form.reset() }, 'Clear filters')],
      }),
    );
    return;
  }
  const ranked = profile ? rankJobs(profile, jobs) : jobs.map((job) => ({ job, match: null }));
  if (sortSelect.value === 'newest') ranked.sort((a, b) => b.job.created_at.localeCompare(a.job.created_at));
  results.replaceChildren(h('ul', { class: 'row-list' }, ranked.map(({ job, match }) => jobRow(job, { match }))));
}

let typingTimer;
form.addEventListener('input', (event) => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(load, event.target.name === 'q' ? 300 : 0);
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  load();
});
form.addEventListener('reset', () => setTimeout(load));
sortSelect.addEventListener('change', load);

load();
