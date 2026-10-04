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

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
  { value: 'freelance', label: 'Freelance' },
];

export const WORK_MODES = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
];

// The backend's hiring stages (app/schemas.py), as each side of the marketplace sees them.
export const APPLICATION_STATUSES = {
  new_applicants: { seeker: 'Sent', employer: 'New', tone: 'info', icon: 'send' },
  screening: { seeker: 'Seen by employer', employer: 'Reviewing', tone: 'neutral', icon: 'eye' },
  interview: { seeker: 'Accepted', employer: 'Accepted', tone: 'success', icon: 'checkCircle' },
  offered: { seeker: 'Offer made', employer: 'Offer made', tone: 'success', icon: 'star' },
  hired: { seeker: 'Hired', employer: 'Hired', tone: 'success', icon: 'award' },
  rejected: { seeker: 'Not selected', employer: 'Rejected', tone: 'danger', icon: 'xCircle' },
  withdrawn: { seeker: 'Withdrawn', employer: 'Withdrawn', tone: 'muted', icon: 'undo' },
};

export const FINAL_STATUSES = new Set(['hired', 'rejected', 'withdrawn']);

export function labelFor(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}
