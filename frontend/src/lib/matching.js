// Suggests open roles from what the candidate told us. Deliberately simple and
// explainable: every suggestion comes with the reasons behind it.

import { EXPERIENCE_LEVELS, labelFor, ROLE_AREAS } from '../../shared/options.js';

const LEVELS = EXPERIENCE_LEVELS.map((level) => level.value);
const MIN_SCORE = 40;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Skill keywords found in the candidate's words, in the candidate's own spelling. */
function mentionedSkills(text, keywords) {
  const found = [];
  for (const keyword of keywords) {
    const match = text.match(new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escapeRegExp(keyword)})(?=$|[^\\p{L}\\p{N}])`, 'iu'));
    if (match && !found.some((skill) => skill.toLowerCase() === match[1].toLowerCase())) found.push(match[1]);
  }
  return found;
}

const listFormat = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

/**
 * Returns up to 3 { role, score, reasons } sorted best first.
 * `include` forces a role into the list (e.g. the one the candidate clicked "Apply" on).
 */
export function matchRoles(app, roles, { include } = {}) {
  const text = [app.role_detail, ...Object.values(app.role_answers)].filter(Boolean).join('\n');
  const level = LEVELS.indexOf(app.experience_level);

  const scored = roles.map((role) => {
    let score = 0;
    const reasons = [];
    if (app.target_role && role.area === app.target_role) {
      score += 50;
      reasons.push(`Matches your interest in ${labelFor(ROLE_AREAS, role.area)}`);
    }
    if (level >= 0) {
      const distance = Math.min(...role.levels.map((value) => Math.abs(LEVELS.indexOf(value) - level)));
      if (distance === 0) {
        score += 30;
        reasons.push('Right level for your experience');
      } else if (distance === 1) {
        score += 10;
        reasons.push('Close to your experience level');
      }
    }
    const skills = mentionedSkills(text, role.skills);
    if (skills.length) {
      score += Math.min(skills.length * 8, 24);
      reasons.push(`Uses ${listFormat.format(skills.slice(0, 3))}`);
    }
    return { role, score, reasons };
  });

  const matches = scored.filter((match) => match.score >= MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, 3);
  const forced = include && scored.find((match) => match.role.id === include);
  if (forced && !matches.includes(forced)) {
    if (!forced.reasons.length) forced.reasons.push('The role you chose');
    matches.unshift(forced);
    if (matches.length > 3) matches.pop();
  }
  return matches;
}
