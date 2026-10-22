import type { Answers, Option, Question, Section, SectionResult, ValuedAnswer } from './types';

// The arithmetic shared by the flow (section score rules) and the scorer. Higher value = more difficulty.

/** Lowest and highest option value of a question, or null when it cannot form a range. */
export function valueRange(q: Question): { min: number; max: number } | null {
  const values = q.options.map((o) => o.value).filter((v): v is number => v !== null);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max > min ? { min, max } : null;
}

/** The chosen option that carries the highest value, as a % of the question's range; null when none has a value. */
export function valuedAnswer(q: Question, chosen: string[] | undefined): ValuedAnswer | null {
  if (!chosen?.length) return null;
  const range = valueRange(q);
  if (!range) return null;
  let best: Option | null = null;
  for (const o of q.options) {
    if (o.value !== null && chosen.includes(o.id) && (best === null || o.value > (best.value as number))) best = o;
  }
  if (!best) return null;
  const value = best.value as number;
  return { questionId: q.id, optionId: best.id, value, percent: Math.round(((value - range.min) / (range.max - range.min)) * 100) };
}

/**
 * Section score = average of the answer percentages, rounded. Null when the section is not scored or
 * fewer than half of the shown questions were answered with a value ("Not enough answers").
 */
export function scoreSection(
  section: Section,
  shownQuestions: Question[],
  answers: Answers
): Pick<SectionResult, 'score' | 'shownQuestions' | 'answered' | 'withValue'> {
  const shown = shownQuestions.length;
  let answered = 0;
  const percents: number[] = [];
  for (const q of shownQuestions) {
    if (answers[q.id]?.length) answered += 1;
    const v = valuedAnswer(q, answers[q.id]);
    if (v) percents.push(v.percent);
  }
  const enough = shown > 0 && percents.length * 2 >= shown;
  const score = section.scored && enough ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null;
  return { score, shownQuestions: shown, answered, withValue: percents.length };
}
