// The guided chat: Fern asks a fixed, friendly set of questions and fills in the job
// seeker's profile. Written as one async function on top of chat.ask(). Questions that
// are already answered (on the profile, or earlier in the AI chat) are skipped.

import { company } from '../../shared/company.js';
import { AVAILABILITY, CURRENCIES, EXPERIENCE_LEVELS, PAY_PERIODS, ROLE_AREAS } from '../../shared/options.js';
import { firstName, guessCurrency } from '../lib/application.js';

// Area-specific questions. `field` is a profile field, `skills` adds to the skills list,
// and anything else is kept in role_answers and folded into "About you" at the end.
const BRANCHES = {
  engineering: [
    {
      field: 'skills',
      ask: 'Which languages, frameworks and tools do you use most? Separate them with commas.',
      input: { multiline: true, placeholder: 'e.g. TypeScript, React, Python, PostgreSQL', label: 'Languages and tools' },
    },
    {
      field: 'portfolio_url',
      ask: 'Got a GitHub profile or code samples? Paste a link.',
      input: { kind: 'url', placeholder: 'github.com/yourname', label: 'GitHub or code samples link', optional: true, skipLabel: 'No public code yet' },
    },
  ],
  design: [
    {
      field: 'portfolio_url',
      ask: 'Where can employers see your work? A portfolio or Figma link is perfect.',
      input: { kind: 'url', placeholder: 'yourname.design', label: 'Portfolio link', optional: true, skipLabel: 'I’ll add it later' },
    },
    {
      field: 'case_study',
      ask: 'Tell me about one project you’re proud of: the problem, and what changed because of your design.',
      input: { multiline: true, placeholder: 'A sentence or two is plenty', label: 'A project you’re proud of' },
    },
  ],
  marketing: [
    {
      field: 'skills',
      ask: 'Which channels do you know best? Pick any.',
      input: { type: 'multi', label: 'Channels', options: ['SEO', 'Paid ads', 'Social media', 'Email', 'Content', 'Partnerships', 'Events', 'Community'] },
    },
    {
      field: 'key_metrics',
      ask: 'What’s a result you’ve driven that you’re proud of?',
      input: { multiline: true, placeholder: 'e.g. Grew newsletter sign-ups 40% in three months', label: 'A result you’re proud of' },
    },
  ],
  operations: [
    {
      field: 'role_detail',
      ask: 'Which kind of operations work interests you most?',
      input: {
        type: 'choices',
        label: 'Operations focus',
        options: ['People & recruiting', 'Customer support', 'Finance & admin', 'Business operations'].map((value) => ({ value, label: value })),
      },
    },
    {
      field: 'key_metrics',
      ask: 'What’s a process you improved, or a result you’re proud of?',
      input: { multiline: true, placeholder: 'e.g. Cut new-hire onboarding from two weeks to four days', label: 'A result you’re proud of' },
    },
  ],
  other: [
    {
      field: 'role_detail',
      ask: 'What kind of role are you looking for?',
      input: { placeholder: 'e.g. Data analysis, customer support…', label: 'Role you’re looking for', maxLength: 200 },
    },
    {
      field: 'highlights',
      ask: 'Tell me a little about your experience so far.',
      input: { multiline: true, label: 'Your experience', optional: true, skipLabel: 'Skip' },
    },
  ],
};

const isAppField = (app, field) => Object.hasOwn(app, field) && field !== 'role_answers' && field !== 'skills';

function hasAnswer(app, field) {
  if (field === 'skills') return app.skills.length > 0;
  return isAppField(app, field) ? app[field] !== '' : Boolean(app.role_answers[field]);
}

/** Splits "React, CSS and Figma" style answers into separate skills. */
export function splitSkills(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/,|\n|;|\band\b/);
  return parts.map((part) => part.trim().toLowerCase()).filter((part) => part && part.length <= 40);
}

function record(app, field, value) {
  if (field === 'skills') {
    app.skills = [...new Set([...app.skills, ...splitSkills(value)])];
    return;
  }
  const text = Array.isArray(value) ? value.join(', ') : value;
  if (text === '' || text == null) return;
  if (isAppField(app, field)) app[field] = text;
  else app.role_answers[field] = text;
}

