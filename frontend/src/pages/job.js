import { company } from '../../shared/company.js';
import { areaLabel, employmentLabel, experienceLabel, formatDate, formatSalary, levelsLabel, timeAgo, workModeLabel } from '../app/format.js';
import { matchJob } from '../app/match.js';
import { startPage } from '../app/shell.js';
import { emptyState, errorState, fact, field, matchBadge, renderDescription, showFieldErrors, skillTags, statusBadge } from '../app/ui.js';
import { h, icon } from '../lib/dom.js';

const { api, user } = await startPage({ active: 'jobs' });
const container = document.querySelector('[data-job]');
const jobId = new URLSearchParams(location.search).get('id');
const here = `job.html?id=${encodeURIComponent(jobId ?? '')}`;

async function load() {
  if (!jobId) {
    container.replaceChildren(emptyState({ title: 'No job chosen', body: 'Pick a job from the list.', actions: [h('a', { class: 'btn btn-primary', href: 'jobs.html' }, 'Find jobs')] }));
    return;
  }
  try {
    const job = await api.jobs.get(jobId);
    const [profile, applications] = user?.role === 'seeker' ? await Promise.all([api.me.getProfile(), api.me.applications()]) : [null, []];
    render(job, profile, applications.find((application) => application.job.id === job.id) ?? null);
  } catch (error) {
    if (error.status === 404) {
      container.replaceChildren(emptyState({ title: 'This job isn’t available any more', body: 'The employer may have closed it.', actions: [h('a', { class: 'btn btn-primary', href: 'jobs.html' }, 'See open jobs')] }));
    } else {
      container.replaceChildren(errorState(error, load));
    }
  }
}

function render(job, profile, existing) {
  document.title = `${job.title} at ${job.employer.name} · ${company.name}`;
  const match = profile ? matchJob(profile, job) : null;
  const salary = formatSalary(job);
  container.replaceChildren(
    h(
      'div',
      { class: 'grid items-start gap-10 lg:grid-cols-[1fr_22rem]' },
      h(
        'article',
        { class: 'grid gap-8' },
        h(
          'header',
          { class: 'grid gap-3' },
          job.status === 'closed' ? h('p', { class: 'status status-muted justify-self-start' }, icon('clock', 'size-4'), 'Closed: not taking applications') : null,
          h('h1', { class: 'page-title' }, job.title),
          h('p', { class: 'text-lg font-semibold text-ink-muted' }, job.employer.name),
          h(
            'p',
            { class: 'facts text-base' },
            fact('pin', job.location),
            fact('briefcase', `${employmentLabel(job.employment_type)}, ${workModeLabel(job.work_mode).toLowerCase()}`),
            fact('money', salary ?? 'Pay not listed'),
            fact('clock', `Posted ${timeAgo(job.created_at)}`),
          ),
          h('p', { class: 'text-ink-muted' }, `${areaLabel(job.area)}, for ${levelsLabel(job.levels).toLowerCase()} people`),
        ),
        h('p', { class: 'text-lg' }, job.summary),
        h('section', { class: 'grid gap-3', 'aria-labelledby': 'skills-title' }, h('h2', { id: 'skills-title', class: 'section-title' }, 'Skills'), skillTags(job.skills, match?.matchedSkills), match?.matchedSkills.length ? h('p', { class: 'text-sm text-ink-muted' }, 'Highlighted skills are on your profile.') : null),
        h('section', { class: 'grid gap-3', 'aria-labelledby': 'about-job-title' }, h('h2', { id: 'about-job-title', class: 'section-title' }, 'About the job'), renderDescription(job.description)),
        h(
          'section',
          { class: 'panel grid gap-2 p-5', 'aria-labelledby': 'about-company-title' },
          h('h2', { id: 'about-company-title', class: 'section-title' }, `About ${job.employer.name}`),
          job.employer.about ? h('p', { class: 'text-ink-muted' }, job.employer.about) : null,
          job.employer.website ? h('a', { class: 'link inline-flex items-center gap-1 justify-self-start', href: job.employer.website, target: '_blank', rel: 'noopener noreferrer' }, 'Website', icon('external', 'size-4'), h('span', { class: 'sr-only' }, '(opens in a new tab)')) : null,
        ),
      ),
      h('aside', { class: 'grid gap-4 lg:sticky lg:top-24', 'aria-label': 'Apply' }, match ? matchPanel(match) : null, applyPanel(job, profile, existing)),
    ),
  );
}

function matchPanel(match) {
  return h(
    'section',
    { class: 'panel grid gap-3 p-5', 'aria-labelledby': 'match-title' },
    h('h2', { id: 'match-title', class: 'section-title' }, 'How you match'),
    matchBadge(match, { size: 'lg', showReasons: true }),
    match.leaves ? null : h('p', { class: 'text-sm text-ink-muted' }, 'This job is outside the area on your profile and doesn’t list any of your skills. You can still apply.'),
  );
}

