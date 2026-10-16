import 'server-only';
import {
  AssessmentStoppedError,
  IncompleteAssessmentError,
  buildFacts,
  getFlow,
  nextQuestion,
  pruneAnswers,
  score,
  type Answers,
  type EngineContext,
  type FlowItem,
  type Sex,
} from '@mfb/engine';
import type { VersionConfig } from '@mfb/questionbank';
import { RELATIONSHIP_STATUSES } from '../options';
import { buildReportDocument } from './report-document';
import type { AttemptStore } from './store';
import {
  AssessmentError,
  type AnswerRow,
  type AnswerValue,
  type AttemptRow,
  type ClientProfile,
  type EventRow,
  type Interrupt,
  type LocalPair,
  type QuestionView,
  type ReportLanguageChoice,
  type Step,
} from './types';

// The client assessment flow. Every call loads the attempt, checks it belongs to the client and uses
// the attempt's pinned version. All rules come from the version through @mfb/engine.

export interface ServiceDeps {
  store: AttemptStore;
  loadConfig(versionId: string): Promise<VersionConfig>;
  now(): Date;
}

const SEXES: readonly Sex[] = ['Male', 'Female', 'Prefer not to say'];

function contextFor(client: ClientProfile): EngineContext {
  if (!SEXES.includes(client.gender as Sex)) throw new AssessmentError('BAD_PROFILE', 'The profile has no valid gender.');
  return { sex: client.gender as Sex, age: client.age, mode: 'initial' };
}

async function ownAttempt(deps: ServiceDeps, client: ClientProfile, attemptId: string): Promise<AttemptRow> {
  const attempt = await deps.store.getAttempt(attemptId);
  // Not found and not yours look the same: never reveal another client's attempt.
  if (!attempt || attempt.client_id !== client.id) throw new AssessmentError('NOT_FOUND', 'Assessment not found.');
  return attempt;
}

function toAnswers(rows: AnswerRow[]): Answers {
  return Object.fromEntries(rows.map((r) => [r.qid, r.value]));
}

const pair = (en: string | null | undefined, hi: string | null | undefined): LocalPair => ({ en: en ?? null, hi: hi ?? null });

function flagText(config: VersionConfig, key: string): LocalPair | null {
  const t = config.texts.find((x) => x.key === key);
  return t ? pair(t.text_en, t.text_hi) : null;
}

/** Questions the client answers: not filled from registration and not from the profile. */
function clientItems(flow: FlowItem[], rows: AnswerRow[]): FlowItem[] {
  const profile = new Set(rows.filter((r) => r.source === 'profile').map((r) => r.qid));
  return flow.filter((f) => !f.prefilled && !profile.has(f.qid));
}

// ---------------------------------------------------------------------------------------------
// Purchase, language, consent

/** A verified payment: the gateway's payment ID and when it was paid. */
export interface PaidWith {
  ref: string;
  paidAt: string;
}

/**
 * Creates the attempt for a verified payment, pinned to the version live at that moment, with its
 * report ID (CLAUDE.md: ID assigned on payment success). Called only by the payment service after the
 * payment is confirmed with the gateway. One payment gives one attempt; calling again (or at the same
 * time) returns the same attempt and never uses up a report number.
 */
export async function createPaidAttempt(deps: ServiceDeps, client: ClientProfile, testCode: string, paid: PaidWith): Promise<AttemptRow> {
  const ctx = contextFor(client);
  const versionId = await deps.store.liveVersionId(testCode);
  if (!versionId) throw new AssessmentError('NO_LIVE_VERSION', 'This assessment is not available right now.');
  // Atomic: returns the existing attempt for this payment, or takes the report number and inserts.
  const { attempt: created, created: isNew } = await deps.store.createPaidAttempt({
    client_id: client.id,
    test_code: testCode,
    version_id: versionId,
    payment_ref: paid.ref,
    paid_at: paid.paidAt,
  });
  if (!isNew) return created;

  const config = await deps.loadConfig(versionId);
  const attempt = await applyReportLanguage(deps, config, created.id, DEFAULT_REPORT_LANGUAGE);
  const prefill = profileAnswers(config, client);
  if (prefill.length) await deps.store.upsertAnswers(attempt.id, prefill);
  const stopped = await stopIfNeeded(deps, config, attempt, ctx, toAnswers(prefill));
  if (stopped) return stopped;
  // Flags raised by registration answers alone are recorded now; answering records only new ones.
  const raised = firedFlags(config, ctx, toAnswers(prefill));
  await Promise.all(raised.map((f) => deps.store.insertEvent(eventFor(attempt.id, f))));
  return attempt;
}