export async function runGuidedFlow(chat, { app, setProgress, onReview }) {
  const branch = () => BRANCHES[app.target_role] ?? BRANCHES.other;
  let answered = 0;
  const step = () => setProgress(++answered / (9 + branch().length));
  setProgress(0);

  await chat.bot(`Hi! I’m ${company.assistantName}. I’ll ask a few quick questions (about 2 minutes) and fill in your ${company.name} profile.`);
  await chat.bot('Nothing is saved until you check it, and you can change anything afterwards.');
  await chat.ask({ type: 'choices', options: [{ value: 'start', label: 'Let’s go' }] });

  if (!app.full_name) {
    await chat.bot('First, what’s your full name?');
    app.full_name = await chat.ask({ placeholder: 'Your full name', label: 'Full name', autocomplete: 'name', maxLength: 200 });
  }
  step();
  const name = firstName(app.full_name);

  if (app.target_role) {
    await chat.bot(`Great to meet you, ${name}!`);
  } else {
    await chat.bot(`Great to meet you, ${name}! Which area do you want to work in?`);
    app.target_role = await chat.ask({ type: 'choices', label: 'Area', options: ROLE_AREAS });
  }
  step();

  for (const question of branch()) {
    if (!hasAnswer(app, question.field)) {
      await chat.bot(question.ask);
      record(app, question.field, await chat.ask(question.input));
    }
    step();
  }

  if (!app.skills.length) {
    await chat.bot('Which skills or tools are you good at? Separate them with commas.');
    record(app, 'skills', await chat.ask({ multiline: true, placeholder: 'e.g. Excel, customer service, Canva', label: 'Skills and tools' }));
  }
  step();

  if (!app.experience_level) {
    await chat.bot('How would you describe your experience level?');
    app.experience_level = await chat.ask({ type: 'choices', label: 'Experience level', options: EXPERIENCE_LEVELS });
  }
  step();

  if (app.experience_level !== 'intern' && app.experience_years === '') {
    await chat.bot('Roughly how many years of relevant experience is that?');
    const years = await chat.ask({ kind: 'number', min: 0, max: 80, step: 0.5, placeholder: 'e.g. 3', label: 'Years of experience', optional: true });
    if (years !== '') app.experience_years = Math.round(years * 10) / 10;
  }
  step();

  if (!app.resume_url) {
    await chat.bot('Do you have a resume link? Google Drive, Dropbox or OneDrive all work. Just set sharing to “anyone with the link”.');
    app.resume_url = await chat.ask({ kind: 'url', placeholder: 'drive.google.com/…', label: 'Resume link', optional: true, skipLabel: 'I don’t have one handy' });
  }
  step();

  if (!app.availability) {
    await chat.bot('When could you start?');
    app.availability = await chat.ask({ type: 'choices', label: 'Start date', options: AVAILABILITY.map((value) => ({ value, label: value })) });
  }
  step();

  if (app.compensation_amount === '' && !app.compensation_expectations) {
    await chat.bot('What pay are you hoping for? This is optional, and it won’t hide any jobs from you.');
    const pay = await chat.ask({ type: 'pay', currency: guessCurrency(app.timezone), currencies: CURRENCIES, periods: PAY_PERIODS });
    if (pay) {
      app.compensation_amount = pay.amount;
      app.compensation_currency = pay.currency;
      app.compensation_period = pay.period;
    }
  }
  step();

  if (!app.phone) {
    await chat.bot('Last one: a phone number employers can call? Only employers you apply to will see it.');
    app.phone = await chat.ask({ kind: 'tel', placeholder: '+66 00 000 0000', label: 'Phone number', autocomplete: 'tel', maxLength: 40, optional: true, skipLabel: 'Skip' });
  }
  step();

  await chat.bot(`Thanks, ${name}! I’ll put all of this into your profile now, so you can check it and save.`);
  onReview();
}
