import { company } from '../../shared/company.js';
import { areaLabel, experienceLabel, formatDate, formatDateTime, formatExpectation, statusInfo } from '../app/format.js';
import { matchJob } from '../app/match.js';
import { startPage } from '../app/shell.js';
import { confirmDialog, emptyState, errorState, matchBadge, showToast, skillTags, statusBadge } from '../app/ui.js';
import { h, icon } from '../lib/dom.js';

const { api } = await startPage({ active: 'dashboard', require: 'employer' });
const container = document.querySelector('[data-applicant]');
const applicationId = new URLSearchParams(location.search).get('id');

async function load() {
  if (!applicationId) return location.replace('employer.html');
  try {
    render(await api.employer.application(applicationId));
  } catch (error) {
    container.replaceChildren(error.status === 404 ? emptyState({ title: 'We couldn’t find that application', body: 'It may be for another company’s job.', actions: [h('a', { class: 'btn btn-primary', href: 'employer.html' }, 'Back to dashboard')] }) : errorState(error, load));
  }
}

const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'them';

function section(title, ...content) {
  return h('section', { class: 'grid gap-2' }, h('h2', { class: 'section-title' }, title), ...content);
}

function externalLink(href, label) {
  return h('a', { class: 'link inline-flex items-center gap-1', href, target: '_blank', rel: 'noopener noreferrer' }, label, icon('external', 'size-4'), h('span', { class: 'sr-only' }, '(opens in a new tab)'));
}

function render(application) {
  const { candidate, job } = application;
  const first = firstName(candidate.full_name);
  const match = matchJob(candidate, job, { viewer: 'employer' });
  document.title = `${candidate.full_name} for ${job.title} · ${company.name}`;
  const back = document.querySelector('[data-back]');
  back.href = `applicants.html?job=${encodeURIComponent(job.id)}`;
  back.textContent = `All applicants for ${job.title}`;

  const pay = formatExpectation(candidate);
  container.replaceChildren(
    h(
      'div',
      { class: 'grid items-start gap-10 lg:grid-cols-[1fr_22rem]' },
      h(
        'article',
        { class: 'grid gap-8' },
        h(
          'header',
          { class: 'grid gap-2' },
          h('div', { class: 'flex flex-wrap items-center gap-3' }, h('h1', { class: 'page-title' }, candidate.full_name), statusBadge(application.status, 'employer')),
          candidate.headline ? h('p', { class: 'text-lg text-ink-muted' }, candidate.headline) : null,
          h('p', { class: 'text-sm text-ink-muted' }, `Applied ${formatDate(application.created_at)} for ${job.title}`),
        ),
        application.cover_note ? h('blockquote', { class: 'panel border-l-4 border-l-brand p-5' }, h('p', { class: 'font-semibold' }, `${first}’s note`), h('p', { class: 'mt-2 whitespace-pre-line' }, application.cover_note)) : null,
        candidate.about ? section('About', h('p', { class: 'max-w-prose whitespace-pre-line leading-7' }, candidate.about)) : null,
        section('Skills', candidate.skills?.length ? skillTags(candidate.skills, match?.matchedSkills ?? [], { matchedLabel: 'Asked for in your job: ' }) : h('p', { class: 'text-ink-muted' }, 'No skills listed.'), match?.matchedSkills.length ? h('p', { class: 'text-sm text-ink-muted' }, 'Highlighted skills are ones your job asks for.') : null),
        section(
          'Experience',
          h(
            'dl',
            { class: 'grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]' },
            h('dt', { class: 'font-semibold' }, 'Area'),
            h('dd', { class: 'text-ink-muted' }, [candidate.target_role ? areaLabel(candidate.target_role) : null, candidate.role_detail].filter(Boolean).join(': ') || 'Not given'),
            h('dt', { class: 'font-semibold' }, 'Level'),
            h('dd', { class: 'text-ink-muted' }, experienceLabel(candidate.experience_level, candidate.experience_years) || 'Not given'),
            h('dt', { class: 'font-semibold' }, 'Can start'),
            h('dd', { class: 'text-ink-muted' }, candidate.availability || 'Not given'),
            h('dt', { class: 'font-semibold' }, 'Pay hoped for'),
            h('dd', { class: 'text-ink-muted' }, pay || 'Not given'),
            h('dt', { class: 'font-semibold' }, 'Lives in'),
            h('dd', { class: 'text-ink-muted' }, candidate.location || 'Not given'),
          ),
        ),
        section(
          'Links',
          candidate.portfolio_url || candidate.resume_url
            ? h('ul', { class: 'grid gap-2' }, candidate.resume_url ? h('li', { class: 'flex items-center gap-2' }, icon('file', 'size-4 text-ink-muted'), externalLink(candidate.resume_url, 'Resume')) : null, candidate.portfolio_url ? h('li', { class: 'flex items-center gap-2' }, icon('link', 'size-4 text-ink-muted'), externalLink(candidate.portfolio_url, 'Portfolio or profile')) : null)
            : h('p', { class: 'text-ink-muted' }, 'No links added.'),
        ),
      ),
      h(
        'aside',
        { class: 'grid gap-4 lg:sticky lg:top-24', 'aria-label': 'Decision and contact' },
        decisionPanel(application, first),
        match ? h('section', { class: 'panel grid gap-3 p-5', 'aria-labelledby': 'match-title' }, h('h2', { id: 'match-title', class: 'section-title' }, `How ${first} matches`), matchBadge(match, { size: 'lg', showReasons: true })) : null,
        h(
          'section',
          { class: 'panel grid gap-2 p-5', 'aria-labelledby': 'contact-title' },
          h('h2', { id: 'contact-title', class: 'section-title' }, 'Contact'),
          h('a', { class: 'link inline-flex items-center gap-2 break-all', href: `mailto:${candidate.email}` }, icon('mail', 'size-4 shrink-0'), candidate.email),
          candidate.phone ? h('a', { class: 'link inline-flex items-center gap-2', href: `tel:${candidate.phone.replace(/[^\d+]/g, '')}` }, icon('phone', 'size-4 shrink-0'), candidate.phone) : null,
          h('p', { class: 'text-xs text-ink-muted' }, 'Use these only for this application.'),
        ),
        history(application),
      ),
    ),
  );
}

