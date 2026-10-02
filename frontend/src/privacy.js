import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles.css';

import { company } from '../shared/company.js';

for (const element of document.querySelectorAll('[data-year]')) element.textContent = String(new Date().getFullYear());
for (const element of document.querySelectorAll('[data-fictional-notice]')) element.textContent = company.fictionalNotice;
for (const element of document.querySelectorAll('[data-contact-email]')) {
  element.textContent = company.contactEmail;
  element.href = `mailto:${company.contactEmail}`;
}
