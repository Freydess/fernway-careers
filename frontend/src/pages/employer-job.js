import { CURRENCIES, EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, PAY_PERIODS, ROLE_AREAS, WORK_MODES } from '../../shared/options.js';
import { areaLabel } from '../app/format.js';
import { startPage } from '../app/shell.js';
import { checkboxGroup, emptyState, errorState, field, flash, showFieldErrors, skillsInput } from '../app/ui.js';
import { h } from '../lib/dom.js';

const { api } = await startPage({ active: 'post', require: 'employer' });
const container = document.querySelector('[data-job-form]');
const jobId = new URLSearchParams(location.search).get('id');

const DESCRIPTION_HINT = 'Plain text. Leave a blank line between sections, and start a line with “- ” to make a bullet point.';
const DESCRIPTION_TEMPLATE = `A sentence or two about the job and the team.

What you'll do
-
-

What we're looking for
-
- `;

async function load() {
  if (!jobId) return render(null);
  try {
    const jobs = await api.employer.jobs();
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      container.replaceChildren(emptyState({ title: 'We couldn’t find that job', body: 'It may belong to another company account.', actions: [h('a', { class: 'btn btn-primary', href: 'employer.html' }, 'Back to dashboard')] }));
      return;
    }
    // The list omits the long description; fetch the full job.
    render({ ...job, ...(await api.jobs.get(jobId)) });
  } catch (error) {
    container.replaceChildren(errorState(error, load));
  }
}

