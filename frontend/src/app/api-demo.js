// Demo mode: the whole marketplace API, running in the browser and saved in localStorage.
// It follows the same contract and rules as the real backend (/api/v2), so pages work the
// same either way. It's a stand-in until the backend is live, and a backup for demos.
// Data never leaves this browser.

import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, FINAL_STATUSES, PAY_PERIODS, ROLE_AREAS, WORK_MODES } from '../../shared/options.js';
import seed from '../../shared/demo-data.json';
import { ApiError } from './errors.js';

const DB_KEY = 'fernway-demo-db-v1';
const SESSION_KEY = 'fernway-demo-session';
const DAY = 86_400_000;
const HOUR = 3_600_000;

// Same hiring stages and moves as the backend (app/service.py).
const TRANSITIONS = {
  new_applicants: ['screening', 'rejected', 'withdrawn'],
  screening: ['interview', 'rejected', 'withdrawn'],
  interview: ['offered', 'rejected', 'withdrawn'],
  offered: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};
const PATH_TO = {
  new_applicants: [],
  screening: ['screening'],
  interview: ['screening', 'interview'],
  offered: ['screening', 'interview', 'offered'],
  hired: ['screening', 'interview', 'offered', 'hired'],
  rejected: ['rejected'],
  withdrawn: ['withdrawn'],
};

const AREAS = ROLE_AREAS.map((option) => option.value);
const LEVELS = EXPERIENCE_LEVELS.map((option) => option.value);
const TYPES = EMPLOYMENT_TYPES.map((option) => option.value);
const MODES = WORK_MODES.map((option) => option.value);
const PERIODS = PAY_PERIODS.map((option) => option.value);

const PROFILE_FIELDS = [
  'phone',
  'location',
  'timezone',
  'headline',
  'about',
  'skills',
  'target_role',
  'role_detail',
  'experience_level',
  'experience_years',
  'portfolio_url',
  'resume_url',
  'availability',
  'compensation_amount',
  'compensation_currency',
  'compensation_period',
  'compensation_expectations',
];

const newId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const nowIso = () => new Date().toISOString();
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const wait = () => new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 180));

// --- Storage ----------------------------------------------------------------------------

let db = load();

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DB_KEY));
    if (parsed?.version === 1) return parsed;
  } catch {
    // Unreadable or blocked storage: start fresh below.
  }
  const fresh = seedDb();
  persist(fresh);
  return fresh;
}

function persist(data = db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  } catch {
    // Private windows can refuse storage; the demo still works until the page closes.
  }
}

// Another tab changed the demo data (for example, the employer tab accepted an application).
// Pages listen for "fernway:data-changed" to refresh, so the bell lights up straight away.
window.addEventListener('storage', (event) => {
  if (event.key !== DB_KEY) return;
  db = load();
  window.dispatchEvent(new Event('fernway:data-changed'));
});

// The data is shared by every tab of this browser (localStorage), but each tab has its own
// sign-in (sessionStorage). So a job seeker can use one window and an employer another,
// and each sees what the other does.
let memorySession = null;
function sessionUserId() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return memorySession;
  }
}
function setSession(userId) {
  memorySession = userId;
  try {
    if (userId) sessionStorage.setItem(SESSION_KEY, userId);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Memory only.
  }
}

// --- Seed -------------------------------------------------------------------------------

