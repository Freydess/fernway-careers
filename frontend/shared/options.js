// Answer options shared by the page, Fern (the AI recruiter) and the server.
// Every `value` must match what the backend accepts (app/schemas.py) exactly.

export const ROLE_AREAS = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'design', label: 'Design' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'operations', label: 'Operations' },
  { value: 'other', label: 'Something else' },
];

export const EXPERIENCE_LEVELS = [
  { value: 'intern', label: 'Intern', hint: 'Student or first role' },
  { value: 'junior', label: 'Junior', hint: 'About 0–2 years' },
  { value: 'mid', label: 'Mid-level', hint: 'About 2–5 years' },
  { value: 'senior', label: 'Senior', hint: '5+ years' },
  { value: 'lead', label: 'Lead', hint: 'Leading people or projects' },
];

// Sent to the backend as free text.
export const AVAILABILITY = ['Immediately', 'In 2–4 weeks', 'In 1–3 months', 'Just exploring'];

export const PAY_PERIODS = [
  { value: 'hour', label: 'per hour' },
  { value: 'day', label: 'per day' },
  { value: 'month', label: 'per month' },
  { value: 'year', label: 'per year' },
  { value: 'project', label: 'per project' },
];

export const CURRENCIES = ['THB', 'USD', 'EUR', 'GBP', 'SGD', 'MYR', 'VND', 'PHP', 'IDR', 'INR', 'JPY', 'KRW', 'CNY', 'AUD', 'CAD'];

export function labelFor(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}