/**
 * Answers known from the profile, matched to the version's own questions and options:
 * gender → the registration sex question, exact age → the registration age-band question, and the
 * relationship status → the intake question whose options are exactly the registration list.
 */
export function profileAnswers(config: VersionConfig, client: ClientProfile): AnswerRow[] {
  const reg = config.scoring.registration;
  const rows: AnswerRow[] = [];
  const sex = reg.sex_options[client.gender];
  if (sex) rows.push({ qid: reg.sex_qid, value: sex, source: 'profile' });
  const band = reg.age_bands.find((b) => (b.min === null || client.age >= b.min) && (b.max === null || client.age <= b.max));
  if (band) rows.push({ qid: reg.age_band_qid, value: band.option_code, source: 'profile' });

  const intake = new Set(config.modules.filter((m) => m.kind === 'intake').map((m) => m.code));
  const wanted = [...RELATIONSHIP_STATUSES].sort().join('|');
  const relationship = config.questions.find(
    (q) => intake.has(q.module_code) && q.type === 'single' && q.options.map((o) => o.label_en).sort().join('|') === wanted
  );
  const option = relationship?.options.find((o) => o.label_en === client.marital_status);
  if (relationship && option) rows.push({ qid: relationship.qid, value: option.option_code, source: 'profile' });
  return rows;
}

/**
 * Reports are read only by counsellors and super admins, in English, so the report-language question
 * is never asked: it is answered English here, from the profile side (decision D21).
 */
export const DEFAULT_REPORT_LANGUAGE: ReportLanguageChoice = 'en';

export async function setLanguage(deps: ServiceDeps, client: ClientProfile, attemptId: string, lang: ReportLanguageChoice) {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status !== 'paid' && attempt.status !== 'in_progress') {
    throw new AssessmentError('WRONG_STATUS', 'The report language can no longer change.');
  }
  const config = await deps.loadConfig(attempt.version_id);
  return applyReportLanguage(deps, config, attempt.id, lang);
}

/** The report-language question answered for a language choice, from the version's own map. */
function languageRow(config: VersionConfig, lang: ReportLanguageChoice): AnswerRow | null {
  const rl = config.report_rules.report_language;
  const wanted = lang === 'both' ? 'en|hi' : lang;
  const code = Object.entries(rl.map).find(([, langs]) => [...langs].sort().join('|') === wanted)?.[0];
  return code ? { qid: rl.qid, value: code, source: 'profile' } : null;
}

async function applyReportLanguage(deps: ServiceDeps, config: VersionConfig, attemptId: string, lang: ReportLanguageChoice) {
  const row = languageRow(config, lang);
  if (row) await deps.store.upsertAnswers(attemptId, [row]);
  return deps.store.updateAttempt(attemptId, { report_language: lang });
}

export async function giveConsent(deps: ServiceDeps, client: ClientProfile, attemptId: string) {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status === 'in_progress') return attempt;
  if (attempt.status !== 'paid') throw new AssessmentError('WRONG_STATUS', 'This assessment cannot start.');
  // Attempts paid before D21 may have no report language yet.
  if (!attempt.report_language) {
    await applyReportLanguage(deps, await deps.loadConfig(attempt.version_id), attempt.id, DEFAULT_REPORT_LANGUAGE);
  }
  const now = deps.now().toISOString();
  return deps.store.updateAttempt(attempt.id, { status: 'in_progress', consent_at: now, started_at: now });
}

// ---------------------------------------------------------------------------------------------
// Questions
//
// Answers are buffered in the browser and saved in batches. Every call sends the client's answers so
// far (the "draft"); the server checks the whole draft against the pinned version, works out the next
// step with the engine, and writes to the database only when asked to (every few answers, when the tab
// is hidden), when an answer raises a flag (crisis, safety, stop) and when the last question is answered.
// Answers from registration and the report language are never in the draft: the server adds them.

export async function getStep(deps: ServiceDeps, client: ClientProfile, attemptId: string, atQid?: string | null): Promise<Step> {
  return (await openRunner(deps, client, attemptId, atQid)).step;
}

