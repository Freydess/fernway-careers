// The AI chat: Fern talks with the job seeker in their own words and fills in their
// profile. Each message goes to our own server function (/api/chat), which holds the AI
// key and returns Fern's reply plus the profile fields collected so far. Nothing is saved
// until the person checks the profile form.

import { company } from '../../shared/company.js';
import { EXPERIENCE_LEVELS, ROLE_AREAS } from '../../shared/options.js';
import { normalizeUrl } from '../lib/application.js';
import { sleep } from '../lib/dom.js';
import { splitSkills } from './guided.js';

const AREA_VALUES = new Set(ROLE_AREAS.map((area) => area.value));
const LEVEL_VALUES = new Set(EXPERIENCE_LEVELS.map((level) => level.value));
const TEXT_FIELDS = ['full_name', 'phone', 'headline', 'role_detail', 'availability', 'compensation_expectations'];

const ERROR_MESSAGES = {
  ai_not_configured: 'The AI chat isn’t switched on yet. The guided chat asks the same things in about 2 minutes.',
  ai_rate_limited: 'Lots of people are chatting with me right now. Try again in a minute, or switch to the guided chat.',
  network: 'I can’t reach the server right now. Check your connection and try again.',
};

export async function runAIFlow(chat, { app, setProgress, onReview, switchMode }) {
  const history = [];
  const greeting = app.full_name
    ? `Hi ${app.full_name.split(' ')[0]}! I’m ${company.assistantName}. Tell me about the work you do, or the work you want, and I’ll fill in your profile as we go.`
    : `Hi! I’m ${company.assistantName}, and I’ll help you fill in your ${company.name} profile. What’s your name, and what kind of work do you enjoy?`;
  await chat.bot(greeting);
  history.push({ role: 'assistant', content: greeting });
  setProgress(progressOf(app));

  for (;;) {
    const message = await chat.ask({ multiline: true, placeholder: 'Write a reply…', label: 'Your message', maxLength: 1500 });
    history.push({ role: 'user', content: message });
    const turn = await requestTurn(chat, history, app, switchMode);
    if (!turn) return; // they switched to the guided chat
    mergeFields(app, turn.fields);
    history.push({ role: 'assistant', content: turn.reply });
    await chat.bot(turn.reply);
    setProgress(progressOf(app));
    if (turn.complete) {
      const next = await chat.ask({
        type: 'choices',
        options: [
          { value: 'review', label: 'Put it in my profile' },
          { value: 'chat', label: 'Keep chatting' },
        ],
      });
      if (next === 'review') return onReview();
    }
  }
}

async function requestTurn(chat, history, app, switchMode) {
  const stillCurrent = chat.checkpoint();
  for (let attempt = 1; ; attempt++) {
    const hideTyping = chat.showTyping();
    const result = await postTurn(history, app);
    hideTyping();
    stillCurrent();
    if (result.ok) return result.turn;

    if (result.error === 'ai_rate_limited' && attempt === 1 && result.retryAfter > 0 && result.retryAfter <= 20) {
      await chat.bot(`I’m getting a lot of messages right now. Give me ${result.retryAfter} seconds…`);
      await sleep(result.retryAfter * 1000);
      stillCurrent();
      continue;
    }
    await chat.bot(ERROR_MESSAGES[result.error] ?? 'Sorry, something went wrong on my side.');
    const choice = await chat.ask({
      type: 'choices',
      options: [
        { value: 'retry', label: 'Try again' },
        { value: 'guided', label: 'Switch to the guided chat' },
      ],
    });
    if (choice === 'guided') {
      switchMode('guided'); // keeps everything collected so far
      return null;
    }
  }
}

async function postTurn(history, app) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-40), known: knownFields(app) }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && typeof data.reply === 'string') return { ok: true, turn: data };
    return { ok: false, error: data.error ?? `http_${response.status}`, retryAfter: Number(data.retryAfter) || 0 };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** What we already know, in the shape the server expects (null = unknown). */
function knownFields(app) {
  const orNull = (value) => (value === '' || value == null ? null : value);
  return {
    full_name: orNull(app.full_name),
    phone: orNull(app.phone),
    headline: orNull(app.headline),
    target_role: orNull(app.target_role),
    role_detail: orNull(app.role_detail),
    experience_level: orNull(app.experience_level),
    experience_years: app.experience_years === '' ? null : Number(app.experience_years),
    skills: app.skills.length ? app.skills : null,
    portfolio_url: orNull(app.portfolio_url),
    resume_url: orNull(app.resume_url),
    highlights: orNull(app.role_answers.highlights),
    availability: orNull(app.availability),
    compensation_expectations: orNull(app.compensation_expectations),
  };
}

/** Copies Fern's fields into the profile draft, keeping only values the backend accepts. */
function mergeFields(app, fields = {}) {
  for (const name of TEXT_FIELDS) {
    if (typeof fields[name] === 'string' && fields[name].trim()) app[name] = fields[name].trim();
  }
  if (AREA_VALUES.has(fields.target_role)) app.target_role = fields.target_role;
  if (LEVEL_VALUES.has(fields.experience_level)) app.experience_level = fields.experience_level;
  if (typeof fields.experience_years === 'number' && fields.experience_years >= 0 && fields.experience_years <= 80) {
    app.experience_years = Math.round(fields.experience_years * 10) / 10;
  }
  for (const name of ['portfolio_url', 'resume_url']) {
    const url = normalizeUrl(fields[name]);
    if (url) app[name] = url;
  }
  if (Array.isArray(fields.skills)) app.skills = [...new Set([...app.skills, ...splitSkills(fields.skills)])].slice(0, 30);
  if (typeof fields.highlights === 'string' && fields.highlights.trim()) app.role_answers.highlights = fields.highlights.trim();
}

function progressOf(app) {
  const done = [app.full_name, app.target_role, app.experience_level, app.skills.length, app.role_answers.highlights, app.portfolio_url || app.resume_url, app.availability].filter(Boolean).length;
  return done / 7;
}
