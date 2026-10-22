import { SAFETY_SECTION } from './defaults';
import { evalRule } from './rules';
import { scoreSection } from './measure';
import type { Answers, Definition, Question, Section } from './types';

// The flow: sections in order, questions in order, each shown when its rule is true (or has none). Section
// score rules read the scores of sections already shown. The built-in safety section is always last.

/** The definition with the safety section added at the end. Every engine call expects this form. */
export function withSafety(def: Definition): Definition {
  if (def.sections.some((s) => s.id === SAFETY_SECTION.id)) return def;
  return { ...def, sections: [...def.sections, SAFETY_SECTION] };
}

export interface VisibleSection {
  section: Section;
  questions: Question[];
}

export function visibleSections(def: Definition, answers: Answers): VisibleSection[] {
  const scores = new Map<string, number | null>();
  const ctx = { answers, sectionScore: (id: string) => scores.get(id) ?? null };
  const out: VisibleSection[] = [];
  for (const section of def.sections) {
    if (section.show_when && !evalRule(section.show_when, ctx)) continue;
    const questions = section.questions.filter((q) => !q.show_when || evalRule(q.show_when, ctx));
    out.push({ section, questions });
    scores.set(section.id, section.scored ? scoreSection(section, questions, answers).score : null);
  }
  return out;
}

export function visibleQuestions(def: Definition, answers: Answers): Question[] {
  return visibleSections(def, answers).flatMap((v) => v.questions);
}

export interface NextStep {
  section: Section;
  question: Question;
  /** 1-based position among the visible questions, and how many there are right now. */
  position: number;
  total: number;
}

/** The first visible question without an answer, or null when every visible question is answered. */
export function nextQuestion(def: Definition, answers: Answers): NextStep | null {
  const visible = visibleSections(def, answers);
  const total = visible.reduce((n, v) => n + v.questions.length, 0);
  let position = 0;
  for (const { section, questions } of visible) {
    for (const question of questions) {
      position += 1;
      if (!answers[question.id]?.length) return { section, question, position, total };
    }
  }
  return null;
}

/** The visible question with this id, with its position, or null when it is not shown. */
export function findQuestion(def: Definition, answers: Answers, questionId: string): NextStep | null {
  let position = 0;
  for (const { section, questions } of visibleSections(def, answers)) {
    for (const question of questions) {
      position += 1;
      if (question.id === questionId) return { section, question, position, total: visibleQuestions(def, answers).length };
    }
  }
  return null;
}

/** Checks one answer against the question as shown; returns the cleaned option ids or a message. */
export function checkAnswer(question: Question, chosen: unknown): { ok: true; chosen: string[] } | { ok: false; message: string } {
  const list = Array.isArray(chosen) ? chosen : typeof chosen === 'string' ? [chosen] : null;
  if (!list || list.some((c) => typeof c !== 'string')) return { ok: false, message: 'Choose from the list.' };
  const ids = [...new Set(list as string[])];
  if (ids.length === 0) return { ok: false, message: 'Choose an option.' };
  if (ids.some((id) => !question.options.some((o) => o.id === id))) return { ok: false, message: 'That option is not available.' };
  if (!question.multiple && ids.length > 1) return { ok: false, message: 'Choose one option.' };
  const max = question.max_choices ?? question.options.length;
  if (question.multiple && ids.length > max) return { ok: false, message: `Choose up to ${max}.` };
  // Keep the questionnaire's option order so stored answers read the same everywhere.
  return { ok: true, chosen: question.options.filter((o) => ids.includes(o.id)).map((o) => o.id) };
}

/**
 * Drops answers to questions that are no longer shown (a routing answer changed) and option ids that
 * no longer exist. Runs until nothing changes, because hiding one question can hide others.
 */
export function prune(def: Definition, answers: Answers): Answers {
  let current = { ...answers };
  for (let i = 0; i < 20; i += 1) {
    const shown = new Map(visibleQuestions(def, current).map((q) => [q.id, q]));
    const next: Answers = {};
    for (const [qid, chosen] of Object.entries(current)) {
      const q = shown.get(qid);
      if (!q) continue;
      const kept = chosen.filter((id) => q.options.some((o) => o.id === id));
      if (kept.length) next[qid] = q.multiple ? kept : [kept[0]];
    }
    if (Object.keys(next).length === Object.keys(current).length) return next;
    current = next;
  }
  return current;
}
