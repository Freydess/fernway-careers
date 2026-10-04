// "Build it with Fern": the chat dialog on the profile page. The person picks the guided
// chat or the AI chat; either way the answers come back as profile fields, which the page
// puts into the form for them to check and save. Answers carry over when switching modes.

import { company } from '../../shared/company.js';
import { fetchServerStatus } from '../app/api.js';
import { createApplication } from '../lib/application.js';
import { h } from '../lib/dom.js';
import { runAIFlow } from './ai.js';
import { createChat, FlowCancelled } from './chat-ui.js';
import { runGuidedFlow } from './guided.js';

const MODES = {
  guided: { label: 'Guided chat', subtitle: 'Guided chat, about 2 minutes' },
  ai: { label: 'Chat with AI', subtitle: 'AI chat, in your own words' },
};

let controller = null;

/** known: the profile as it stands. onDone(fields) receives the collected profile fields. */
export function openProfileBuilder({ known = {}, onDone }) {
  controller ??= createController();
  controller.open({ known, onDone });
}

function draftFrom(known) {
  const draft = { ...createApplication(), headline: '', skills: [] };
  for (const [key, value] of Object.entries(known)) {
    if (value == null || value === '') continue;
    if (key === 'skills') draft.skills = [...value];
    else if (key === 'about') draft.role_answers.highlights = value;
    else if (key in draft) draft[key] = value;
  }
  return draft;
}

/** Turns the chat's answers into profile fields. */
function toProfileFields(draft) {
  const answers = draft.role_answers;
  const about = [
    answers.highlights,
    answers.case_study ? `A project I’m proud of: ${answers.case_study}` : null,
    answers.key_metrics ? `A result I’m proud of: ${answers.key_metrics}` : null,
  ].filter(Boolean);
  const pick = (value) => (value === '' ? null : value);
  return {
    full_name: pick(draft.full_name),
    headline: pick(draft.headline),
    about: about.length ? about.join('\n\n') : null,
    phone: pick(draft.phone),
    target_role: pick(draft.target_role),
    role_detail: pick(draft.role_detail),
    experience_level: pick(draft.experience_level),
    experience_years: pick(draft.experience_years),
    skills: draft.skills,
    portfolio_url: pick(draft.portfolio_url),
    resume_url: pick(draft.resume_url),
    availability: pick(draft.availability),
    compensation_amount: pick(draft.compensation_amount),
    compensation_currency: pick(draft.compensation_currency),
    compensation_period: pick(draft.compensation_period),
    compensation_expectations: pick(draft.compensation_expectations),
  };
}

function createController() {
  const dialog = document.querySelector('#intake');
  const els = {
    subtitle: dialog.querySelector('[data-intake-subtitle]'),
    modeSwitch: dialog.querySelector('[data-mode-switch]'),
    progressBar: dialog.querySelector('[data-progress-bar]'),
    progress: dialog.querySelector('[data-progress]'),
    log: dialog.querySelector('[data-chat-log]'),
    composer: dialog.querySelector('[data-chat-composer]'),
  };
  const chat = createChat({ log: els.log, composer: els.composer, assistantName: company.assistantName });
  const state = { mode: null, draft: null, onDone: null };
  let aiEnabled = false;
  let aiMock = false;

  fetchServerStatus().then((status) => {
    aiEnabled = Boolean(status?.ai?.enabled);
    aiMock = Boolean(status?.ai?.mock);
    renderModeSwitch();
  });

  function renderModeSwitch() {
    els.modeSwitch.hidden = !aiEnabled;
    if (!aiEnabled) return;
    els.modeSwitch.replaceChildren(
      h(
        'fieldset',
        { class: 'flex flex-wrap items-center gap-2' },
        h('legend', { class: 'sr-only' }, 'How would you like to chat?'),
        Object.entries(MODES).map(([mode, info]) =>
          h(
            'span',
            { class: 'contents' },
            h('input', { type: 'radio', name: 'intake-mode', id: `intake-mode-${mode}`, value: mode, class: 'mode-input sr-only', checked: state.mode === mode, onchange: () => start(mode) }),
            h('label', { for: `intake-mode-${mode}`, class: 'mode-pill' }, info.label),
          ),
        ),
        aiMock && state.mode === 'ai' ? h('span', { class: 'badge' }, 'Demo replies') : null,
      ),
    );
  }

  function setProgress(fraction) {
    const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
    els.progressBar.style.width = `${percent}%`;
    els.progress.setAttribute('aria-valuenow', String(percent));
  }

  function finish() {
    const fields = toProfileFields(state.draft);
    dialog.close();
    state.onDone?.(fields);
  }

  function start(mode) {
    state.mode = mode;
    chat.reset();
    setProgress(0);
    els.subtitle.textContent = MODES[mode].subtitle;
    renderModeSwitch();
    const flow = mode === 'ai' ? runAIFlow : runGuidedFlow;
    flow(chat, { app: state.draft, setProgress, onReview: finish, switchMode: start }).catch((error) => {
      if (error instanceof FlowCancelled) return;
      console.error(error);
      chat.say('bot', 'Sorry, something went wrong. Choose “Start over” to try again.');
    });
  }

  dialog.querySelector('[data-intake-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-intake-restart]').addEventListener('click', () => {
    if (!window.confirm('Start over? Your answers in this chat will be cleared.')) return;
    state.draft = draftFrom(state.known);
    start(state.mode ?? 'guided');
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  return {
    open({ known, onDone }) {
      state.known = known;
      state.onDone = onDone;
      state.draft = draftFrom(known);
      if (!dialog.open) dialog.showModal();
      start(state.mode ?? 'guided');
    },
  };
}
