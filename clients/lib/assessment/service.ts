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
import type { PaymentsMode } from './payments';
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

// The client assessment flow. Every call reloads the attempt, checks it belongs to the client and uses
// the attempt's pinned version. All rules come from the version through @mfb/engine.

export interface ServiceDeps {
  store: AttemptStore;
  loadConfig(versionId: string): Promise<VersionConfig>;
  now(): Date;
  paymentsMode: PaymentsMode;
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

/** Testing stub only: creates a paid attempt pinned to the live version. */
export async function startPurchase(deps: ServiceDeps, client: ClientProfile, testCode: string): Promise<AttemptRow> {
  if (deps.paymentsMode !== 'stub') throw new AssessmentError('PAYMENTS_DISABLED', 'Payments are not available yet.');
  const ctx = contextFor(client);
  const open = await deps.store.findOpenAttempt(client.id, testCode);
  if (open) return open;

  const versionId = await deps.store.liveVersionId(testCode);
  if (!versionId) throw new AssessmentError('NO_LIVE_VERSION', 'This assessment is not available right now.');
  const reportId = await deps.store.nextReportId(testCode);
  const now = deps.now().toISOString();
  const attempt = await deps.store.createAttempt({
    report_id: reportId,
    client_id: client.id,
    test_code: testCode,
    version_id: versionId,
    kind: 'initial',
    status: 'paid',
    report_language: null,
    consent_at: null,
    payment_mode: 'stub',
    payment_ref: `stub:${reportId}`,
    paid_at: now,
    started_at: null,
    completed_at: null,
    engine_version: null,
  });

  const config = await deps.loadConfig(versionId);
  const prefill = profileAnswers(config, client);
  if (prefill.length) await deps.store.upsertAnswers(attempt.id, prefill);
  const stopped = await stopIfNeeded(deps, config, attempt, ctx, toAnswers(prefill));
  return stopped ?? attempt;
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

export async function setLanguage(deps: ServiceDeps, client: ClientProfile, attemptId: string, lang: ReportLanguageChoice) {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status !== 'paid' && attempt.status !== 'in_progress') {
    throw new AssessmentError('WRONG_STATUS', 'The report language can no longer change.');
  }
  const config = await deps.loadConfig(attempt.version_id);
  // The report-language question is answered by this screen, never asked again.
  const rl = config.report_rules.report_language;
  const wanted = lang === 'both' ? 'en|hi' : lang;
  const code = Object.entries(rl.map).find(([, langs]) => [...langs].sort().join('|') === wanted)?.[0];
  if (code) await deps.store.upsertAnswers(attempt.id, [{ qid: rl.qid, value: code, source: 'profile' }]);
  return deps.store.updateAttempt(attempt.id, { report_language: lang });
}

export async function giveConsent(deps: ServiceDeps, client: ClientProfile, attemptId: string) {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status === 'in_progress') return attempt;
  if (attempt.status !== 'paid' || !attempt.report_language) {
    throw new AssessmentError('WRONG_STATUS', 'Choose the report language first.');
  }
  const now = deps.now().toISOString();
  return deps.store.updateAttempt(attempt.id, { status: 'in_progress', consent_at: now, started_at: now });
}

// ---------------------------------------------------------------------------------------------
// Questions

export async function getStep(deps: ServiceDeps, client: ClientProfile, attemptId: string, atQid?: string | null): Promise<Step> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status === 'completed') return { kind: 'completed' };
  const config = await deps.loadConfig(attempt.version_id);
  if (attempt.status === 'stopped') {
    const stop = config.flags.find((f) => f.effects.stop);
    return { kind: 'stopped', text: stop ? flagText(config, stop.key) : null };
  }
  if (!attempt.report_language) return { kind: 'language' };
  if (!attempt.consent_at) return { kind: 'consent' };

  const rows = await deps.store.getAnswers(attempt.id);
  return stepFor(config, contextFor(client), rows, atQid ?? null);
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

export interface SaveResult {
  step: Step;
  interrupt: Interrupt | null;
}

export async function saveAnswer(
  deps: ServiceDeps,
  client: ClientProfile,
  attemptId: string,
  qid: string,
  value: AnswerValue
): Promise<SaveResult> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status !== 'in_progress') throw new AssessmentError('WRONG_STATUS', 'This assessment is not open for answers.');
  const config = await deps.loadConfig(attempt.version_id);
  const ctx = contextFor(client);
  const rows = await deps.store.getAnswers(attempt.id);
  const answers = toAnswers(rows);

  const flow = getFlow(config, ctx, answers);
  const item = clientItems(flow, rows).find((i) => i.qid === qid);
  if (!item) throw new AssessmentError('NOT_VISIBLE', 'That question is not part of your assessment right now.');
  checkValue(item, value);

  const before = firedFlags(config, ctx, answers);
  const { answers: kept, removed } = pruneAnswers(config, ctx, { ...answers, [qid]: value });
  getFlow(config, ctx, kept); // the engine re-checks every answer
  await deps.store.upsertAnswers(attempt.id, [{ qid, value, source: 'client' }]);
  // "removed" lists answers that disappeared and answers that lost choices (e.g. a gate option now
  // hidden): keep what is left of the latter, delete the former.
  const sourceOf = new Map(rows.map((r) => [r.qid, r.source]));
  const trimmed = removed.filter((q) => q !== qid && kept[q] !== undefined);
  const gone = removed.filter((q) => kept[q] === undefined);
  if (trimmed.length) {
    await deps.store.upsertAnswers(
      attempt.id,
      trimmed.map((q) => ({ qid: q, value: kept[q], source: sourceOf.get(q) ?? 'client' }))
    );
  }
  if (gone.length) await deps.store.deleteAnswers(attempt.id, gone);

  const stopped = await stopIfNeeded(deps, config, attempt, ctx, kept);
  if (stopped) return { step: await getStep(deps, client, attempt.id), interrupt: null };

  // Record events once per flag; show an interrupt screen when this answer newly raised it.
  const after = firedFlags(config, ctx, kept);
  let interrupt: Interrupt | null = null;
  for (const flag of after) {
    await deps.store.insertEvent(eventFor(attempt.id, flag));
    if (flag.effects.interrupt && !before.some((b) => b.key === flag.key) && !interrupt) {
      interrupt = { flag: flag.key, text: flagText(config, flag.key) };
    }
  }
  const newRows = await deps.store.getAnswers(attempt.id);
  return { step: stepFor(config, ctx, newRows, null), interrupt };
}

export async function goBack(deps: ServiceDeps, client: ClientProfile, attemptId: string, fromQid: string | null): Promise<Step> {
  const attempt = await ownAttempt(deps, client, attemptId);
  if (attempt.status !== 'in_progress') return getStep(deps, client, attemptId);
  const config = await deps.loadConfig(attempt.version_id);
  const ctx = contextFor(client);
  const rows = await deps.store.getAnswers(attempt.id);
  const answers = toAnswers(rows);
  const items = clientItems(getFlow(config, ctx, answers), rows);
  const from = fromQid ? items.findIndex((i) => i.qid === fromQid) : items.length;
  const target = items[Math.max(0, (from === -1 ? items.length : from) - 1)];
  if (!target) return stepFor(config, ctx, rows, null);
  return { kind: 'question', question: view(target, items, answers) };
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
export async function submit(deps: ServiceDeps, client: ClientProfile, attemptId: string): Promise<{ status: 'completed' | 'stopped' }> {
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