function applyPanel(job, profile, existing) {
  const panel = h('section', { class: 'panel grid gap-4 p-5', 'aria-labelledby': 'apply-title' });
  const title = h('h2', { id: 'apply-title', class: 'section-title' }, 'Apply');

  if (!user) {
    panel.append(
      title,
      h('p', { class: 'text-ink-muted' }, 'Create a free account to apply. Your profile goes with every application, so you only fill it in once.'),
      h('div', { class: 'flex flex-wrap gap-2' }, h('a', { class: 'btn btn-primary', href: `signup.html?role=seeker&next=${encodeURIComponent(here)}` }, 'Create account'), h('a', { class: 'btn btn-secondary', href: `signin.html?next=${encodeURIComponent(here)}` }, 'Sign in')),
    );
    return panel;
  }
  if (user.role === 'employer') {
    const own = user.company?.id === job.employer.id;
    panel.append(
      h('h2', { id: 'apply-title', class: 'section-title' }, own ? 'Your job' : 'Applying'),
      own
        ? h('div', { class: 'flex flex-wrap gap-2' }, h('a', { class: 'btn btn-primary', href: `applicants.html?job=${encodeURIComponent(job.id)}` }, 'See applicants'), h('a', { class: 'btn btn-secondary', href: `employer-job.html?id=${encodeURIComponent(job.id)}` }, 'Edit job'))
        : h('p', { class: 'text-ink-muted' }, 'You’re signed in as an employer. Job seekers apply with their own account.'),
    );
    return panel;
  }
  if (existing) {
    panel.append(
      title,
      h('div', { class: 'flex flex-wrap items-center gap-2' }, statusBadge(existing.status, 'seeker'), h('span', { class: 'text-sm text-ink-muted' }, `Sent ${formatDate(existing.created_at)}`)),
      existing.employer_message ? h('blockquote', { class: 'notice' }, h('p', { class: 'font-semibold' }, `Message from ${job.employer.name}`), h('p', { class: 'mt-1' }, existing.employer_message)) : null,
      h('a', { class: 'link justify-self-start', href: `applications.html#application-${encodeURIComponent(existing.id)}` }, 'See all your applications'),
    );
    return panel;
  }
  if (job.status === 'closed') {
    panel.append(title, h('p', { class: 'text-ink-muted' }, 'This job is closed and isn’t taking applications.'));
    return panel;
  }
  const ready = profile && (profile.skills?.length || profile.about);
  if (!ready) {
    panel.append(
      title,
      h('p', { class: 'text-ink-muted' }, 'Add your skills or a short summary to your profile first. Employers see your profile when you apply.'),
      h('a', { class: 'btn btn-primary justify-self-start', href: `profile.html?next=${encodeURIComponent(here)}` }, 'Complete your profile'),
    );
    return panel;
  }

  // Ready to apply: show what the employer will see, an optional note, and consent.
  const note = field({ label: `A note to ${job.employer.name}`, name: 'cover_note', kind: 'textarea', optional: true, rows: 4, maxLength: 2000, hint: 'Why this job? Two or three sentences are plenty.' });
  const consentId = 'consent-to-process';
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Send application');
  const form = h(
    'form',
    { class: 'grid gap-4', novalidate: true },
    h('div', { 'data-error-summary': true }),
    h(
      'div',
      { class: 'grid gap-1 rounded-xl bg-surface-2 p-3 text-sm' },
      h('p', { class: 'font-semibold' }, 'What the employer sees'),
      h('p', { class: 'text-ink-muted' }, [user.full_name, profile.headline, experienceLabel(profile.experience_level, profile.experience_years)].filter(Boolean).join('. ')),
      h('p', { class: 'text-ink-muted' }, `Your email, ${profile.skills?.length ?? 0} skills, your links and anything else on your profile.`),
      h('a', { class: 'link justify-self-start', href: `profile.html?next=${encodeURIComponent(here)}` }, 'Check your profile'),
    ),
    note.wrapper,
    h(
      'div',
      { class: 'field', dataset: { field: 'consent_to_process' } },
      h('label', { class: 'flex gap-3 text-sm', for: consentId }, h('input', { type: 'checkbox', id: consentId, class: 'checkbox', name: 'consent' }), h('span', {}, `I agree that ${job.employer.name} and Fernway may store and use my profile to review this application, as described in the `, h('a', { class: 'link', href: 'privacy.html', target: '_blank' }, 'privacy notice'), '.')),
      h('p', { class: 'field-error', hidden: true }),
    ),
    submit,
  );
  let idempotencyKey = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const consent = form.querySelector(`#${consentId}`).checked;
    if (!consent) return showFieldErrors(form, [{ field: 'consent_to_process', message: 'Tick the box to agree before applying.' }]);
    showFieldErrors(form, []);
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const application = await api.jobs.apply(job.id, { cover_note: note.control.value.trim() || null, consent_to_process: true }, idempotencyKey);
      panel.replaceChildren(
        h('h2', { id: 'apply-title', class: 'section-title flex items-center gap-2', tabindex: '-1' }, icon('checkCircle', 'size-6 text-brand'), 'Application sent'),
        h('p', {}, `${job.employer.name} has your application. You’ll get a notification when they accept or reject it.`),
        h('div', { class: 'flex flex-wrap gap-2' }, h('a', { class: 'btn btn-primary', href: `applications.html#application-${encodeURIComponent(application.id)}` }, 'See your applications'), h('a', { class: 'btn btn-secondary', href: 'jobs.html' }, 'Find more jobs')),
      );
      panel.querySelector('h2').focus();
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Send application';
      if (error.code === 'already_applied') return load();
      if (error.fields?.length) return showFieldErrors(form, error.fields);
      if (error.status !== 0) idempotencyKey = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
      form.querySelector('[data-error-summary]').replaceChildren(h('p', { class: 'alert', role: 'alert' }, error.message));
    }
  });
  panel.append(title, form);
  return panel;
}

load();
