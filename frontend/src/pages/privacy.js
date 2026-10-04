import { company } from '../../shared/company.js';
import { startPage } from '../app/shell.js';

await startPage();

for (const element of document.querySelectorAll('[data-fictional-notice]')) element.textContent = company.fictionalNotice;
for (const element of document.querySelectorAll('[data-contact-email]')) {
  element.textContent = company.contactEmail;
  element.href = `mailto:${company.contactEmail}`;
}