/** The current step and the client's saved answers, for opening the assessment screen. */
export async function openRunner(
  deps: ServiceDeps,
  client: ClientProfile,
  attemptId: string,
  atQid?: string | null
): Promise<{ step: Step; answers: Answers }> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status === 'completed') return { step: { kind: 'completed' }, answers: {} };
  const config = await deps.loadConfig(attempt.version_id);
  if (attempt.status === 'stopped') {
    const stop = config.flags.find((f) => f.effects.stop);
    return { step: { kind: 'stopped', text: stop ? flagText(config, stop.key) : null }, answers: {} };
  }
  if (!attempt.consent_at) return { step: { kind: 'consent' }, answers: {} };

  const rows = await deps.store.getAnswers(attempt.id);
  return { step: stepFor(config, contextFor(client), rows, atQid ?? null), answers: clientAnswers(rows) };
}

function stepFor(config: VersionConfig, ctx: EngineContext, rows: AnswerRow[], atQid: string | null): Step {
  const answers = toAnswers(rows);
  const flow = getFlow(config, ctx, answers);
  const items = clientItems(flow, rows);
  const next = nextQuestion(config, ctx, answers);
  const shown = (atQid && items.find((i) => i.qid === atQid)) || (next && items.find((i) => i.qid === next.qid)) || null;
  if (!shown) {
    return { kind: 'finish', answered: items.filter((i) => i.answered).length, total: items.length };
  }
  return { kind: 'question', question: view(shown, items, answers) };
}

function view(item: FlowItem, items: FlowItem[], answers: Answers): QuestionView {
  const index = items.findIndex((i) => i.qid === item.qid);
  const multi = item.type === 'multi';
  return {
    qid: item.qid,
    type: item.type,
    text_en: item.text_en,
    text_hi: item.text_hi,
    options: item.options.map((o) => ({ code: o.code, label_en: o.label_en, label_hi: o.label_hi, exclusive: o.exclusive })),
    ...(multi ? { minChoices: item.minChoices ?? 1, maxChoices: item.maxChoices ?? item.options.length } : {}),
    saved: answers[item.qid] ?? null,
    position: index + 1,
    total: items.length,
    canGoBack: index > 0,
  };
}

/** Checks a value against the question as the client sees it (shape, offered options, choices, exclusivity). */
function checkValue(item: FlowItem, value: AnswerValue) {
  const fail = (message: string) => {
    throw new AssessmentError('INVALID_ANSWER', message);
  };
  const offered = new Map(item.options.map((o) => [o.code, o]));
  if (item.type === 'multi') {
    if (!Array.isArray(value)) fail('Choose from the list.');
    const codes = value as string[];
    if (new Set(codes).size !== codes.length) fail('The same option was chosen twice.');
    if (codes.some((c) => !offered.has(c))) fail('That option is not available.');
    const min = item.minChoices ?? 1;
    const max = item.maxChoices ?? item.options.length;
    if (codes.length < min || codes.length > max) fail(`Choose ${min === max ? min : `${min} to ${max}`}.`);
    if (codes.length > 1 && codes.some((c) => offered.get(c)?.exclusive)) fail('That option cannot be combined with others.');
  } else {
    if (typeof value !== 'string') fail('Choose one option.');
    if (!offered.has(value as string)) fail('That option is not available.');
  }
}

/** Answers the server adds itself: registration answers and the report language (D21). */
function fixedAnswers(config: VersionConfig, client: ClientProfile, attempt: AttemptRow): AnswerRow[] {
  const rows = profileAnswers(config, client);
  const lang = attempt.report_language ? languageRow(config, attempt.report_language) : null;
  if (lang && !rows.some((r) => r.qid === lang.qid)) rows.push(lang);
  return rows;
}

function clientAnswers(rows: AnswerRow[]): Answers {
  return toAnswers(rows.filter((r) => r.source === 'client'));
}

/**
 * The full answer set from a draft sent by the browser. Every draft answer must be a question the
 * client is shown, with a valid value; otherwise the draft is stale or altered and is rejected (the
 * screen then reloads from the saved answers).
 */
function resolveDraft(config: VersionConfig, ctx: EngineContext, fixed: AnswerRow[], draft: unknown): AnswerRow[] {
  const stale = () => new AssessmentError('STALE', 'Your answers are out of date.');
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw stale();
  const fixedQids = new Set(fixed.map((r) => r.qid));
  const rows: AnswerRow[] = [...fixed];
  for (const [qid, value] of Object.entries(draft as Record<string, unknown>)) {
    if (fixedQids.has(qid)) continue;
    if (typeof value !== 'string' && !(Array.isArray(value) && value.every((v) => typeof v === 'string'))) throw stale();
    rows.push({ qid, value: value as AnswerValue, source: 'client' });
  }
  let items: FlowItem[];
  try {
    items = clientItems(getFlow(config, ctx, toAnswers(rows)), rows);
  } catch {
    throw stale();
  }
  const shown = new Map(items.map((i) => [i.qid, i]));
  for (const r of rows) {
    if (r.source !== 'client') continue;
    const item = shown.get(r.qid);
    if (!item) throw stale();
    try {
      checkValue(item, r.value);
    } catch {
      throw stale();
    }
  }
  return rows;
}

