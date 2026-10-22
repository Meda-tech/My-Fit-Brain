import 'server-only';
import {
  CRISIS_QUESTION_ID,
  HOME_SAFETY_QUESTION_ID,
  SUPPORT_SCREEN,
  YES,
  buildReport,
  checkAnswer,
  findQuestion,
  nextQuestion,
  parseDefinition,
  prune,
  score,
  visibleQuestions,
  withSafety,
  type Answers,
  type Definition,
  type Lang,
  type NextStep,
} from '@mfb/questionnaire';
import type { AttemptStore } from './store';
import { AssessmentError, type AttemptRow, type ClientProfile, type Interrupt, type QuestionView, type Step } from './types';

// The client assessment flow. Every call loads the attempt, checks it belongs to the client and uses the
// attempt's pinned version. Every answer is saved at once; the server decides the next question.

export interface ServiceDeps {
  store: AttemptStore;
  now(): Date;
}

// Parsed definitions per version (versions never change once an attempt points at them).
const definitions = new Map<string, Definition>();

async function loadDefinition(deps: ServiceDeps, versionId: string): Promise<Definition> {
  const hit = definitions.get(versionId);
  if (hit) return hit;
  const raw = await deps.store.versionDefinition(versionId);
  if (raw === null) throw new AssessmentError('NOT_FOUND', 'The questionnaire version was not found.');
  const parsed = parseDefinition(raw);
  if (!parsed.ok) throw new AssessmentError('BAD_DEFINITION', 'The questionnaire could not be read.');
  const def = withSafety(parsed.definition);
  definitions.set(versionId, def);
  return def;
}

async function ownAttempt(deps: ServiceDeps, client: ClientProfile, attemptId: string): Promise<AttemptRow> {
  const attempt = await deps.store.getAttempt(attemptId);
  // Not found and not yours look the same: never reveal another client's attempt.
  if (!attempt || attempt.client_id !== client.id) throw new AssessmentError('NOT_FOUND', 'Assessment not found.');
  return attempt;
}

// ---------------------------------------------------------------------------------------------
// Purchase and consent

/** A verified payment: the gateway's payment ID and when it was paid. */
export interface PaidWith {
  ref: string;
  paidAt: string;
}

/**
 * Creates the attempt for a verified payment, pinned to the live version, with its report ID. Called
 * only by the payment service after the payment is confirmed. One payment gives one attempt; calling again
 * (or at the same time) returns the same attempt and never uses up a report number.
 */
export async function createPaidAttempt(
  deps: ServiceDeps,
  client: ClientProfile,
  code: string,
  paid: PaidWith,
  language: Lang = 'en'
): Promise<AttemptRow> {
  const live = await deps.store.liveVersion(code);
  if (!live) throw new AssessmentError('NO_LIVE_VERSION', 'This assessment is not available right now.');
  const { attempt } = await deps.store.createPaidAttempt({
    client_id: client.id,
    questionnaire_code: code,
    version_id: live.id,
    payment_ref: paid.ref,
    paid_at: paid.paidAt,
    language,
  });
  return attempt;
}

export async function giveConsent(deps: ServiceDeps, client: ClientProfile, attemptId: string): Promise<AttemptRow> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status === 'in_progress') return attempt;
  if (attempt.status !== 'paid') throw new AssessmentError('WRONG_STATUS', 'This assessment cannot start.');
  const now = deps.now().toISOString();
  return deps.store.updateAttempt(attempt.id, { status: 'in_progress', consent_at: now, started_at: now });
}

// ---------------------------------------------------------------------------------------------
// Questions

/** The current step for the assessment screen. `atQuestionId` reopens an earlier question after Back. */
export async function openRunner(deps: ServiceDeps, client: ClientProfile, attemptId: string, atQuestionId?: string | null): Promise<Step> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status === 'completed') return { kind: 'completed' };
  if (!attempt.consent_at || attempt.status !== 'in_progress') return { kind: 'consent' };
  const def = await loadDefinition(deps, attempt.version_id);
  const answers = await deps.store.getAnswers(attempt.id);
  return stepFor(def, answers, atQuestionId ?? null);
}

function stepFor(def: Definition, answers: Answers, atQuestionId: string | null): Step {
  const shown = (atQuestionId ? findQuestion(def, answers, atQuestionId) : null) ?? nextQuestion(def, answers);
  if (!shown) {
    const total = visibleQuestions(def, answers).length;
    return { kind: 'finish', answered: total, total };
  }
  return { kind: 'question', question: view(shown, answers) };
}

