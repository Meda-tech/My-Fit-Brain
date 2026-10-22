import type { Answers, Rule } from './types';

// Rules decide what opens what. Every rule is true or false, never "unknown": an unanswered question or
// a section without a score counts as false, so a rule can never block the flow.

export interface RuleContext {
  answers: Answers;
  /** The score of a section shown so far, or null (hidden, later, unscored, not enough answers). */
  sectionScore(sectionId: string): number | null;
}

export function evalRule(rule: Rule, ctx: RuleContext): boolean {
  if ('all' in rule) return rule.all.every((r) => evalRule(r, ctx));
  if ('any' in rule) return rule.any.some((r) => evalRule(r, ctx));
  if ('section' in rule) {
    const score = ctx.sectionScore(rule.section);
    if (score === null) return false;
    return 'score_at_least' in rule ? score >= rule.score_at_least : score <= rule.score_at_most;
  }
  const chosen = ctx.answers[rule.question];
  if (!chosen || chosen.length === 0) return false;
  if ('is_not' in rule) return chosen.every((id) => !rule.is_not.includes(id));
  const wanted = 'is' in rule ? rule.is : rule.includes;
  return chosen.some((id) => wanted.includes(id));
}

/** Question ids a rule reads. */
export function questionsRead(rule: Rule): string[] {
  if ('all' in rule) return rule.all.flatMap(questionsRead);
  if ('any' in rule) return rule.any.flatMap(questionsRead);
  return 'question' in rule ? [rule.question] : [];
}

/** Section ids a rule reads. */
export function sectionsRead(rule: Rule): string[] {
  if ('all' in rule) return rule.all.flatMap(sectionsRead);
  if ('any' in rule) return rule.any.flatMap(sectionsRead);
  return 'section' in rule ? [rule.section] : [];
}