async function openDraft(deps: ServiceDeps, client: ClientProfile, attemptId: string, draft: unknown) {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status !== 'in_progress') throw new AssessmentError('WRONG_STATUS', 'This assessment is not open for answers.');
  const config = await deps.loadConfig(attempt.version_id);
  const ctx = contextFor(client);
  const rows = resolveDraft(config, ctx, fixedAnswers(config, client, attempt), draft);
  return { attempt, config, ctx, rows };
}

export interface AnswerResult {
  step: Step;
  interrupt: Interrupt | null;
  /** The client's answers after this one (hidden paths removed); the browser keeps these. */
  answers: Answers;
  /** True when this call saved the answers to the database. */
  saved: boolean;
}

/** One answer. Saves when `flush` is set, when a flag is newly raised or when the last question is answered. */
export async function answer(
  deps: ServiceDeps,
  client: ClientProfile,
  attemptId: string,
  draft: unknown,
  qid: string,
  value: AnswerValue,
  opts: { flush?: boolean } = {}
): Promise<AnswerResult> {
  const { attempt, config, ctx, rows } = await openDraft(deps, client, attemptId, draft);
  const answers = toAnswers(rows);

  const item = clientItems(getFlow(config, ctx, answers), rows).find((i) => i.qid === qid);
  if (!item) throw new AssessmentError('NOT_VISIBLE', 'That question is not part of your assessment right now.');
  checkValue(item, value);

  const before = firedFlags(config, ctx, answers);
  // Changing a routing answer removes answers that are no longer shown and trims choices that are no
  // longer offered (e.g. a gate option hidden on the new path).
  const { answers: kept } = pruneAnswers(config, ctx, { ...answers, [qid]: value });
  getFlow(config, ctx, kept); // the engine re-checks every answer
  const sourceOf = new Map(rows.map((r) => [r.qid, r.source]));
  const keptRows: AnswerRow[] = Object.entries(kept).map(([q, v]) => ({
    qid: q,
    value: v,
    source: q === qid ? 'client' : sourceOf.get(q) ?? 'client',
  }));

  const stopped = await stopIfNeeded(deps, config, attempt, ctx, kept);
  if (stopped) return { step: await getStep(deps, client, attempt.id), interrupt: null, answers: {}, saved: true };

  // A newly raised flag is recorded once (also enforced by the table) and saves the answers at once.
  const raised = firedFlags(config, ctx, kept).filter((f) => !before.some((b) => b.key === f.key));
  const step = stepFor(config, ctx, keptRows, null);
  const save = !!opts.flush || raised.length > 0 || step.kind === 'finish';
  await Promise.all([
    save ? deps.store.replaceAnswers(attempt.id, keptRows) : null,
    ...raised.map((f) => deps.store.insertEvent(eventFor(attempt.id, f))),
  ]);
  const shown = raised.find((f) => f.effects.interrupt);
  const interrupt: Interrupt | null = shown ? { flag: shown.key, text: flagText(config, shown.key) } : null;
  return { step, interrupt, answers: clientAnswers(keptRows), saved: save };
}

/** The question before `fromQid` (or the last one when null), from the draft. No database write. */
export async function back(
  deps: ServiceDeps,
  client: ClientProfile,
  attemptId: string,
  draft: unknown,
  fromQid: string | null
): Promise<Step> {
  const { config, ctx, rows } = await openDraft(deps, client, attemptId, draft);
  const answers = toAnswers(rows);
  const items = clientItems(getFlow(config, ctx, answers), rows);
  const from = fromQid ? items.findIndex((i) => i.qid === fromQid) : items.length;
  const target = items[Math.max(0, (from === -1 ? items.length : from) - 1)];
  if (!target) return stepFor(config, ctx, rows, null);
  return { kind: 'question', question: view(target, items, answers) };
}

/** Saves a buffered draft (e.g. when the tab is hidden). Does nothing once the attempt is closed. */
export async function saveDraft(deps: ServiceDeps, client: ClientProfile, attemptId: string, draft: unknown): Promise<boolean> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status !== 'in_progress') return false;
  const { rows } = await openDraft(deps, client, attemptId, draft);
  await deps.store.replaceAnswers(attempt.id, rows);
  return true;
}