function view(step: NextStep, answers: Answers): QuestionView {
  const q = step.question;
  return {
    id: q.id,
    text: q.text,
    sectionTitle: step.section.title,
    multiple: q.multiple,
    maxChoices: q.multiple ? (q.max_choices ?? null) : null,
    options: q.options.map((o) => ({ id: o.id, text: o.text, skip: o.value === null && q.options.some((x) => x.value !== null) })),
    saved: answers[q.id] ?? null,
    position: step.position,
    total: step.total,
    canGoBack: step.position > 1,
  };
}

async function openForAnswers(deps: ServiceDeps, client: ClientProfile, attemptId: string) {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status !== 'in_progress') throw new AssessmentError('WRONG_STATUS', 'This assessment is not open for answers.');
  const def = await loadDefinition(deps, attempt.version_id);
  const answers = await deps.store.getAnswers(attempt.id);
  return { attempt, def, answers };
}

export interface AnswerResult {
  step: Step;
  interrupt: Interrupt | null;
}

/** One answer: checked against the question as shown, saved at once, then the next step. */
export async function answer(deps: ServiceDeps, client: ClientProfile, attemptId: string, questionId: string, chosen: unknown): Promise<AnswerResult> {
  const { attempt, def, answers } = await openForAnswers(deps, client, attemptId);
  const shown = findQuestion(def, answers, questionId);
  if (!shown) throw new AssessmentError('NOT_VISIBLE', 'That question is not part of your assessment right now.');
  const checked = checkAnswer(shown.question, chosen);
  if (!checked.ok) throw new AssessmentError('INVALID_ANSWER', checked.message);

  // Changing a routing answer removes answers to questions that are no longer shown.
  const kept = prune(def, { ...answers, [questionId]: checked.chosen });
  await deps.store.replaceAnswers(attempt.id, kept);

  let interrupt: Interrupt | null = null;
  if (questionId === CRISIS_QUESTION_ID && checked.chosen.includes(YES)) {
    await deps.store.insertAlert(attempt.id, 'crisis');
    interrupt = { text: SUPPORT_SCREEN };
  }
  if (questionId === HOME_SAFETY_QUESTION_ID && checked.chosen.includes(YES)) {
    await deps.store.insertAlert(attempt.id, 'home_safety');
  }
  return { step: stepFor(def, kept, null), interrupt };
}

/** The question before `fromQuestionId` (or the last one when null). No write. */
export async function back(deps: ServiceDeps, client: ClientProfile, attemptId: string, fromQuestionId: string | null): Promise<Step> {
  const { def, answers } = await openForAnswers(deps, client, attemptId);
  const shown = visibleQuestions(def, answers);
  const from = fromQuestionId ? shown.findIndex((q) => q.id === fromQuestionId) : shown.length;
  const target = shown[Math.max(0, (from === -1 ? shown.length : from) - 1)];
  return target ? stepFor(def, answers, target.id) : stepFor(def, answers, null);
}

// ---------------------------------------------------------------------------------------------
// Submit

/**
 * Scores the attempt with its pinned version, builds the report in the client's language and stores
 * both once. Safe to call again.
 */
export async function submit(deps: ServiceDeps, client: ClientProfile, attemptId: string, language: Lang): Promise<{ status: 'completed' }> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status === 'completed') return { status: 'completed' };
  if (await deps.store.getResult(attempt.id)) {
    await deps.store.updateAttempt(attempt.id, { status: 'completed', completed_at: deps.now().toISOString() });
    return { status: 'completed' };
  }
  if (attempt.status !== 'in_progress') throw new AssessmentError('WRONG_STATUS', 'This assessment cannot be submitted yet.');
  const def = await loadDefinition(deps, attempt.version_id);
  const answers = await deps.store.getAnswers(attempt.id);
  if (nextQuestion(def, answers)) throw new AssessmentError('INCOMPLETE', 'Some questions are still unanswered.');

  const completedAt = deps.now().toISOString();
  const result = score(def, answers);
  const report = buildReport(def, result, { lang: language, clientName: client.full_name, reportId: attempt.report_id, completedAt });
  await deps.store.insertResult(attempt.id, result, report, result.engineVersion);
  await deps.store.updateAttempt(attempt.id, { language, status: 'completed', completed_at: completedAt });
  return { status: 'completed' };
}
