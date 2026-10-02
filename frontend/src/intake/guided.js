// Path C: the guided chat. The same friendly script for everyone in an area, written
// as one async function on top of chat.ask(). Questions already answered (for example
// in the AI chat, before switching) are skipped.

import { company } from '../../shared/company.js';
import { AVAILABILITY, CURRENCIES, EXPERIENCE_LEVELS, PAY_PERIODS, ROLE_AREAS } from '../../shared/options.js';
import { firstName, guessCurrency } from '../lib/application.js';
import { matchRoles } from '../lib/matching.js';

// Area-specific questions. `field` is an application field; anything else is saved in
// role_answers under that key (keys match the backend's Typeform references).
const BRANCHES = {
  engineering: [
    {
      field: 'tech_stack',
      ask: 'Which languages or frameworks do you use most?',
      input: { multiline: true, placeholder: 'e.g. TypeScript, React, Python, PostgreSQL', label: 'Languages and frameworks' },
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
      ask: 'Where can we see your work? A portfolio or Figma link is perfect.',
      input: { kind: 'url', placeholder: 'yourname.design', label: 'Portfolio link', optional: true, skipLabel: 'I’ll share it later' },
    },
    {
      field: 'case_study',
      ask: 'Tell us about one project you’re proud of: the problem, and what changed because of your design.',
      input: { multiline: true, placeholder: 'A sentence or two is plenty', label: 'A project you’re proud of' },
    },
  ],
  marketing: [
    {
      field: 'acquisition_channels',
      ask: 'Which channels do you know best? Pick any.',
      input: { type: 'multi', label: 'Channels', options: ['SEO', 'Paid ads', 'Social', 'Email', 'Content', 'Partnerships', 'Events', 'Community'] },
    },
    {
      field: 'key_metrics',
      ask: 'What’s a result you’ve driven that you’re proud of?',
      input: { multiline: true, placeholder: 'e.g. Grew newsletter sign-ups 40% in three months', label: 'A result you’re proud of' },
    },
    {
      field: 'portfolio_url',
      ask: 'What’s your LinkedIn or portfolio link?',
      input: { kind: 'url', placeholder: 'linkedin.com/in/yourname', label: 'LinkedIn or portfolio link', optional: true, skipLabel: 'Skip' },
    },
  ],
  operations: [
    {
      field: 'role_detail',
      ask: 'Which kind of operations work interests you most?',
      input: {
        type: 'choices',
        label: 'Operations focus',
        options: ['People & recruiting', 'Customer operations', 'Finance & admin', 'Business operations'].map((value) => ({ value, label: value })),
      },
    },
    {
      field: 'key_metrics',
      ask: 'What’s a process you improved, or a result you’re proud of?',
      input: { multiline: true, placeholder: 'e.g. Cut new-hire onboarding from two weeks to four days', label: 'A result you’re proud of' },
    },
    {
      field: 'portfolio_url',
      ask: 'What’s your LinkedIn profile?',
      input: { kind: 'url', placeholder: 'linkedin.com/in/yourname', label: 'LinkedIn link', optional: true, skipLabel: 'Skip' },
    },
  ],
  other: [
    {
      field: 'role_detail',
      ask: 'What kind of role are you looking for?',
      input: { placeholder: 'e.g. Customer support, data analysis…', label: 'Role you’re looking for', maxLength: 200 },
    },
    {
      field: 'highlights',
      ask: 'Anything about your experience we should know?',
      input: { multiline: true, label: 'Your experience', optional: true, skipLabel: 'Skip' },
    },
    {
      field: 'portfolio_url',
      ask: 'Is there a link that shows your work, like LinkedIn or a portfolio?',
      input: { kind: 'url', placeholder: 'linkedin.com/in/yourname', label: 'Link to your work', optional: true, skipLabel: 'Skip' },
    },
  ],
};

const isAppField = (app, field) => Object.hasOwn(app, field) && field !== 'role_answers';

function hasAnswer(app, field) {
  return isAppField(app, field) ? app[field] !== '' : Boolean(app.role_answers[field]);
}

function record(app, field, value) {
  const text = Array.isArray(value) ? value.join(', ') : value;
  if (text === '' || text == null) return;
  if (isAppField(app, field)) app[field] = text;
  else app.role_answers[field] = text;
}

export async function runGuidedFlow(chat, { app, roles, preselectedRole, setProgress, onReview }) {
  const branch = () => BRANCHES[app.target_role] ?? BRANCHES.other;
  let answered = 0;
  const step = () => setProgress(++answered / (9 + branch().length));
  setProgress(0);

  await chat.bot(`Hi! I’m ${company.assistantName}, ${company.name}’s hiring assistant 🌿`);
  await chat.bot('I’ll ask a few quick questions (about 2 minutes), then show you roles that fit. You can check and edit everything before it’s sent.');
  await chat.ask({ type: 'choices', options: [{ value: 'start', label: 'Let’s go' }] });

  if (!app.full_name) {
    await chat.bot('First, what’s your full name?');
    app.full_name = await chat.ask({ placeholder: 'Your full name', label: 'Full name', autocomplete: 'name', maxLength: 200 });
  }
  step();
  const name = firstName(app.full_name);

  if (preselectedRole) {
    app.target_role = preselectedRole.area;
    if (!app.interested_roles.includes(preselectedRole.id)) app.interested_roles.push(preselectedRole.id);
    await chat.bot(`Great to meet you, ${name}! You’re interested in the ${preselectedRole.title} role. Nice choice.`);
  } else if (app.target_role) {
    await chat.bot(`Great to meet you, ${name}!`);
  } else {
    await chat.bot(`Great to meet you, ${name}! Which area fits you best?`);
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
    await chat.bot('What pay are you hoping for? This is optional, and it won’t rule you out.');
    const pay = await chat.ask({ type: 'pay', currency: guessCurrency(app.timezone), currencies: CURRENCIES, periods: PAY_PERIODS });
    if (pay) {
      app.compensation_amount = pay.amount;
      app.compensation_currency = pay.currency;
      app.compensation_period = pay.period;
    }
  }
  step();

  if (!app.email) {
    await chat.bot('Almost done! Where should we reach you?');
    const contact = await chat.ask({ type: 'contact' });
    app.email = contact.email;
    app.phone = contact.phone;
  }
  step();

  const matches = matchRoles(app, roles, { include: preselectedRole?.id });
  if (matches.length) {
    await chat.bot(`Thanks, ${name}! Based on what you told me, these roles look like a good fit. Untick any you’re not interested in.`);
    app.interested_roles = await chat.ask({ type: 'roles', matches });
  } else {
    await chat.bot(`Thanks, ${name}! None of our open roles is a close match right now, but our team reads every application and keeps strong profiles in mind for new roles.`);
  }
  step();

  await chat.bot('Here’s everything in one place. Check it, then send it to our team.');
  onReview();
}