function render(job) {
  const editing = Boolean(job);
  if (editing) {
    document.title = `Edit ${job.title} · Fernway for employers`;
    document.querySelector('[data-title]').textContent = `Edit ${job.title}`;
    document.querySelector('[data-intro]').textContent = 'Changes show up on the job post straight away. Applications already sent keep what the applicant saw.';
  }
  const f = {
    title: field({ label: 'Job title', name: 'title', value: job?.title, maxLength: 120, placeholder: 'e.g. Frontend Engineer' }),
    area: field({ label: 'Area', name: 'area', kind: 'select', value: job?.area ?? '', options: [{ value: '', label: 'Choose an area' }, ...ROLE_AREAS.map((area) => ({ value: area.value, label: areaLabel(area.value) }))] }),
    employment_type: field({ label: 'Job type', name: 'employment_type', kind: 'select', value: job?.employment_type ?? 'full_time', options: EMPLOYMENT_TYPES }),
    work_mode: field({ label: 'Where people work', name: 'work_mode', kind: 'select', value: job?.work_mode ?? 'onsite', options: WORK_MODES }),
    location: field({ label: 'Location', name: 'location', value: job?.location, maxLength: 120, placeholder: 'e.g. Chiang Mai, or Remote (Thailand)' }),
    summary: field({ label: 'Summary', name: 'summary', value: job?.summary, maxLength: 300, hint: 'One sentence that appears in search results.' }),
    description: field({ label: 'Description', name: 'description', kind: 'textarea', value: job?.description ?? DESCRIPTION_TEMPLATE, rows: 12, maxLength: 8000, hint: DESCRIPTION_HINT }),
    salary_min: field({ label: 'From', name: 'salary_min', type: 'number', value: job?.salary_min ?? '', min: 0, step: 1000, inputmode: 'numeric' }),
    salary_max: field({ label: 'To', name: 'salary_max', type: 'number', value: job?.salary_max ?? '', min: 0, step: 1000, inputmode: 'numeric' }),
    salary_currency: field({ label: 'Currency', name: 'salary_currency', kind: 'select', value: job?.salary_currency ?? 'THB', options: CURRENCIES.map((code) => ({ value: code, label: code })) }),
    salary_period: field({ label: 'Per', name: 'salary_period', kind: 'select', value: job?.salary_period ?? 'month', options: PAY_PERIODS.map((period) => ({ value: period.value, label: period.label.replace('per ', '') })) }),
  };
  const levels = checkboxGroup({ legend: 'Experience levels', name: 'levels', options: EXPERIENCE_LEVELS, values: job?.levels ?? [], hint: 'Choose every level that could do this job.' });
  const skills = skillsInput({ label: 'Skills', values: job?.skills ?? [], hint: 'Press Enter after each one. These decide how well job seekers match, so use common words like “React”, “Excel” or “customer support”.' });
  const status = editing
    ? h(
        'fieldset',
        { class: 'fieldset' },
        h('legend', { class: 'fieldset-title float-left mb-1 w-full' }, 'Status'),
        h(
          'div',
          { class: 'grid gap-3 sm:grid-cols-2' },
          ['open', 'closed'].map((value) =>
            h(
              'label',
              { class: 'role-option items-start p-4' },
              h('input', { type: 'radio', name: 'status', value, class: 'checkbox', checked: job.status === value }),
              h('span', { class: 'grid gap-0.5' }, h('span', { class: 'font-semibold' }, value === 'open' ? 'Open' : 'Closed'), h('span', { class: 'text-sm text-ink-muted' }, value === 'open' ? 'Shown in search, taking applications' : 'Hidden from search; applicants keep their status')),
            ),
          ),
        ),
      )
    : null;

  const save = h('button', { type: 'submit', class: 'btn btn-primary px-6' }, editing ? 'Save changes' : 'Post job');
  const form = h(
    'form',
    { class: 'grid gap-6', novalidate: true },
    h('div', { 'data-error-summary': true }),
    h('fieldset', { class: 'fieldset' }, h('legend', { class: 'fieldset-title float-left mb-1 w-full' }, 'The job'), f.title.wrapper, h('div', { class: 'grid gap-5 sm:grid-cols-3' }, f.area.wrapper, f.employment_type.wrapper, f.work_mode.wrapper), f.location.wrapper, f.summary.wrapper, f.description.wrapper),
    h('fieldset', { class: 'fieldset' }, h('legend', { class: 'fieldset-title float-left mb-1 w-full' }, 'Who it suits'), levels, skills.wrapper),
    h(
      'fieldset',
      { class: 'fieldset' },
      h('legend', { class: 'fieldset-title float-left mb-1 w-full' }, 'Pay ', h('span', { class: 'field-optional text-base' }, '(optional)')),
      h('p', { class: 'field-hint -mt-2' }, 'Jobs that show pay get more applications. Leave “From” empty to keep it private.'),
      h('div', { class: 'grid gap-3 sm:grid-cols-4' }, f.salary_min.wrapper, f.salary_max.wrapper, f.salary_currency.wrapper, f.salary_period.wrapper),
    ),
    status,
    h('div', { class: 'flex flex-wrap gap-3' }, save, editing ? h('a', { class: 'btn btn-secondary', href: `job.html?id=${encodeURIComponent(job.id)}` }, 'View job post') : null, h('a', { class: 'btn btn-ghost', href: 'employer.html' }, 'Cancel')),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = (name) => f[name].control.value.trim();
    const description = value('description');
    // An empty "From" keeps pay private. A single figure is fine: the backend wants both
    // ends of the range, so an empty "To" copies "From".
    const hasSalary = value('salary_min') !== '';
    const salaryMin = hasSalary ? Number(value('salary_min')) : null;
    const salaryMax = hasSalary && value('salary_max') !== '' ? Number(value('salary_max')) : salaryMin;
    const input = {
      title: value('title'),
      area: value('area'),
      employment_type: value('employment_type'),
      work_mode: value('work_mode'),
      location: value('location'),
      summary: value('summary'),
      description: description === DESCRIPTION_TEMPLATE.trim() ? '' : description,
      levels: [...form.querySelectorAll('input[name="levels"]:checked')].map((input) => input.value),
      skills: skills.getValue(),
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: hasSalary ? value('salary_currency') : null,
      salary_period: hasSalary ? value('salary_period') : null,
      status: form.elements.status?.value ?? 'open',
    };
    const errors = [];
    if (input.title.length < 3) errors.push({ field: 'title', message: 'Add a job title.' });
    if (!input.area) errors.push({ field: 'area', message: 'Choose an area.' });
    if (!input.location) errors.push({ field: 'location', message: 'Add a location, such as Chiang Mai or Remote (Thailand).' });
    if (!input.summary) errors.push({ field: 'summary', message: 'Add a one-sentence summary.' });
    if (!input.description) errors.push({ field: 'description', message: 'Describe the job.' });
    if (!input.levels.length) errors.push({ field: 'levels', message: 'Choose at least one experience level.' });
    if (!input.skills.length) errors.push({ field: 'skills', message: 'Add at least one skill, so job seekers can see how they match.' });
    if (input.salary_min != null && input.salary_max != null && input.salary_max < input.salary_min) errors.push({ field: 'salary_max', message: 'The top of the range can’t be lower than the bottom.' });
    if (errors.length) return showFieldErrors(form, errors);
    showFieldErrors(form, []);

    save.disabled = true;
    save.textContent = editing ? 'Saving…' : 'Posting…';
    try {
      const saved = editing ? await api.employer.updateJob(job.id, input) : await api.employer.createJob(input);
      flash(editing ? 'Changes saved.' : `“${saved.title}” is live. We’ll notify you when someone applies.`);
      location.href = 'employer.html';
    } catch (error) {
      save.disabled = false;
      save.textContent = editing ? 'Save changes' : 'Post job';
      if (error.fields?.length) showFieldErrors(form, error.fields);
      else form.querySelector('[data-error-summary]').replaceChildren(h('p', { class: 'alert', role: 'alert' }, error.message));
    }
  });

  container.replaceChildren(form);
}

load();
