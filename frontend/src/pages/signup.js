import { safeNext, wirePasswordToggle } from '../app/auth-forms.js';
import { homeFor, startPage } from '../app/shell.js';
import { flash, showFieldErrors } from '../app/ui.js';

const { api, user } = await startPage();
const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next'));

if (user) location.replace(next ?? homeFor(user));
if (next) document.querySelector('[data-signin-link]').href = `signin.html?next=${encodeURIComponent(next)}`;

const form = document.querySelector('[data-signup-form]');
const companyField = document.querySelector('[data-company-field]');
const emailHint = document.querySelector('[data-email-hint]');
const submit = document.querySelector('[data-submit]');
wirePasswordToggle(form);

function syncRole() {
  const employer = form.elements.role.value === 'employer';
  companyField.hidden = !employer;
  form.elements.company_name.required = employer;
  emailHint.textContent = employer ? 'We’ll send notifications about applicants here.' : 'Employers you apply to will use this to contact you.';
  submit.textContent = employer ? 'Create employer account' : 'Create account';
}
if (params.get('role') === 'employer') form.elements.role.value = 'employer';
syncRole();
form.addEventListener('change', (event) => event.target.name === 'role' && syncRole());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = {
    role: form.elements.role.value,
    full_name: form.elements.full_name.value.trim(),
    email: form.elements.email.value.trim(),
    password: form.elements.password.value,
    ...(form.elements.role.value === 'employer' ? { company_name: form.elements.company_name.value.trim() } : {}),
  };
  const errors = [];
  if (!input.full_name) errors.push({ field: 'full_name', message: 'Enter your name.' });
  if (input.role === 'employer' && !input.company_name) errors.push({ field: 'company_name', message: 'Enter your company’s name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.email)) errors.push({ field: 'email', message: 'Enter an email address like name@example.com.' });
  if (input.password.length < 8) errors.push({ field: 'password', message: 'Use at least 8 characters for your password.' });
  if (errors.length) return showFieldErrors(form, errors);
  showFieldErrors(form, []);

  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = 'Creating your account…';
  try {
    const created = await api.auth.register(input);
    if (created.role === 'employer') {
      flash(`Welcome to Fernway, ${created.full_name.split(' ')[0]}! Post your first job to start getting applications.`);
      location.href = 'employer-job.html';
    } else {
      flash(`Welcome, ${created.full_name.split(' ')[0]}! Fill in your profile to see how jobs match you.`);
      location.href = next ? `profile.html?next=${encodeURIComponent(next)}` : 'profile.html';
    }
  } catch (error) {
    submit.disabled = false;
    submit.textContent = label;
    showFieldErrors(form, error.fields?.length ? error.fields : [{ field: 'email', message: error.message }]);
  }
});