function seedDb() {
  const now = Date.now();
  const ago = (days, hours = 0) => new Date(now - days * DAY - hours * HOUR).toISOString();
  const data = { version: 1, users: [], employers: [], jobs: [], profiles: {}, applications: [], notifications: [] };

  for (const employer of seed.employers) {
    const userId = `user-${employer.id}`;
    data.users.push({ id: userId, email: employer.owner.email, role: 'employer', full_name: employer.owner.full_name, demo: true, created_at: ago(40) });
    data.employers.push({ id: employer.id, owner_user_id: userId, name: employer.name, website: employer.website, about: employer.about, location: employer.location });
  }
  for (const { posted_days_ago: days, ...job } of seed.jobs) {
    data.jobs.push({ ...job, status: 'open', created_at: ago(days), updated_at: ago(days) });
  }
  for (const seeker of seed.seekers) {
    const userId = `user-${seeker.email.split('@')[0].replace(/[^a-z0-9]+/gi, '-')}`;
    data.users.push({ id: userId, email: seeker.email, role: 'seeker', full_name: seeker.full_name, demo: true, created_at: ago(30) });
    data.profiles[userId] = { ...emptyProfile(), ...seeker.profile, updated_at: ago(12) };
  }
  for (const entry of seed.applications) {
    const seeker = data.users.find((user) => user.email === entry.seeker_email);
    const job = data.jobs.find((candidate) => candidate.id === entry.job_id);
    if (!seeker || !job) continue;
    const employer = data.employers.find((candidate) => candidate.id === job.employer_id);
    const created = ago(entry.applied_days_ago);
    const application = {
      id: newId(),
      job_id: job.id,
      seeker_user_id: seeker.id,
      status: 'new_applicants',
      version: 1,
      cover_note: entry.cover_note,
      employer_message: entry.employer_message,
      snapshot: snapshotOf(seeker, data.profiles[seeker.id]),
      history: [{ status: 'new_applicants', at: created, actor: 'seeker', reason: null }],
      created_at: created,
      updated_at: created,
    };
    PATH_TO[entry.status].forEach((status, index) => {
      const at = ago(entry.applied_days_ago, -(index + 1) * 5);
      application.history.push({ status, at, actor: 'employer', reason: status === 'rejected' ? entry.employer_message : null });
      application.status = status;
      application.version += 1;
      application.updated_at = at;
    });
    data.applications.push(application);
    data.notifications.push({
      id: newId(),
      user_id: employer.owner_user_id,
      type: 'application_received',
      title: `New application for ${job.title}`,
      body: `${seeker.full_name} applied.`,
      application_id: application.id,
      job_id: job.id,
      created_at: created,
      read_at: entry.status === 'new_applicants' ? null : created,
    });
    if (entry.status === 'interview') {
      data.notifications.push({
        id: newId(),
        user_id: seeker.id,
        type: 'application_accepted',
        title: `${employer.name} accepted your application`,
        body: entry.employer_message ?? `For ${job.title}. They’ll contact you about next steps.`,
        application_id: application.id,
        job_id: job.id,
        created_at: application.updated_at,
        read_at: null,
      });
    }
  }
  return data;
}

function emptyProfile() {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field, field === 'skills' ? [] : null]));
}

function snapshotOf(user, profile) {
  return { full_name: user.full_name, email: user.email, ...clone(profile ?? emptyProfile()) };
}

// --- Shapes returned to pages (the same as the real API) --------------------------------

function userOut(user) {
  const company = user.role === 'employer' ? db.employers.find((employer) => employer.owner_user_id === user.id) : null;
  return { id: user.id, email: user.email, role: user.role, full_name: user.full_name, company: company ? { id: company.id, name: company.name } : null };
}

function employerOf(job) {
  return db.employers.find((employer) => employer.id === job.employer_id);
}

function jobOut(job, { full = false } = {}) {
  const employer = employerOf(job);
  const employerOut = full
    ? { id: employer.id, name: employer.name, website: employer.website, about: employer.about, location: employer.location }
    : { id: employer.id, name: employer.name };
  return { ...clone(job), employer: employerOut };
}

function applicationForSeeker(application) {
  const job = db.jobs.find((candidate) => candidate.id === application.job_id);
  const employer = employerOf(job);
  return {
    id: application.id,
    status: application.status,
    version: application.version,
    created_at: application.created_at,
    updated_at: application.updated_at,
    cover_note: application.cover_note,
    employer_message: application.employer_message,
    job: { id: job.id, title: job.title, employer: { id: employer.id, name: employer.name } },
  };
}

