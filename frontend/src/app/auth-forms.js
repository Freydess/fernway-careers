// Small helpers shared by the sign-in and sign-up pages.

/** Only follow ?next= to pages on this site (never to another website). */
export function safeNext(value) {
  if (!value) return null;
  return /^[a-z0-9-]+\.html(?:[?#][^\s]*)?$/i.test(value) ? value : null;
}

/** The "Show" button next to a password field. */
export function wirePasswordToggle(form) {
  for (const button of form.querySelectorAll('[data-toggle-password]')) {
    const input = form.querySelector(`#${button.getAttribute('aria-controls')}`);
    button.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.textContent = showing ? 'Show' : 'Hide';
      button.setAttribute('aria-pressed', String(!showing));
      input.focus();
    });
  }
}