function decisionPanel(application, first) {
  const { status, job } = application;
  const panel = h('section', { class: 'panel grid gap-3 p-5', 'aria-labelledby': 'decision-title' }, h('h2', { id: 'decision-title', class: 'section-title' }, 'Your decision'));
  const accept = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => decide(application, 'accept') }, icon('checkCircle', 'size-4'), 'Accept');
  const reject = h('button', { type: 'button', class: 'btn btn-danger', onclick: () => decide(application, 'reject') }, icon('xCircle', 'size-4'), 'Reject');

  if (status === 'new_applicants' || status === 'screening') {
    panel.append(h('p', { class: 'text-sm text-ink-muted' }, `${first} will get a notification with your decision and any message you add.`), h('div', { class: 'flex flex-wrap gap-2' }, accept, reject));
  } else if (status === 'interview') {
    panel.append(
      h('p', {}, `You accepted ${first}. Contact them to arrange the next step.`),
      application.employer_message ? h('p', { class: 'notice whitespace-pre-line' }, application.employer_message) : null,
      h('div', { class: 'flex flex-wrap gap-2' }, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => stage(application, 'offered') }, 'Mark offer made'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm text-danger', onclick: () => decide(application, 'reject') }, 'Reject')),
    );
  } else if (status === 'offered') {
    panel.append(
      h('p', {}, `You made ${first} an offer.`),
      h('div', { class: 'flex flex-wrap gap-2' }, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => stage(application, 'hired') }, 'Mark as hired'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm text-danger', onclick: () => decide(application, 'reject') }, 'Reject')),
    );
  } else {
    const words = { hired: `${first} is hired. Congratulations!`, rejected: `You rejected ${first}’s application for ${job.title}.`, withdrawn: `${first} withdrew their application.` };
    panel.append(h('p', {}, words[status] ?? ''), application.employer_message && status === 'rejected' ? h('p', { class: 'notice whitespace-pre-line' }, application.employer_message) : null);
  }
  return panel;
}

async function decide(application, decision) {
  const { candidate, job } = application;
  const first = firstName(candidate.full_name);
  const accepting = decision === 'accept';
  const { confirmed, message } = await confirmDialog(
    accepting
      ? {
          title: `Accept ${first}?`,
          body: `${first} will get a notification straight away. Tell them what happens next.`,
          confirmLabel: 'Accept and notify',
          message: { label: `Message to ${first}`, value: `Hi ${first}, thanks for applying! We’d like to talk to you about the ${job.title} role. We’ll email you this week to arrange a time.`, hint: 'They’ll see this with your decision.' },
        }
      : {
          title: `Reject ${first}?`,
          body: `${first} will be told they weren’t selected. A short, kind message helps.`,
          confirmLabel: 'Reject and notify',
          tone: 'danger',
          message: { label: `Message to ${first}`, value: `Hi ${first}, thank you for applying for ${job.title}. We’ve decided to move forward with other applicants this time, and we wish you the best of luck.`, hint: 'They’ll see this with your decision.' },
        },
  );
  if (!confirmed) return;
  try {
    const updated = await api.employer.decide(application.id, { decision, message: message || null, expected_version: application.version });
    render(updated);
    showToast(accepting ? `Accepted. ${first} has been notified.` : `Rejected. ${first} has been notified.`);
    document.querySelector('#decision-title')?.focus?.();
  } catch (error) {
    showToast(error.message);
    if (error.status === 409) load();
  }
}

async function stage(application, status) {
  const first = firstName(application.candidate.full_name);
  const { confirmed } = await confirmDialog({
    title: status === 'offered' ? `Mark that you made ${first} an offer?` : `Mark ${first} as hired?`,
    body: `${first} will get a notification.`,
    confirmLabel: status === 'offered' ? 'Mark offer made' : 'Mark as hired',
  });
  if (!confirmed) return;
  try {
    render(await api.employer.stage(application.id, { status, expected_version: application.version }));
    showToast(`${first} has been notified.`);
  } catch (error) {
    showToast(error.message);
    if (error.status === 409) load();
  }
}

function history(application) {
  const labels = { new_applicants: 'Applied', screening: 'You opened it' };
  return h(
    'section',
    { class: 'panel grid gap-3 p-5', 'aria-labelledby': 'history-title' },
    h('h2', { id: 'history-title', class: 'section-title' }, 'History'),
    h(
      'ol',
      { class: 'grid gap-3 border-l-2 border-line pl-4' },
      [...(application.history ?? [])].reverse().map((event) =>
        h(
          'li',
          { class: 'grid gap-0.5' },
          h('p', { class: 'text-sm font-semibold' }, labels[event.status] ?? statusInfo(event.status, 'employer').label),
          h('p', { class: 'text-xs text-ink-muted' }, formatDateTime(event.at)),
        ),
      ),
    ),
  );
}

load();