function applicationSummaryForEmployer(application) {
  const { snapshot } = application;
  return {
    id: application.id,
    status: application.status,
    version: application.version,
    created_at: application.created_at,
    candidate: {
      full_name: snapshot.full_name,
      headline: snapshot.headline,
      target_role: snapshot.target_role,
      experience_level: snapshot.experience_level,
      experience_years: snapshot.experience_years,
      skills: snapshot.skills ?? [],
    },
  };
}

function applicationDetailForEmployer(application) {
  const job = db.jobs.find((candidate) => candidate.id === application.job_id);
  return {
    ...applicationSummaryForEmployer(application),
    updated_at: application.updated_at,
    cover_note: application.cover_note,
    employer_message: application.employer_message,
    candidate: clone(application.snapshot),
    history: clone(application.history),
    job: jobOut(job),
  };
}

// --- Guards and validation --------------------------------------------------------------

function currentUser() {
  const userId = sessionUserId();
  return userId ? db.users.find((user) => user.id === userId) ?? null : null;
}

function requireUser(role) {
  const user = currentUser();
  if (!user) throw new ApiError(401, 'Please sign in first.');
  if (role && user.role !== role) throw new ApiError(403, role === 'employer' ? 'Only employer accounts can do that.' : 'Only job seeker accounts can do that.');
  return user;
}

function requireEmployer() {
  const user = requireUser('employer');
  return { user, employer: db.employers.find((employer) => employer.owner_user_id === user.id) };
}

function ownApplication(employer, applicationId) {
  const application = db.applications.find((candidate) => candidate.id === applicationId);
  const job = application && db.jobs.find((candidate) => candidate.id === application.job_id);
  if (!application || job.employer_id !== employer.id) throw new ApiError(404, 'We couldn’t find that application.');
  return { application, job };
}

