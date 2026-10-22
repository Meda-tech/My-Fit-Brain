import { pick } from './defaults';
import type { Definition, Lang, Rule } from './types';

// Plain-language descriptions for the admin: "Shown when Question 1.6 is 'I don't have a partner'".
// Numbers come from position (section.question); rules show option texts, never ids.

export function questionNumber(def: Definition, questionId: string): string | null {
  for (const [si, s] of def.sections.entries()) {
    const qi = s.questions.findIndex((q) => q.id === questionId);
    if (qi !== -1) return `${si + 1}.${qi + 1}`;
  }
  return null;
}

export function sectionNumber(def: Definition, sectionId: string): string | null {
  const i = def.sections.findIndex((s) => s.id === sectionId);
  return i === -1 ? null : String(i + 1);
}

function quoteList(items: string[]): string {
  const quoted = items.map((x) => `‘${x}’`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`;
}

/** "Question 1.6 is ‘…’" — one readable sentence for a rule. */
export function describeRule(def: Definition, rule: Rule, lang: Lang = 'en'): string {
  if ('all' in rule) return rule.all.length ? rule.all.map((r) => describeRule(def, r, lang)).join(' and ') : 'always';
  if ('any' in rule) return rule.any.length ? `(${rule.any.map((r) => describeRule(def, r, lang)).join(' or ')})` : 'never';
  if ('section' in rule) {
    const s = def.sections.find((x) => x.id === rule.section);
    const name = s ? `‘${pick(s.title, lang)}’` : `section “${rule.section}”`;
    return 'score_at_least' in rule ? `the score of ${name} is at least ${rule.score_at_least}%` : `the score of ${name} is at most ${rule.score_at_most}%`;
  }
  const q = def.sections.flatMap((s) => s.questions).find((x) => x.id === rule.question);
  const number = questionNumber(def, rule.question);
  const who = number ? `Question ${number}` : `question “${rule.question}”`;
  const ids = 'is' in rule ? rule.is : 'is_not' in rule ? rule.is_not : rule.includes;
  const texts = ids.map((id) => (q ? pick(q.options.find((o) => o.id === id)?.text, lang) || id : id));
  if ('is_not' in rule) return `${who} is not ${quoteList(texts)}`;
  if ('includes' in rule) return `${who} includes ${quoteList(texts)}`;
  return `${who} is ${quoteList(texts)}`;
}

/** "Shown when …" or "Always shown". */
export function describeShowWhen(def: Definition, rule: Rule | null, lang: Lang = 'en'): string {
  return rule ? `Shown when ${describeRule(def, rule, lang)}` : 'Always shown';
}
