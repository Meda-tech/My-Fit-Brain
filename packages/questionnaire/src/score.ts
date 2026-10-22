import { CRISIS_QUESTION_ID, ENGINE_VERSION, HOME_SAFETY_QUESTION_ID, YES } from './defaults';
import { visibleSections } from './flow';
import { scoreSection, valuedAnswer } from './measure';
import type { Answers, Definition, Note, PlanRow, Range, Result, SectionResult, ValuedAnswer } from './types';

// Scoring, fixed in code: higher value = more difficulty. Each answer with a value becomes a % of its own
// question's value range; a section's score is the average of those %. Fewer than half of the shown
// questions answered with a value → "Not enough answers". Range = first range whose up_to ≥ score.
// Main area = the scored section with the highest score (tie → first in order).

export { scoreSection, valuedAnswer, valueRange } from './measure';

export function rangeOf(ranges: Range[], score: number): { index: number; label: { en: string; hi?: string | null } } | null {
  const i = ranges.findIndex((r) => score <= r.up_to);
  if (i === -1) return null;
  return { index: i + 1, label: { en: ranges[i].en, hi: ranges[i].hi } };
}

export function planFor(plan: PlanRow[], rangeIndex: number | null): PlanRow | null {
  if (rangeIndex === null) return null;
  return plan.find((p) => p.range === rangeIndex) ?? null;
}

/** Scores a finished (or partly finished) questionnaire. `def` must include the safety section (withSafety). */
export function score(def: Definition, answers: Answers): Result {
  const visible = visibleSections(def, answers);

  const sections: SectionResult[] = def.sections.map((s) => {
    const v = visible.find((x) => x.section.id === s.id);
    const scored = s.scored && !s.builtin;
    if (!v) return { id: s.id, title: s.title, scored, shown: false, score: null, range: null, shownQuestions: 0, answered: 0, withValue: 0 };
    const sc = scoreSection({ ...s, scored }, v.questions, answers);
    return { id: s.id, title: s.title, scored, shown: true, ...sc, range: sc.score === null ? null : rangeOf(def.ranges, sc.score) };
  });

  let main: SectionResult | null = null;
  for (const s of sections) {
    if (s.score === null) continue;
    if (!main || s.score > (main.score as number)) main = s;
  }

  const notes: Note[] = [];
  const valued: ValuedAnswer[] = [];
  for (const { questions } of visible) {
    for (const q of questions) {
      const chosen = answers[q.id];
      if (!chosen?.length) continue;
      for (const o of q.options) if (o.note && chosen.includes(o.id)) notes.push({ questionId: q.id, optionId: o.id, note: o.note });
      const v = valuedAnswer(q, chosen);
      if (v) valued.push(v);
    }
  }
  valued.sort((a, b) => b.percent - a.percent);

  return {
    engineVersion: ENGINE_VERSION,
    sections,
    main: main?.id ?? null,
    plan: planFor(def.plan, main?.range?.index ?? null),
    crisis: answers[CRISIS_QUESTION_ID]?.includes(YES) ?? false,
    homeSafety: answers[HOME_SAFETY_QUESTION_ID]?.includes(YES) ?? false,
    notes,
    valued,
  };
}