class Fields {
  constructor() {
    this.errors = [];
  }
  add(field, message) {
    this.errors.push({ field, message });
  }
  throwIfAny() {
    if (this.errors.length) throw new ApiError(422, 'Some details need fixing.', { fields: this.errors });
  }
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const optionalText = (value) => text(value) || null;

function checkHttps(fields, field, value) {
  const url = optionalText(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.')) throw new Error('bad');
    return parsed.toString();
  } catch {
    fields.add(field, 'Use a full link that starts with https://');
    return null;
  }
}

function cleanSkills(fields, values) {
  const list = Array.isArray(values) ? values : [];
  const skills = [...new Set(list.map((skill) => text(skill).toLowerCase()).filter(Boolean))];
  if (skills.length > 30) fields.add('skills', 'Add up to 30 skills.');
  if (skills.some((skill) => skill.length > 40)) fields.add('skills', 'Keep each skill under 40 characters.');
  return skills.slice(0, 30);
}

function cleanProfile(input) {
  const fields = new Fields();
  const profile = emptyProfile();
  for (const field of ['phone', 'location', 'timezone', 'headline', 'role_detail', 'availability', 'compensation_expectations']) profile[field] = optionalText(input[field]);
  profile.about = optionalText(input.about);
  if (profile.headline && profile.headline.length > 120) fields.add('headline', 'Keep your headline under 120 characters.');
  if (profile.about && profile.about.length > 4000) fields.add('about', 'Keep this under 4,000 characters.');
  profile.skills = cleanSkills(fields, input.skills);
  profile.target_role = AREAS.includes(input.target_role) ? input.target_role : null;
  profile.experience_level = LEVELS.includes(input.experience_level) ? input.experience_level : null;
  if (input.experience_years !== '' && input.experience_years != null) {
    const years = Number(input.experience_years);
    if (!Number.isFinite(years) || years < 0 || years > 80) fields.add('experience_years', 'Enter a number of years between 0 and 80.');
    else profile.experience_years = Math.round(years * 10) / 10;
  }
  profile.portfolio_url = checkHttps(fields, 'portfolio_url', input.portfolio_url);
  profile.resume_url = checkHttps(fields, 'resume_url', input.resume_url);
  if (input.compensation_amount !== '' && input.compensation_amount != null) {
    const amount = Number(input.compensation_amount);
    if (!Number.isFinite(amount) || amount < 0) fields.add('compensation_amount', 'Enter a positive amount.');
    profile.compensation_amount = amount;
    profile.compensation_currency = /^[A-Z]{3}$/.test(input.compensation_currency ?? '') ? input.compensation_currency : null;
    profile.compensation_period = PERIODS.includes(input.compensation_period) ? input.compensation_period : null;
    if (!profile.compensation_currency || !profile.compensation_period) fields.add('compensation_amount', 'Choose a currency and a period for the amount.');
  }
  fields.throwIfAny();
  return profile;
}

function cleanJob(input) {
  const fields = new Fields();
  const job = {
    title: text(input.title),
    area: input.area,
    levels: Array.isArray(input.levels) ? input.levels.filter((level) => LEVELS.includes(level)) : [],
    employment_type: input.employment_type,
    work_mode: input.work_mode,
    location: text(input.location),
    summary: text(input.summary),
    description: text(input.description),
    status: input.status === 'closed' ? 'closed' : 'open',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
  };
  if (job.title.length < 3 || job.title.length > 120) fields.add('title', 'Use a job title of 3 to 120 characters.');
  if (!AREAS.includes(job.area)) fields.add('area', 'Choose an area.');
  if (!job.levels.length) fields.add('levels', 'Choose at least one experience level.');
  if (!TYPES.includes(job.employment_type)) fields.add('employment_type', 'Choose a job type.');
  if (!MODES.includes(job.work_mode)) fields.add('work_mode', 'Choose where people work.');
  if (!job.location) fields.add('location', 'Add a location, such as Chiang Mai or Remote (Thailand).');
  if (job.location.length > 120) fields.add('location', 'Keep the location under 120 characters.');
  if (!job.summary) fields.add('summary', 'Add a one-sentence summary.');
  if (job.summary.length > 300) fields.add('summary', 'Keep the summary under 300 characters.');
  if (!job.description) fields.add('description', 'Describe the job.');
  if (job.description.length > 8000) fields.add('description', 'Keep the description under 8,000 characters.');
  job.skills = cleanSkills(fields, input.skills);
  const hasSalary = input.salary_min !== '' && input.salary_min != null;
  if (hasSalary) {
    const min = Number(input.salary_min);
    const max = input.salary_max === '' || input.salary_max == null ? min : Number(input.salary_max);
    if (!Number.isFinite(min) || min < 0) fields.add('salary_min', 'Enter a positive amount.');
    else if (!Number.isFinite(max) || max < min) fields.add('salary_max', 'The maximum can’t be lower than the minimum.');
    if (!/^[A-Z]{3}$/.test(input.salary_currency ?? '')) fields.add('salary_currency', 'Choose a currency.');
    if (!PERIODS.includes(input.salary_period)) fields.add('salary_period', 'Choose a pay period.');
    Object.assign(job, { salary_min: min, salary_max: max, salary_currency: input.salary_currency, salary_period: input.salary_period });
  }
  fields.throwIfAny();
  return job;
}

// --- Passwords (demo only: hashed so nothing readable sits in localStorage) -------------

async function hashPassword(password, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// --- Notifications and status changes ---------------------------------------------------

function notify(userId, type, title, body, application) {
  db.notifications.push({
    id: newId(),
    user_id: userId,
    type,
    title,
    body,
    application_id: application.id,
    job_id: application.job_id,
    created_at: nowIso(),
    read_at: null,
  });
}

function move(application, status, actor, reason = null) {
  if (!TRANSITIONS[application.status].includes(status)) throw new ApiError(409, 'This application can’t move to that stage any more.');
  const at = nowIso();
  application.history.push({ status, at, actor, reason });
  application.status = status;
  application.version += 1;
  application.updated_at = at;
}

function checkVersion(application, expected) {
  if (expected != null && Number(expected) !== application.version) {
    throw new ApiError(409, 'This application changed in the meantime. Reload the page to see the latest version.');
  }
}

// --- The API ----------------------------------------------------------------------------

export function createApi() {
  const call =
    (fn) =>
    async (...args) => {
      await wait();
      const result = await fn(...args);
      persist();
      return clone(result);
    };

  return {
    mode: 'demo',

    auth: {
      me: call(() => userOut(requireUser())),
      register: call(async (input) => {
        const fields = new Fields();
        const email = text(input.email).toLowerCase();
        const fullName = text(input.full_name);
        if (!['seeker', 'employer'].includes(input.role)) fields.add('role', 'Choose job seeker or employer.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fields.add('email', 'Enter an email address like name@example.com.');
        if (!fullName) fields.add('full_name', 'Enter your name.');
        if (typeof input.password !== 'string' || input.password.length < 8) fields.add('password', 'Use at least 8 characters.');
        if (input.role === 'employer' && !text(input.company_name)) fields.add('company_name', 'Enter your company’s name.');
        fields.throwIfAny();
        if (db.users.some((user) => user.email === email)) throw new ApiError(409, 'An account with this email already exists. Sign in instead.', { fields: [{ field: 'email', message: 'An account with this email already exists.' }] });
        const salt = newId();
        const user = { id: newId(), email, role: input.role, full_name: fullName, salt, password_hash: await hashPassword(input.password, salt), created_at: nowIso() };
        db.users.push(user);
        if (user.role === 'employer') {
          db.employers.push({ id: newId(), owner_user_id: user.id, name: text(input.company_name), website: null, about: null, location: null });
        } else {
          db.profiles[user.id] = { ...emptyProfile(), updated_at: null };
        }
        setSession(user.id);
        return userOut(user);
      }),
      login: call(async (input) => {
        const email = text(input.email).toLowerCase();
        const user = db.users.find((candidate) => candidate.email === email);
        const valid = user?.password_hash && (await hashPassword(String(input.password ?? ''), user.salt)) === user.password_hash;
        if (!valid) throw new ApiError(401, 'Wrong email or password.');
        setSession(user.id);
        return userOut(user);
      }),
      logout: call(() => {
        setSession(null);
        return null;
      }),
      /** Demo accounts that sign in with one click (they have no password). */
      demoAccounts: call(() => db.users.filter((user) => user.demo).map(userOut)),
      demoSignIn: call((userId) => {
        const user = db.users.find((candidate) => candidate.id === userId && candidate.demo);
        if (!user) throw new ApiError(404, 'That demo account doesn’t exist any more. Reset the demo data and try again.');
        setSession(user.id);
        return userOut(user);
      }),
    },

    jobs: {
      list: call((params = {}) => {
        const q = text(params.q).toLowerCase();
        let jobs = db.jobs.filter((job) => job.status === 'open');
        if (params.area) jobs = jobs.filter((job) => job.area === params.area);
        if (params.level) jobs = jobs.filter((job) => job.levels.includes(params.level));
        if (params.work_mode) jobs = jobs.filter((job) => job.work_mode === params.work_mode);
        if (params.employment_type) jobs = jobs.filter((job) => job.employment_type === params.employment_type);
        if (q) {
          jobs = jobs.filter((job) =>
            [job.title, job.summary, job.location, employerOf(job).name, ...job.skills].some((value) => value?.toLowerCase().includes(q)),
          );
        }
        jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
        const offset = Number(params.offset) || 0;
        const limit = Math.min(Number(params.limit) || 50, 100);
        return { items: jobs.slice(offset, offset + limit).map((job) => jobOut(job)), total: jobs.length };
      }),
      get: call((jobId) => {
        const job = db.jobs.find((candidate) => candidate.id === jobId);
        const user = currentUser();
        const ownEmployer = user?.role === 'employer' && db.employers.find((employer) => employer.owner_user_id === user.id)?.id === job?.employer_id;
        if (!job || (job.status !== 'open' && !ownEmployer)) throw new ApiError(404, 'This job isn’t available any more.');
        return jobOut(job, { full: true });
      }),
      apply: call((jobId, input = {}) => {
        const user = requireUser('seeker');
        const job = db.jobs.find((candidate) => candidate.id === jobId);
        if (!job) throw new ApiError(404, 'This job isn’t available any more.');
        if (job.status !== 'open') throw new ApiError(409, 'This job has closed and isn’t taking applications.', { code: 'job_closed' });
        if (input.consent_to_process !== true) throw new ApiError(422, 'Some details need fixing.', { fields: [{ field: 'consent_to_process', message: 'Tick the box to agree before applying.' }] });
        const coverNote = optionalText(input.cover_note);
        if (coverNote && coverNote.length > 2000) throw new ApiError(422, 'Some details need fixing.', { fields: [{ field: 'cover_note', message: 'Keep your note under 2,000 characters.' }] });
        const profile = db.profiles[user.id];
        if (!profile || (!profile.skills?.length && !profile.about)) throw new ApiError(422, 'Add your skills or a short summary to your profile before applying.', { code: 'profile_incomplete' });
        if (db.applications.some((application) => application.job_id === jobId && application.seeker_user_id === user.id)) {
          throw new ApiError(409, 'You’ve already applied to this job.', { code: 'already_applied' });
        }
        const created = nowIso();
        const application = {
          id: newId(),
          job_id: job.id,
          seeker_user_id: user.id,
          status: 'new_applicants',
          version: 1,
          cover_note: coverNote,
          employer_message: null,
          snapshot: snapshotOf(user, profile),
          history: [{ status: 'new_applicants', at: created, actor: 'seeker', reason: null }],
          created_at: created,
          updated_at: created,
        };
        db.applications.push(application);
        const employer = employerOf(job);
        notify(employer.owner_user_id, 'application_received', `New application for ${job.title}`, `${user.full_name} applied.`, application);
        return applicationForSeeker(application);
      }),
    },

    me: {
      getProfile: call(() => {
        const user = requireUser('seeker');
        return db.profiles[user.id] ?? emptyProfile();
      }),
      saveProfile: call((input = {}) => {
        const user = requireUser('seeker');
        const profile = cleanProfile(input);
        db.profiles[user.id] = { ...profile, updated_at: nowIso() };
        if (text(input.full_name)) user.full_name = text(input.full_name);
        return db.profiles[user.id];
      }),
      applications: call(() => {
        const user = requireUser('seeker');
        return db.applications
          .filter((application) => application.seeker_user_id === user.id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map(applicationForSeeker);
      }),
      withdraw: call((applicationId, reason) => {
        const user = requireUser('seeker');
        const application = db.applications.find((candidate) => candidate.id === applicationId && candidate.seeker_user_id === user.id);
        if (!application) throw new ApiError(404, 'We couldn’t find that application.');
        if (FINAL_STATUSES.has(application.status)) throw new ApiError(409, 'This application is already closed.');
        move(application, 'withdrawn', 'seeker', optionalText(reason) ?? 'Withdrawn by candidate');
        const job = db.jobs.find((candidate) => candidate.id === application.job_id);
        notify(employerOf(job).owner_user_id, 'application_withdrawn', `${user.full_name} withdrew their application`, `For ${job.title}.`, application);
        return applicationForSeeker(application);
      }),
    },

    employer: {
      getCompany: call(() => {
        const { employer } = requireEmployer();
        return { id: employer.id, name: employer.name, website: employer.website, about: employer.about, location: employer.location };
      }),
      saveCompany: call((input = {}) => {
        const { employer } = requireEmployer();
        const fields = new Fields();
        const name = text(input.name);
        if (!name) fields.add('name', 'Enter your company’s name.');
        const website = checkHttps(fields, 'website', input.website);
        fields.throwIfAny();
        Object.assign(employer, { name, website, about: optionalText(input.about), location: optionalText(input.location) });
        return { id: employer.id, name: employer.name, website: employer.website, about: employer.about, location: employer.location };
      }),
      jobs: call(() => {
        const { employer } = requireEmployer();
        return db.jobs
          .filter((job) => job.employer_id === employer.id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((job) => {
            const counts = Object.fromEntries(Object.keys(TRANSITIONS).map((status) => [status, 0]));
            for (const application of db.applications) if (application.job_id === job.id) counts[application.status] += 1;
            return { ...jobOut(job), counts };
          });
      }),
      createJob: call((input = {}) => {
        const { employer } = requireEmployer();
        const job = { id: newId(), employer_id: employer.id, ...cleanJob(input), created_at: nowIso(), updated_at: nowIso() };
        db.jobs.push(job);
        return jobOut(job, { full: true });
      }),
      updateJob: call((jobId, input = {}) => {
        const { employer } = requireEmployer();
        const job = db.jobs.find((candidate) => candidate.id === jobId && candidate.employer_id === employer.id);
        if (!job) throw new ApiError(404, 'We couldn’t find that job.');
        Object.assign(job, cleanJob(input), { updated_at: nowIso() });
        return jobOut(job, { full: true });
      }),
      applications: call((jobId, params = {}) => {
        const { employer } = requireEmployer();
        const job = db.jobs.find((candidate) => candidate.id === jobId && candidate.employer_id === employer.id);
        if (!job) throw new ApiError(404, 'We couldn’t find that job.');
        return db.applications
          .filter((application) => application.job_id === jobId && (!params.status || application.status === params.status))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map(applicationSummaryForEmployer);
      }),
      application: call((applicationId) => {
        const { employer, user } = requireEmployer();
        const { application } = ownApplication(employer, applicationId);
        // Opening a new application marks it as seen (no notification for this).
        if (application.status === 'new_applicants') move(application, 'screening', `employer:${user.id}`);
        return applicationDetailForEmployer(application);
      }),
      decide: call((applicationId, input = {}) => {
        const { employer, user } = requireEmployer();
        const { application, job } = ownApplication(employer, applicationId);
        checkVersion(application, input.expected_version);
        const message = optionalText(input.message);
        if (message && message.length > 1000) throw new ApiError(422, 'Some details need fixing.', { fields: [{ field: 'message', message: 'Keep your message under 1,000 characters.' }] });
        const seekerId = application.seeker_user_id;
        if (input.decision === 'accept') {
          if (application.status === 'new_applicants') move(application, 'screening', `employer:${user.id}`);
          move(application, 'interview', `employer:${user.id}`, message);
          application.employer_message = message;
          notify(seekerId, 'application_accepted', `${employer.name} accepted your application`, message ?? `For ${job.title}. They’ll contact you about next steps.`, application);
        } else if (input.decision === 'reject') {
          move(application, 'rejected', `employer:${user.id}`, message ?? 'Not selected');
          application.employer_message = message;
          notify(seekerId, 'application_rejected', `Update on your application for ${job.title}`, message ?? `${employer.name} decided not to move forward this time.`, application);
        } else {
          throw new ApiError(422, 'Choose accept or reject.');
        }
        return applicationDetailForEmployer(application);
      }),
      stage: call((applicationId, input = {}) => {
        const { employer, user } = requireEmployer();
        const { application, job } = ownApplication(employer, applicationId);
        checkVersion(application, input.expected_version);
        if (!['offered', 'hired'].includes(input.status)) throw new ApiError(422, 'Choose offer made or hired.');
        move(application, input.status, `employer:${user.id}`);
        const title = input.status === 'offered' ? `${employer.name} made you an offer` : `You’re hired at ${employer.name}`;
        notify(application.seeker_user_id, `application_${input.status}`, title, `For ${job.title}.`, application);
        return applicationDetailForEmployer(application);
      }),
    },

    notifications: {
      list: call((params = {}) => {
        const user = requireUser();
        const mine = db.notifications.filter((item) => item.user_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
        return { unread: mine.filter((item) => !item.read_at).length, items: mine.slice(0, Number(params.limit) || 20) };
      }),
      markRead: call((input = {}) => {
        const user = requireUser();
        const ids = new Set(input.ids ?? []);
        const at = nowIso();
        for (const item of db.notifications) {
          if (item.user_id === user.id && !item.read_at && (input.all || ids.has(item.id))) item.read_at = at;
        }
        return null;
      }),
    },

    demo: {
      /** Puts the demo back to its starting data and signs out. */
      reset() {
        db = seedDb();
        persist();
        setSession(null);
      },
    },
  };
}
