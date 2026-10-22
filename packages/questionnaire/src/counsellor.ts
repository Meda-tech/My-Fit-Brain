import { HOME_SAFETY_NUMBERS, pick } from './defaults';
import { visibleSections } from './flow';
import { questionNumber } from './describe';
import type { Answers, Definition, Result, Text } from './types';

// Data for the counsellor view in the admin (staff only, never shown to clients). Pure: built from the
// pinned definition, the stored answers and the stored result, so it reads the same every time.

export interface CounsellorView {
  alerts: { kind: 'crisis' | 'home_safety'; title: string; detail: string }[];
  notes: { question: string; number: string | null; answer: string; note: string }[];
  main: { title: string; score: number | null; range: string | null } | null;
  plan: { name: string; sessions: number; pace: string } | null;
  sections: { id: string; title: string; scored: boolean; score: number | null; range: string | null; answered: number; skipped: number; shownQuestions: number }[];
  notable: { number: string | null; question: string; answer: string; value: number; percent: number }[];
  answers: { section: string; items: { number: string | null; question: string; answer: string; skipped: boolean }[] }[];
}

export function counsellorView(def: Definition, answers: Answers, result: Result | null): CounsellorView {
  const en = (t: Text | null | undefined) => pick(t, 'en');
  const visible = visibleSections(def, answers);
  const questionOf = (id: string) => def.sections.flatMap((s) => s.questions).find((q) => q.id === id);
  const answerText = (qid: string) => {
    const q = questionOf(qid);
    const chosen = answers[qid] ?? [];
    return chosen.map((id) => en(q?.options.find((o) => o.id === id)?.text) || id).join(', ');
  };

  const alerts: CounsellorView['alerts'] = [];
  if (result?.crisis) {
    alerts.push({ kind: 'crisis', title: 'Crisis: thoughts of self-harm', detail: 'The support screen was shown. Call the client within 4 working hours (after 8 PM: by 10 AM next day). Tele-MANAS 14416 / 1-800-891-4416.' });
  }
  if (result?.homeSafety) {
    alerts.push({ kind: 'home_safety', title: 'Home safety: feels unsafe at home', detail: `Individual sessions only. Discuss safe next steps privately. Emergency: ${HOME_SAFETY_NUMBERS.join(', ')}.` });
  }

  const mainResult = result?.main ? result.sections.find((s) => s.id === result.main) : null;

  return {
    alerts,
    notes: (result?.notes ?? []).map((n) => ({
      question: en(questionOf(n.questionId)?.text),
      number: questionNumber(def, n.questionId),
      answer: en(questionOf(n.questionId)?.options.find((o) => o.id === n.optionId)?.text),
      note: n.note,
    })),
    main: mainResult ? { title: en(mainResult.title), score: mainResult.score, range: mainResult.range ? en(mainResult.range.label) : null } : null,
    plan: result?.plan ? { name: en(result.plan.name), sessions: result.plan.sessions, pace: en(result.plan.pace) } : null,
    sections: (result?.sections ?? [])
      .filter((s) => s.shown && !def.sections.find((d) => d.id === s.id)?.builtin)
      .map((s) => ({
        id: s.id,
        title: en(s.title),
        scored: s.scored,
        score: s.score,
        range: s.range ? en(s.range.label) : null,
        answered: s.answered,
        skipped: s.answered - s.withValue,
        shownQuestions: s.shownQuestions,
      })),
    notable: (result?.valued ?? []).map((v) => ({
      number: questionNumber(def, v.questionId),
      question: en(questionOf(v.questionId)?.text),
      answer: en(questionOf(v.questionId)?.options.find((o) => o.id === v.optionId)?.text),
      value: v.value,
      percent: v.percent,
    })),
    answers: visible.map(({ section, questions }) => ({
      section: en(section.title),
      items: questions.map((q) => {
        const chosen = answers[q.id] ?? [];
        const skipped = chosen.length > 0 && chosen.every((id) => q.options.find((o) => o.id === id)?.value === null);
        return { number: questionNumber(def, q.id), question: en(q.text), answer: chosen.length ? answerText(q.id) : '—', skipped };
      }),
    })),
  };
}
