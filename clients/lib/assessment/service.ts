import 'server-only';
import {
  CLIENT_DETAILS_TITLE,
  CRISIS_QUESTION_ID,
  DETAIL_MAX_LENGTH,
  HOME_SAFETY_QUESTION_ID,
  SUPPORT_SCREEN,
  YES,
  buildReport,
  checkAnswer,
  checkDetailAnswer,
  findQuestion,
  nextQuestion,
  parseClientDetails,
  parseDefinition,
  prune,
  score,
  visibleQuestions,
  withSafety,
  type Answers,
  type ClientDetail,
  type Definition,
  type Lang,
  type NextStep,
} from '@mfb/questionnaire';
import type { AttemptStore } from './store';
import { AssessmentError, type At, type AttemptRow, type ClientProfile, type Interrupt, type QuestionView, type Step } from './types';

// The client assessment flow. Every call loads the attempt, checks it belongs to the client and uses the
// attempt's pinned version. Every answer is saved at once; the server decides the next question. After
// the safety questions come the client-details questions (typed answers), read from the questionnaire's
// current list, not from the version, so the admin can change them at any time.

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

/** The current client-details list. A list that cannot be read is skipped, never blocking the assessment. */
async function loadDetails(deps: ServiceDeps, code: string): Promise<ClientDetail[]> {
  const parsed = parseClientDetails(await deps.store.clientDetails(code));
  return parsed.ok ? parsed.details : [];
}

/** Everything the flow needs: the pinned version, the answers, the client-details list and typed answers. */
interface Progress {
  def: Definition;
  answers: Answers;
  details: ClientDetail[];
  typed: Record<string, string>;
}

async function progress(deps: ServiceDeps, attempt: AttemptRow): Promise<Progress> {
  const [def, answers, details, typed] = await Promise.all([
    loadDefinition(deps, attempt.version_id),
    deps.store.getAnswers(attempt.id),
    loadDetails(deps, attempt.questionnaire_code),
    deps.store.getDetails(attempt.id),
  ]);
  return { def, answers, details, typed };
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

/** The current step for the assessment screen. `at` reopens an earlier question after Back. */
export async function openRunner(deps: ServiceDeps, client: ClientProfile, attemptId: string, at: At = null): Promise<Step> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status === 'completed') return { kind: 'completed' };
  if (!attempt.consent_at || attempt.status !== 'in_progress') return { kind: 'consent' };
  return stepFor(await progress(deps, attempt), at);
}

/**
 * The step to show: the question asked for (when it is shown), else the first unanswered question, then
 * the first unanswered client-details question, then finish. Client details open only after every
 * question (safety included) is answered.
 */
function stepFor(p: Progress, at: At): Step {
  const questions = visibleQuestions(p.def, p.answers);
  const total = questions.length + p.details.length;
  const open = nextQuestion(p.def, p.answers);
  if (at?.kind === 'question') {
    const shown = findQuestion(p.def, p.answers, at.id);
    if (shown) return { kind: 'question', question: view(shown, p.answers, total) };
  }
  if (open) return { kind: 'question', question: view(open, p.answers, total) };
  const asked = at?.kind === 'detail' ? p.details.findIndex((d) => d.id === at.id) : -1;
  const index = asked >= 0 ? asked : p.details.findIndex((d) => !p.typed[d.id]);
  if (index >= 0) {
    const d = p.details[index];
    return {
      kind: 'detail',
      detail: {
        id: d.id,
        text: d.text,
        sectionTitle: CLIENT_DETAILS_TITLE,
        saved: p.typed[d.id] ?? null,
        maxLength: DETAIL_MAX_LENGTH,
        position: questions.length + index + 1,
        total,
        canGoBack: true,
      },
    };
  }
  return { kind: 'finish', answered: total, total };
}

function view(step: NextStep, answers: Answers, total: number): QuestionView {
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
    total,
    canGoBack: step.position > 1,
  };
}

async function openForAnswers(deps: ServiceDeps, client: ClientProfile, attemptId: string): Promise<Progress & { attempt: AttemptRow }> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status !== 'in_progress') throw new AssessmentError('WRONG_STATUS', 'This assessment is not open for answers.');
  return { attempt, ...(await progress(deps, attempt)) };
}

export interface AnswerResult {
  step: Step;
  interrupt: Interrupt | null;
}

/** One answer: checked against the question as shown, saved at once, then the next step. */
export async function answer(deps: ServiceDeps, client: ClientProfile, attemptId: string, questionId: string, chosen: unknown): Promise<AnswerResult> {
  const { attempt, ...p } = await openForAnswers(deps, client, attemptId);
  const { def, answers } = p;
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
  return { step: stepFor({ ...p, answers: kept }, null), interrupt };
}

/** One typed client-details answer: required, saved at once with the question as it was asked. */
export async function answerDetail(deps: ServiceDeps, client: ClientProfile, attemptId: string, detailId: string, text: unknown): Promise<AnswerResult> {
  const { attempt, ...p } = await openForAnswers(deps, client, attemptId);
  const index = p.details.findIndex((d) => d.id === detailId);
  if (index === -1 || nextQuestion(p.def, p.answers)) throw new AssessmentError('NOT_VISIBLE', 'That question is not part of your assessment right now.');
  const checked = checkDetailAnswer(text);
  if (!checked.ok) throw new AssessmentError('INVALID_ANSWER', checked.message);
  await deps.store.saveDetail(attempt.id, { detail_id: detailId, question: p.details[index].text, answer: checked.answer, sort: index });
  return { step: stepFor({ ...p, typed: { ...p.typed, [detailId]: checked.answer } }, null), interrupt: null };
}

/** The step before `from` (from the finish screen when null). No write. */
export async function back(deps: ServiceDeps, client: ClientProfile, attemptId: string, from: At): Promise<Step> {
  const p = await openForAnswers(deps, client, attemptId);
  const shown = visibleQuestions(p.def, p.answers);
  const lastQuestion: At = shown.length ? { kind: 'question', id: shown[shown.length - 1].id } : null;
  if (from?.kind === 'detail') {
    const i = p.details.findIndex((d) => d.id === from.id);
    return stepFor(p, i > 0 ? { kind: 'detail', id: p.details[i - 1].id } : lastQuestion);
  }
  if (!from && p.details.length && !nextQuestion(p.def, p.answers)) {
    return stepFor(p, { kind: 'detail', id: p.details[p.details.length - 1].id });
  }
  const at = from ? shown.findIndex((q) => q.id === from.id) : shown.length;
  const target = shown[Math.max(0, (at === -1 ? shown.length : at) - 1)];
  return stepFor(p, target ? { kind: 'question', id: target.id } : null);
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
  const { def, answers, details, typed } = await progress(deps, attempt);
  if (nextQuestion(def, answers) || details.some((d) => !typed[d.id])) throw new AssessmentError('INCOMPLETE', 'Some questions are still unanswered.');

  const completedAt = deps.now().toISOString();
  const result = score(def, answers);
  const report = buildReport(def, result, { lang: language, clientName: client.full_name, reportId: attempt.report_id, completedAt });
  await deps.store.insertResult(attempt.id, result, report, result.engineVersion);
  await deps.store.updateAttempt(attempt.id, { language, status: 'completed', completed_at: completedAt });
  return { status: 'completed' };
}