// Single-answer helpers on the saved answers (each call saves at once). Used by tests and scripts.

export type SaveResult = AnswerResult;

export async function saveAnswer(deps: ServiceDeps, client: ClientProfile, attemptId: string, qid: string, value: AnswerValue) {
  const saved = (await openRunner(deps, client, attemptId)).answers;
  return answer(deps, client, attemptId, saved, qid, value, { flush: true });
}

export async function goBack(deps: ServiceDeps, client: ClientProfile, attemptId: string, fromQid: string | null): Promise<Step> {
  const { step, answers } = await openRunner(deps, client, attemptId);
  if (step.kind !== 'question' && step.kind !== 'finish') return step;
  return back(deps, client, attemptId, answers, fromQid);
}

// ---------------------------------------------------------------------------------------------
// Flags, stop, submit

function firedFlags(config: VersionConfig, ctx: EngineContext, answers: Answers) {
  const facts = buildFacts(config, ctx, answers);
  return config.flags.filter(
    (f) => (f.effects.interrupt || f.effects.stop || f.effects.notify?.length) && facts.flags.get(f.key) === true
  );
}

function eventFor(attemptId: string, flag: VersionConfig['flags'][number]): EventRow {
  const kind: EventRow['kind'] = flag.effects.stop
    ? 'age_stop'
    : flag.effects.interrupt || flag.effects.layout === 'crisis'
      ? 'crisis'
      : 'safety';
  return { attempt_id: attemptId, kind, flag_key: flag.key, notify: [...(flag.effects.notify ?? [])] };
}

/** A stop flag (age stop) ends the attempt: no answers are kept. Returns the stopped attempt or null. */
async function stopIfNeeded(
  deps: ServiceDeps,
  config: VersionConfig,
  attempt: AttemptRow,
  ctx: EngineContext,
  answers: Answers
): Promise<AttemptRow | null> {
  const stop = firedFlags(config, ctx, answers).find((f) => f.effects.stop);
  if (!stop) return null;
  await deps.store.deleteAnswers(attempt.id, 'all');
  await deps.store.insertEvent(eventFor(attempt.id, stop));
  return deps.store.updateAttempt(attempt.id, { status: 'stopped' });
}

/** Scores the attempt with its pinned version and stores the result once. Safe to call again. */
export async function submit(
  deps: ServiceDeps,
  client: ClientProfile,
  attemptId: string,
  draft?: unknown
): Promise<{ status: 'completed' | 'stopped' }> {
  // Buffered answers are saved first, so scoring always reads the database.
  if (draft !== undefined) await saveDraft(deps, client, attemptId, draft);
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status === 'completed' || (await deps.store.getResult(attempt.id))) {
    if (attempt.status !== 'completed') await completeAttempt(deps, attempt);
    return { status: 'completed' };
  }
  if (attempt.status === 'stopped') return { status: 'stopped' };
  if (attempt.status !== 'in_progress' || !attempt.report_language) {
    throw new AssessmentError('WRONG_STATUS', 'This assessment cannot be submitted yet.');
  }
  const config = await deps.loadConfig(attempt.version_id);
  const ctx = contextFor(client);
  const answers = toAnswers(await deps.store.getAnswers(attempt.id));

  let result;
  try {
    result = score(config, ctx, answers);
  } catch (err) {
    if (err instanceof AssessmentStoppedError) {
      await stopIfNeeded(deps, config, attempt, ctx, answers);
      return { status: 'stopped' };
    }
    if (err instanceof IncompleteAssessmentError) {
      throw new AssessmentError('INCOMPLETE', 'Some questions are still unanswered.');
    }
    throw err;
  }
  const completedAt = deps.now().toISOString();
  const report = buildReportDocument(config, result, {
    reportId: attempt.report_id,
    completedAt,
    language: attempt.report_language,
  });
  await deps.store.insertResult(attempt.id, result, report);
  await completeAttempt(deps, attempt, completedAt, result.engineVersion);
  return { status: 'completed' };
}

async function completeAttempt(deps: ServiceDeps, attempt: AttemptRow, completedAt?: string, engineVersion?: string) {
  const stored = await deps.store.getResult(attempt.id);
  const result = stored?.result as { engineVersion?: string } | undefined;
  const report = stored?.report as { completedAt?: string } | undefined;
  await deps.store.updateAttempt(attempt.id, {
    status: 'completed',
    completed_at: completedAt ?? report?.completedAt ?? deps.now().toISOString(),
    engine_version: engineVersion ?? result?.engineVersion ?? null,
  });
}
