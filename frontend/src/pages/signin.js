import { homeFor, startPage } from '../app/shell.js';
import { showFieldErrors } from '../app/ui.js';
import { h, icon } from '../lib/dom.js';
import { safeNext, wirePasswordToggle } from '../app/auth-forms.js';

const { api, user } = await startPage();
const next = safeNext(new URLSearchParams(location.search).get('next'));

// Already signed in: go where they were heading.
if (user) location.replace(next ?? homeFor(user));

if (next) document.querySelector('[data-signup-link]').href = `signup.html?next=${encodeURIComponent(next)}`;

const form = document.querySelector('[data-signin-form]');
wirePasswordToggle(form);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  const errors = [];
  if (!email) errors.push({ field: 'email', message: 'Enter your email address.' });
  if (!password) errors.push({ field: 'password', message: 'Enter your password.' });
  if (errors.length) return showFieldErrors(form, errors);
  showFieldErrors(form, []);

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const signedIn = await api.auth.login({ email, password });
    location.href = next ?? homeFor(signedIn);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Sign in';
    const message = error.status === 401 ? 'Wrong email or password. Check them and try again.' : error.message;
    showFieldErrors(form, error.fields?.length ? error.fields : [{ field: 'password', message }]);
  }
});

// Demo mode: one-click accounts, so a presentation can switch between both sides quickly.
if (api.mode === 'demo') {
  const accounts = await api.auth.demoAccounts();
  const section = document.querySelector('[data-demo-accounts]');
  section.hidden = false;
  const seekers = accounts.filter((account) => account.role === 'seeker');
  const employers = accounts.filter((account) => account.role === 'employer');
  document.querySelector('[data-demo-list]').replaceChildren(
    ...[...seekers, ...employers].map((account) =>
      h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            class: 'panel flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:border-brand',
            onclick: async () => {
              const signedIn = await api.auth.demoSignIn(account.id);
              location.href = next ?? homeFor(signedIn);
            },
          },
          h('span', { class: 'grid size-9 shrink-0 place-items-center rounded-full bg-surface-2' }, icon(account.role === 'employer' ? 'building' : 'user', 'size-4')),
          h(
            'span',
            { class: 'grid' },
            h('span', { class: 'font-semibold text-ink' }, account.role === 'employer' ? account.company.name : account.full_name),
            h('span', { class: 'text-sm text-ink-muted' }, account.role === 'employer' ? `Employer, signed in as ${account.full_name}` : 'Job seeker'),
          ),
        ),
      ),
    ),
  );
}
