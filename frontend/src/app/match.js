// How well a job fits a person: 0 to 5 leaflets on the frond, with the reasons spelled
// out. Deliberately simple and explainable. Used both ways round: jobs for a seeker, and
// applicants for an employer.

import { EXPERIENCE_LEVELS } from '../../shared/options.js';
import { areaLabel, skillList } from './format.js';

const LEVELS = EXPERIENCE_LEVELS.map((level) => level.value);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const MATCH_WORDS = ['Not a close match', 'A small match', 'Some match', 'Good match', 'Strong match', 'Excellent match'];

function mentions(text, skill) {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(skill)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

// The same reasons, worded for whoever is reading them.
const WORDING = {
  seeker: {
    area: (area) => `In your area, ${area}`,
    level: 'At your experience level',
    nearLevel: 'Close to your experience level',
    skills: (count, list) => `Uses ${count === 1 ? 'one' : count} of your skills: ${list}`,
  },
  employer: {
    area: (area) => `Wants to work in ${area}`,
    level: 'At a level you’re hiring for',
    nearLevel: 'Close to a level you’re hiring for',
    skills: (count, list) => `Has ${count === 1 ? 'one' : count} of the job’s skills: ${list}`,
  },
};

/**
 * person: a profile (or an applicant's snapshot). job: a job.
 * viewer: 'seeker' (reasons say "your skills") or 'employer' ("the job's skills").
 * Returns { leaves (0–5), label, reasons: string[], matchedSkills: string[] }, or null
 * when the profile is too empty to compare.
 */
export function matchJob(person, job, { viewer = 'seeker' } = {}) {
  const words = WORDING[viewer];
  if (!person) return null;
  const skills = new Set((person.skills ?? []).map((skill) => String(skill).toLowerCase()));
  // Skills count from the skills list and the headline only. Not the longer About text,
  // where people also write things like "learning React", and which the employer's
  // applicant list doesn't get, so both sides always see the same match.
  const text = person.headline ?? '';
  if (!skills.size && !text && !person.target_role && !person.experience_level) return null;

  const jobSkills = job.skills ?? [];
  const matchedSkills = jobSkills.filter((skill) => skills.has(skill) || (text && mentions(text, skill)));
  let points = 0;
  const reasons = [];

  if (person.target_role && person.target_role === job.area) {
    points += 1;
    reasons.push(words.area(areaLabel(job.area)));
  }
  const level = LEVELS.indexOf(person.experience_level);
  if (level >= 0 && job.levels?.length) {
    const distance = Math.min(...job.levels.map((value) => Math.abs(LEVELS.indexOf(value) - level)));
    if (distance === 0) {
      points += 1;
      reasons.push(words.level);
    } else if (distance === 1) {
      points += 0.5;
      reasons.push(words.nearLevel);
    }
  }
  if (jobSkills.length) {
    // Up to 3 leaflets for skills: matching about 5 of the job's skills fills all three.
    const wanted = Math.min(jobSkills.length, 5);
    points += Math.min(3, (3 * matchedSkills.length) / wanted);
    if (matchedSkills.length) {
      reasons.push(words.skills(matchedSkills.length, skillList(matchedSkills)));
    }
  }
  // A job outside your area with none of your skills isn't a match, whatever its level.
  const relevant = (person.target_role && person.target_role === job.area) || matchedSkills.length > 0;
  const leaves = relevant ? Math.max(1, Math.min(5, Math.round(points))) : 0;
  return { leaves, label: MATCH_WORDS[leaves], reasons: relevant ? reasons : [], matchedSkills };
}

/** Sorts jobs best match first (newest first among equals). */
export function rankJobs(person, jobs) {
  return jobs
    .map((job) => ({ job, match: matchJob(person, job) }))
    .sort((a, b) => (b.match?.leaves ?? 0) - (a.match?.leaves ?? 0) || b.job.created_at.localeCompare(a.job.created_at));
}
