import { employmentLabel, timeAgo } from '../app/format.js';
import { startPage } from '../app/shell.js';
import { emptyState, errorState, field, showFieldErrors, showToast } from '../app/ui.js';
import { h, icon } from '../lib/dom.js';

const { api } = await startPage({ active: 'dashboard', require: 'employer' });
const jobsSection = document.querySelector('[data-jobs]');
const summary = document.querySelector('[data-summary]');

const sum = (counts, statuses) => statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);

async function loadJobs() {
  try {
    renderJobs(await api.employer.jobs());
  } catch (error) {
    summary.textContent = '';
    jobsSection.replaceChildren(errorState(error, loadJobs));
  }
}

function renderJobs(jobs) {
  const waiting = jobs.reduce((total, job) => total + job.counts.new_applicants, 0);
  const open = jobs.filter((job) => job.status === 'open').length;
  summary.replaceChildren(
    jobs.length ? `${open} open ${open === 1 ? 'job' : 'jobs'}. ` : '',
    waiting ? h('strong', { class: 'text-ink' }, `${waiting} new ${waiting === 1 ? 'application' : 'applications'} to review.`) : jobs.length ? 'No new applications right now.' : 'Post a job to start getting applications.',
  );
  if (!jobs.length) {
    jobsSection.replaceChildren(
      emptyState({
        title: 'You haven’t posted a job yet',
        body: 'Describe the job and the skills it needs. Job seekers who match will see it near the top of their list.',
        actions: [h('a', { class: 'btn btn-primary', href: 'employer-job.html' }, 'Post your first job')],
      }),
    );
    return;
  }

  // A table on wider screens; the same rows stack on phones.
  const row = (job) => {
    const applicantsHref = `applicants.html?job=${encodeURIComponent(job.id)}`;
    const total = sum(job.counts, Object.keys(job.counts));
    return h(
      'tr',
      { class: 'grid gap-2 border-b border-line px-4 py-4 last:border-b-0 md:table-row md:p-0' },
      h(
        'td',
        { class: 'md:px-4 md:py-4' },
        h('a', { class: 'font-display text-lg font-semibold text-ink hover:text-brand hover:underline', href: applicantsHref }, job.title),
        h('p', { class: 'text-sm text-ink-muted' }, `${employmentLabel(job.employment_type)}, ${job.location}. Posted ${timeAgo(job.created_at)}`),
        job.status === 'closed' ? h('span', { class: 'status status-muted mt-1' }, icon('clock', 'size-4'), 'Closed') : null,
      ),
      h(
        'td',
        { class: 'md:px-4 md:py-4' },
        h(
          'div',
          { class: 'flex flex-wrap gap-x-4 gap-y-1 text-sm' },
          h('span', { class: job.counts.new_applicants ? 'font-semibold text-ink' : 'text-ink-muted' }, h('span', { class: 'num' }, job.counts.new_applicants), ' new'),
          h('span', { class: 'text-ink-muted' }, h('span', { class: 'num' }, job.counts.screening), ' reviewing'),
          h('span', { class: 'text-ink-muted' }, h('span', { class: 'num' }, sum(job.counts, ['interview', 'offered', 'hired'])), ' accepted'),
          h('span', { class: 'text-ink-muted' }, h('span', { class: 'num' }, job.counts.rejected), ' rejected'),
        ),
        h('p', { class: 'mt-1 text-xs text-ink-muted' }, `${total} in total`),
      ),
      h(
        'td',
        { class: 'md:px-4 md:py-4 md:text-right' },
        h(
          'div',
          { class: 'flex flex-wrap gap-2 md:justify-end' },
          h('a', { class: `btn btn-sm ${job.counts.new_applicants ? 'btn-primary' : 'btn-secondary'}`, href: applicantsHref }, job.counts.new_applicants ? `Review ${job.counts.new_applicants} new` : 'Applicants'),
          h('a', { class: 'btn btn-ghost btn-sm', href: `employer-job.html?id=${encodeURIComponent(job.id)}` }, icon('edit', 'size-4'), 'Edit'),
        ),
      ),
    );
  };

  jobsSection.replaceChildren(
    h(
      'div',
      { class: 'panel overflow-hidden' },
      h(
        'table',
        { class: 'data-table block md:table' },
        h('caption', { class: 'sr-only' }, 'Your jobs and their applicants'),
        h('thead', { class: 'hidden md:table-header-group' }, h('tr', {}, h('th', { scope: 'col' }, 'Job'), h('th', { scope: 'col' }, 'Applicants'), h('th', { scope: 'col', class: 'text-right' }, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', { class: 'block md:table-row-group' }, jobs.map(row)),
      ),
    ),
  );
}

// --- Company details --------------------------------------------------------------------

async function loadCompany() {
  const container = document.querySelector('[data-company-form]');
  try {
    const company = await api.employer.getCompany();
    document.querySelector('[data-company-name]').textContent = company.name;
    const f = {
      name: field({ label: 'Company name', name: 'name', value: company.name, autocomplete: 'organization', maxLength: 200 }),
      website: field({ label: 'Website', name: 'website', type: 'url', value: company.website, optional: true, placeholder: 'https://', inputmode: 'url' }),
      location: field({ label: 'Location', name: 'location', value: company.location, optional: true, placeholder: 'e.g. Chiang Mai' }),
      about: field({ label: 'About the company', name: 'about', kind: 'textarea', value: company.about, optional: true, rows: 4, maxLength: 2000, hint: 'Two or three sentences: what you do and who for.' }),
    };
    const save = h('button', { type: 'submit', class: 'btn btn-primary justify-self-start' }, 'Save company details');
    const form = h('form', { class: 'panel grid gap-5 p-5 sm:p-6 lg:max-w-3xl', novalidate: true }, h('div', { 'data-error-summary': true }), h('div', { class: 'grid gap-5 sm:grid-cols-2' }, f.name.wrapper, f.location.wrapper), f.website.wrapper, f.about.wrapper, save);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = (name) => f[name].control.value.trim();
      const website = value('website');
      const input = { name: value('name'), website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null, location: value('location') || null, about: value('about') || null };
      if (!input.name) return showFieldErrors(form, [{ field: 'name', message: 'Enter your company’s name.' }]);
      save.disabled = true;
      try {
        const saved = await api.employer.saveCompany(input);
        showFieldErrors(form, []);
        document.querySelector('[data-company-name]').textContent = saved.name;
        showToast('Company details saved.');
      } catch (error) {
        if (error.fields?.length) showFieldErrors(form, error.fields);
        else showToast(error.message);
      } finally {
        save.disabled = false;
      }
    });
    container.replaceChildren(form);
  } catch (error) {
    container.replaceChildren(errorState(error, loadCompany));
  }
}

loadJobs();
loadCompany();
