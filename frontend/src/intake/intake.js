// The application dialog: picks a mode (guided chat, AI chat or Typeform), runs it, then
// shows the review and thank-you screens. Answers carry over when switching modes.

import { company } from '../../shared/company.js';
import { roles } from '../../shared/roles.js';
import { config } from '../config.js';
import { fetchServerStatus, submitApplication } from '../lib/api.js';
import { buildFitSummary, createApplication, toIntakePayload } from '../lib/application.js';
import { h } from '../lib/dom.js';
import { matchRoles } from '../lib/matching.js';
import { isTypeformConfigured, openTypeformChat } from '../lib/typeform.js';
import { runAIFlow } from './ai.js';
import { createChat, FlowCancelled } from './chat-ui.js';
import { runGuidedFlow } from './guided.js';
import { renderDone, renderReview } from './review.js';

const MODES = {
  guided: { label: 'Guided chat', subtitle: 'Guided chat · about 2 minutes' },
  ai: { label: 'Chat with AI', subtitle: 'AI chat · ask me anything about Fernway' },
  typeform: { label: 'Typeform', subtitle: '' },
};

export function initIntake({ notify }) {
  const dialog = document.querySelector('#intake');
  const els = {
    subtitle: dialog.querySelector('[data-intake-subtitle]'),
    modeSwitch: dialog.querySelector('[data-mode-switch]'),
    progress: dialog.querySelector('[data-progress]'),
    progressBar: dialog.querySelector('[data-progress-bar]'),
    views: Object.fromEntries([...dialog.querySelectorAll('[data-view]')].map((view) => [view.dataset.view, view])),
    log: dialog.querySelector('[data-chat-log]'),
    composer: dialog.querySelector('[data-chat-composer]'),
  };
  const chat = createChat({ log: els.log, composer: els.composer, assistantName: company.assistantName });
  const state = { mode: null, view: 'chat', app: createApplication(), role: null };
  let serverStatus = null;
  const statusReady = fetchServerStatus().then((status) => {
    serverStatus = status;
    renderModeSwitch();
  });

  function availability(mode) {
    if (mode === 'guided') return { enabled: true };
    if (mode === 'typeform') {
      return isTypeformConfigured() ? { enabled: true } : { enabled: false, reason: 'Add your Typeform form ID in src/config.js' };
    }
    if (!serverStatus) return { enabled: false, reason: 'Server functions aren’t running' };
    return serverStatus.ai.enabled ? { enabled: true } : { enabled: false, reason: 'Set AI_API_KEY (or AI_MOCK=true) in frontend/.env.local' };
  }

  function renderModeSwitch() {
    // Unavailable modes are hidden from visitors, but shown (disabled) while developing.
    const modes = Object.keys(MODES).filter((mode) => availability(mode).enabled || import.meta.env.DEV);
    const usable = modes.filter((mode) => availability(mode).enabled);
    els.modeSwitch.hidden = !config.intake.showModeSwitch || usable.length < 2 || state.view !== 'chat';
    if (els.modeSwitch.hidden) return;
    els.modeSwitch.replaceChildren(
      h(
        'fieldset',
        { class: 'flex flex-wrap items-center gap-2' },
        h('legend', { class: 'sr-only' }, 'How would you like to apply?'),
        modes.map((mode) => {
          const { enabled, reason } = availability(mode);
          const id = `intake-mode-${mode}`;
          return h(
            'span',
            { class: 'contents' },
            h('input', {
              type: 'radio',
              name: 'intake-mode',
              id,
              value: mode,
              class: 'mode-input sr-only',
              checked: state.mode === mode,
              disabled: !enabled,
              onchange: () => switchMode(mode),
            }),
            h('label', { for: id, class: 'mode-pill', title: enabled ? null : reason }, MODES[mode].label),
          );
        }),
        serverStatus?.ai.mock && state.mode === 'ai' ? h('span', { class: 'badge' }, 'Demo replies') : null,
      ),
    );
  }

  function setView(name) {
    state.view = name;
    for (const [key, view] of Object.entries(els.views)) view.hidden = key !== name;
    els.progress.hidden = name !== 'chat';
    renderModeSwitch();
  }

  function setProgress(fraction) {
    const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
    els.progressBar.style.width = `${percent}%`;
    els.progress.setAttribute('aria-valuenow', String(percent));
  }

  function start(mode) {
    state.mode = mode;
    chat.reset();
    setView('chat');
    setProgress(0);
    els.subtitle.textContent = MODES[mode].subtitle;
    const context = {
      app: state.app,
      roles,
      preselectedRole: state.role,
      setProgress,
      onReview: showReview,
      switchMode,
    };
    const flow = mode === 'ai' ? runAIFlow : runGuidedFlow;
    flow(chat, context).catch((error) => {
      if (error instanceof FlowCancelled) return;
      console.error(error);
      chat.say('bot', 'Sorry, something went wrong. Please choose “Start over” to try again.');
    });
  }

  function switchMode(mode) {
    if (mode === state.mode && state.view === 'chat') return;
    if (mode === 'typeform') {
      renderModeSwitch(); // keep the current mode selected
      openTypeform();
      return;
    }
    start(mode);
  }

  function showReview() {
    if (state.mode !== 'ai' || !state.app.fit_summary) state.app.fit_summary = buildFitSummary(state.app);
    const suggestions = matchRoles(state.app, roles, { include: state.role?.id }).map((match) => match.role.id);
    if (!state.app.interested_roles.length) state.app.interested_roles = suggestions;
    setView('review');
    const demoNotice = serverStatus?.intake.demo ? 'Demo mode is on (INTAKE_DEMO=true): sending shows the data instead of saving it.' : null;
    renderReview(els.views.review, {
      app: state.app,
      roles,
      suggestedIds: suggestions,
      notice: demoNotice,
      onBack: () => setView('chat'),
      onSubmit: submit,
    });
  }

  async function submit(app, { honeypot }) {
    const source = state.mode === 'ai' ? 'AI recruiter' : 'Guided chat';
    const payload = toIntakePayload({ ...app, role_answers: { ...app.role_answers, applied_via: source } }, roles);
    const result = await submitApplication(payload, { honeypot });
    if (result.ok) {
      setView('done');
      renderDone(els.views.done, { app, result, onClose: close, onNewApplication: newApplication });
    }
    return result;
  }

  async function openTypeform() {
    if (dialog.open) dialog.close();
    try {
      await openTypeformChat({ onSubmit: () => notify(`Thanks! Your application is in. ${company.reviewPromise}`) });
    } catch (error) {
      console.error(error);
      notify('We couldn’t open that form. Here’s our guided chat instead.');
      open({ mode: 'guided' });
    }
  }

  function newApplication() {
    state.app = createApplication();
    state.role = null;
    start(state.mode === 'ai' ? 'ai' : 'guided');
  }

  function close() {
    dialog.close();
  }

  /** Opens the dialog. roleId comes from a job card's "Apply" button. */
  async function open({ mode, roleId } = {}) {
    await statusReady;
    const fromUrl = new URLSearchParams(location.search).get('intake');
    const wanted = [mode, state.mode, fromUrl, config.intake.defaultMode].find((candidate) => MODES[candidate]);
    const chosen = availability(wanted).enabled ? wanted : 'guided';
    if (chosen === 'typeform') return openTypeform();

    const role = roles.find((candidate) => candidate.id === roleId) ?? null;
    const roleChanged = role && role.id !== state.role?.id;
    if (role) state.role = role;
    if (state.view === 'done') {
      state.app = createApplication();
      if (!role) state.role = null;
    }
    if (!dialog.open) dialog.showModal();
    if (!state.mode || chosen !== state.mode || roleChanged || state.view === 'done') start(chosen);
  }

  dialog.querySelector('[data-intake-close]').addEventListener('click', close);
  dialog.querySelector('[data-intake-restart]').addEventListener('click', () => {
    if (state.view === 'chat' && !window.confirm('Start over? Your answers so far will be cleared.')) return;
    state.app = createApplication();
    state.role = null;
    start(state.mode === 'ai' ? 'ai' : 'guided');
  });
  // Clicking the dimmed backdrop closes the dialog; the conversation is kept for next time.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  return { open };
}
