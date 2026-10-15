import type { VersionConfig } from '@mfb/questionbank';
import { InvalidAnswerError } from './errors';
import { analyse, type Facts } from './facts';
import type { Answers, EngineContext, FiredFlag, FlowItem } from './types';

// The question flow while a client answers: which question is next, what to drop when an earlier
// answer changes, and which flags must interrupt immediately.

/** Facts for these answers. `partial` (default): unanswered questions are unknown, not "no". */
export function buildFacts(config: VersionConfig, context: EngineContext, answers: Answers, partial = true): Facts {
  return analyse(config, context, answers, { complete: !partial }).facts;
}

/** Visible questions in order, each with its visible options in display order. Throws on invalid answers. */
export function getFlow(config: VersionConfig, context: EngineContext, answers: Answers): FlowItem[] {
  const a = analyse(config, context, answers);
  if (a.issues.length) throw new InvalidAnswerError(a.issues);
  return a.flow;
}

/** The next unanswered visible question, or null when every visible question is answered. */
export function nextQuestion(config: VersionConfig, context: EngineContext, answers: Answers): FlowItem | null {
  return getFlow(config, context, answers).find((item) => !item.answered) ?? null;
}

/**
 * Removes answers to questions that are no longer visible (e.g. the path or the gate changed), and
 * choices that are no longer offered. Repeats until stable, because removing one answer can hide
 * further questions.
 */
export function pruneAnswers(
  config: VersionConfig,
  context: EngineContext,
  answers: Answers
): { answers: Answers; removed: string[] } {
  let current: Answers = { ...answers };
  const removed = new Set<string>();
  for (let round = 0; round <= config.questions.length; round++) {
    const { flow } = analyse(config, context, current);
    const visible = new Map(flow.map((f) => [f.qid, f]));
    const next: Answers = {};
    let changed = false;
    for (const [qid, value] of Object.entries(current)) {
      const item = visible.get(qid);
      if (!item) {
        removed.add(qid);
        changed = true;
        continue;
      }
      if (Array.isArray(value)) {
        const offered = new Set(item.options.map((o) => o.code));
        const kept = value.filter((code) => offered.has(code));
        if (kept.length !== value.length) {
          removed.add(qid);
          changed = true;
          if (kept.length === 0) continue;
          next[qid] = kept;
          continue;
        }
      }
      next[qid] = value;
    }
    current = next;
    if (!changed) break;
  }
  return { answers: current, removed: [...removed].sort() };
}

/**
 * Flags with an `interrupt` or `stop` effect that have fired with the answers so far (e.g. the
 * support screen, the age stop). Safe to call after every answer; never throws on invalid answers.
 */
export function checkInterrupts(config: VersionConfig, context: EngineContext, answers: Answers): FiredFlag[] {
  const { facts } = analyse(config, context, answers);
  return config.flags
    .filter((f) => (f.effects.interrupt || f.effects.stop) && facts.flags.get(f.key) === true)
    .map((f) => ({ key: f.key, effects: f.effects }));
}
