import { beforeAll, describe, expect, it } from 'vitest';
import { compareResult, type AssessmentResult } from '@mfb/engine';
import type { TestCase, VersionConfig } from '@mfb/questionbank';
import { loadOfflineBanks, type OfflineBank } from '@mfb/questionbank/offline';
import type { ReportDocument } from '../lib/assessment/report-document';
import {
  getStep,
  giveConsent,
  goBack,
  profileAnswers,
  saveAnswer,
  setLanguage,
  startPurchase,
  submit,
  type ServiceDeps,
} from '../lib/assessment/service';
import { AssessmentError, type ClientProfile, type ReportLanguageChoice, type Step } from '../lib/assessment/types';
import { MemoryStore } from './memory-store';

// The assessment server layer with the real engine and the real IA 1.2 / MA 1.1 configurations, against an
// in-memory store (no network).

let banks: Record<string, OfflineBank>;
const IA_LIVE = 'version-IA-1.2';
const MA_LIVE = 'version-MA-1.1';

beforeAll(async () => {
  banks = await loadOfflineBanks();
});

function setup(paymentsMode: 'stub' | 'off' = 'stub') {
  const store = new MemoryStore();
  store.live = { IA: IA_LIVE, MA: MA_LIVE };
  const configs: Record<string, VersionConfig> = {
    [IA_LIVE]: withId(banks.IA.versions['1.2'].config, IA_LIVE),
    [MA_LIVE]: withId(banks.MA.versions['1.1'].config, MA_LIVE),
    'version-IA-1.1': withId(banks.IA.versions['1.1'].config, 'version-IA-1.1'),
  };
  const loaded: string[] = [];
  const deps: ServiceDeps = {
    store,
    loadConfig: async (id) => {
      loaded.push(id);
      const c = configs[id];
      if (!c) throw new Error(`unknown version ${id}`);
      return c;
    },
    now: () => new Date('2026-10-18T10:00:00.000Z'),
    paymentsMode,
  };
  return { store, deps, loaded };
}

function withId(config: VersionConfig, id: string): VersionConfig {
  return { ...config, version: { ...config.version, id } };
}

const female: ClientProfile = { id: 'client-1', gender: 'Female', age: 27, marital_status: 'Married' };

async function started(deps: ServiceDeps, client: ClientProfile, test: string, lang: ReportLanguageChoice = 'en') {
  const attempt = await startPurchase(deps, client, test);
  await setLanguage(deps, client, attempt.id, lang);
  await giveConsent(deps, client, attempt.id);
  return attempt.id;
}

async function expectError(p: Promise<unknown>, code: AssessmentError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AssessmentError && e.code === code);
}

describe('profile prefill', () => {
  it('maps gender, age band and relationship status to the version\'s own options', () => {
    const rows = profileAnswers(banks.IA.latest.config, female);
    expect(rows).toEqual([
      { qid: 'I2', value: 'female', source: 'profile' },
      { qid: 'I1', value: '25_34', source: 'profile' },
      { qid: 'I3', value: 'married', source: 'profile' },
    ]);
  });

  it('Mind has no relationship question, so only gender and age band', () => {
    expect(profileAnswers(banks.MA.latest.config, { ...female, age: 45 }).map((r) => [r.qid, r.value])).toEqual([
      ['MI2', 'female'],
      ['MI1', '45_54'],
    ]);
  });

  it('prefilled questions are never shown', async () => {
    const { deps } = setup();
    const id = await started(deps, female, 'IA');
    const step = (await getStep(deps, female, id)) as Extract<Step, { kind: 'question' }>;
    expect(step.kind).toBe('question');
    expect(['I1', 'I2', 'I3', 'I8']).not.toContain(step.question.qid);
    expect(step.question.position).toBe(1);
  });
});

describe('purchase, language, consent', () => {
  it('the stub works only in stub mode', async () => {
    const { deps } = setup('off');
    await expectError(startPurchase(deps, female, 'IA'), 'PAYMENTS_DISABLED');
  });

  it('creates a paid attempt pinned to the live version, with a report ID; reuses an open one', async () => {
    const { deps } = setup();
    const a = await startPurchase(deps, female, 'IA');
    expect([a.status, a.version_id, a.report_id, a.payment_mode]).toEqual(['paid', IA_LIVE, 'MFB-IA-2026-00001', 'stub']);
    expect((await startPurchase(deps, female, 'IA')).id).toBe(a.id);
    expect((await getStep(deps, female, a.id)).kind).toBe('language');
    await setLanguage(deps, female, a.id, 'hi');
    expect((await getStep(deps, female, a.id)).kind).toBe('consent');
    await giveConsent(deps, female, a.id);
    expect((await getStep(deps, female, a.id)).kind).toBe('question');
  });

  it('another client cannot see the attempt', async () => {
    const { deps } = setup();
    const id = await started(deps, female, 'IA');
    await expectError(getStep(deps, { ...female, id: 'client-2' }, id), 'NOT_FOUND');
  });
});

describe('answer validation', () => {
  it('rejects invisible questions, bad options, gate size and exclusive combinations', async () => {
    const { deps } = setup();
    const id = await started(deps, female, 'IA');
    await expectError(saveAnswer(deps, female, id, 'A1', 'often'), 'NOT_VISIBLE'); // gate not answered yet
    await expectError(saveAnswer(deps, female, id, 'I3', 'single'), 'NOT_VISIBLE'); // from the profile
    await expectError(saveAnswer(deps, female, id, 'I4', 'forever'), 'INVALID_ANSWER');
    await expectError(saveAnswer(deps, female, id, 'G1', ['A', 'B', 'E']), 'INVALID_ANSWER');
    await expectError(saveAnswer(deps, female, id, 'G1', []), 'INVALID_ANSWER');
    await expectError(saveAnswer(deps, female, id, 'G1', ['C']), 'INVALID_ANSWER'); // hidden for women
    await expectError(saveAnswer(deps, female, id, 'R1', ['none_of_these', 'thyroid']), 'INVALID_ANSWER');
    await saveAnswer(deps, female, id, 'R1', ['none_of_these']);
  });
});

describe('pruning', () => {
  it('changing I6 to no partner removes the partner path and hidden gate choices', async () => {
    const { deps, store } = setup();
    const id = await started(deps, female, 'IA');
    await saveAnswer(deps, female, id, 'I6', 'yes_and_they_are_willing_to_join_sessions');
    await saveAnswer(deps, female, id, 'G1', ['A', 'G']);
    await saveAnswer(deps, female, id, 'C1', 'often');
    await saveAnswer(deps, female, id, 'A1', 'often');
    await saveAnswer(deps, female, id, 'T3', 'often');
    await saveAnswer(deps, female, id, 'I6', 'i_do_not_have_a_partner_right_now');
    const qids = (await store.getAnswers(id)).map((r) => r.qid);
    expect(qids).not.toContain('C1');
    expect(qids).not.toContain('A1');
    // A is hidden on the solo path, so the gate keeps only G (and T3, which is shown on both paths).
    expect((await store.getAnswers(id)).find((r) => r.qid === 'G1')?.value).toEqual(['G']);
    expect(qids).toContain('T3');
  });

  it('changing the gate removes the old module\'s answers', async () => {
    const { deps, store } = setup();
    const id = await started(deps, female, 'IA');
    await saveAnswer(deps, female, id, 'I6', 'yes_and_they_are_willing_to_join_sessions');
    await saveAnswer(deps, female, id, 'G1', ['B']);
    await saveAnswer(deps, female, id, 'B1', 'often');
    await saveAnswer(deps, female, id, 'G1', ['A']);
    expect((await store.getAnswers(id)).map((r) => r.qid)).not.toContain('B1');
  });
});

describe('interrupts and events', () => {
  it('the crisis screen shows when newly raised, and the event is written once', async () => {
    const { deps, store } = setup();
    const id = await started(deps, female, 'MA');
    const first = await saveAnswer(deps, female, id, 'MR5', 'yes');
    expect(first.interrupt?.flag).toBe('CRISIS');
    expect(first.interrupt?.text?.en).toContain('14416');
    expect((await saveAnswer(deps, female, id, 'MR5', 'no')).interrupt).toBeNull();
    expect((await saveAnswer(deps, female, id, 'MR5', 'yes')).interrupt?.flag).toBe('CRISIS');
    expect(store.events).toEqual([{ attempt_id: id, kind: 'crisis', flag_key: 'CRISIS', notify: ['coordinator', 'counsellor'] }]);
  });

  it('safety is recorded as an event (no interrupt screen)', async () => {
    const { deps, store } = setup();
    const id = await started(deps, female, 'IA');
    expect((await saveAnswer(deps, female, id, 'R6', 'yes')).interrupt).toBeNull();
    expect(store.events.map((e) => [e.kind, e.flag_key])).toEqual([['safety', 'SAFETY']]);
  });

  it('an age stop ends the attempt and keeps no answers', async () => {
    const { deps, store } = setup();
    const minor = { ...female, id: 'client-minor', age: 16 };
    const attempt = await startPurchase(deps, minor, 'IA');
    expect(attempt.status).toBe('stopped');
    expect(await store.getAnswers(attempt.id)).toEqual([]);
    expect(store.events.map((e) => e.kind)).toEqual(['age_stop']);
    const step = await getStep(deps, minor, attempt.id);
    expect(step.kind).toBe('stopped');
    expect(step.kind === 'stopped' && step.text?.en).toContain('18');
  });
});

describe('going back', () => {
  it('returns the previous question with its saved answer', async () => {
    const { deps } = setup();
    const id = await started(deps, female, 'IA');
    const first = (await getStep(deps, female, id)) as Extract<Step, { kind: 'question' }>;
    const r = await saveAnswer(deps, female, id, first.question.qid, first.question.options[0].code);
    const second = r.step as Extract<Step, { kind: 'question' }>;
    const back = (await goBack(deps, female, id, second.question.qid)) as Extract<Step, { kind: 'question' }>;
    expect(back.question.qid).toBe(first.question.qid);
    expect(back.question.saved).toBe(first.question.options[0].code);
    expect(back.question.canGoBack).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Full runs: every IA 1.2 and MA 1.1 test case played through the server layer.

function profileFor(config: VersionConfig, tc: TestCase, id: string): ClientProfile {
  const reg = config.scoring.registration;
  const gender = Object.entries(reg.sex_options).find(([, code]) => code === tc.context.sex)![0];
  const rel = config.questions.find((q) => profileAnswers(config, { id, gender, age: tc.context.age, marital_status: 'x' }).length && q.qid === 'I3');
  const relLabel = rel?.options.find((o) => o.option_code === tc.answers.I3)?.label_en;
  return { id, gender, age: tc.context.age, marital_status: relLabel ?? 'Single' };
}

function languageOf(config: VersionConfig, tc: TestCase): ReportLanguageChoice {
  const rl = config.report_rules.report_language;
  const langs = rl.map[tc.answers[rl.qid] as string] ?? ['en'];
  return langs.length > 1 ? 'both' : (langs[0] as 'en' | 'hi');
}

async function playThrough(deps: ServiceDeps, store: MemoryStore, config: VersionConfig, tc: TestCase, n: number) {
  const client = profileFor(config, tc, `client-${tc.name}-${n}`);
  const id = await started(deps, client, config.version.test_code, languageOf(config, tc));
  let step = await getStep(deps, client, id);
  for (let guard = 0; step.kind === 'question' && guard < 200; guard++) {
    const qid = step.question.qid;
    const value = tc.answers[qid];
    if (value === undefined) throw new Error(`${tc.name}: the flow asks ${qid}, which the test case does not answer`);
    step = (await saveAnswer(deps, client, id, qid, value)).step;
  }
  expect(step.kind).toBe('finish');
  expect(await submit(deps, client, id)).toEqual({ status: 'completed' });
  const stored = (await store.getResult(id))!;
  return { id, client, result: stored.result as AssessmentResult, report: stored.report as ReportDocument };
}

describe('full runs through the server layer', () => {
  for (const [test, label, live] of [
    ['IA', '1.2', IA_LIVE],
    ['MA', '1.1', MA_LIVE],
  ] as const) {
    it(`${test} ${label}: every test case gives the expected stored result`, async () => {
      const { deps, store } = setup();
      const config = await deps.loadConfig(live);
      const cases = banks[test].versions[label].payload.test_cases;
      expect(cases.length).toBeGreaterThan(0);
      let n = 0;
      for (const tc of cases) {
        const { result, report } = await playThrough(deps, store, config, tc, n++);
        expect({ name: tc.name, diffs: compareResult(result, tc.expected, tc.context.path) }).toEqual({ name: tc.name, diffs: [] });
        expect(result.versionId).toBe(live);
        expect(report.warnings).toEqual([]);
      }
    });
  }

  it('submit is idempotent', async () => {
    const { deps, store } = setup();
    const config = await deps.loadConfig(IA_LIVE);
    const tc = banks.IA.versions['1.2'].payload.test_cases[0];
    const { id, client, result } = await playThrough(deps, store, config, tc, 99);
    expect(await submit(deps, client, id)).toEqual({ status: 'completed' });
    expect((await store.getResult(id))!.result).toEqual(result);
    expect(store.attempts.get(id)?.status).toBe('completed');
    await expect(saveAnswer(deps, client, id, 'R6', 'no')).rejects.toBeInstanceOf(AssessmentError);
  });

  it('keeps using the pinned version after a new version goes live', async () => {
    const { deps, store, loaded } = setup();
    store.live.IA = 'version-IA-1.1';
    const config = await deps.loadConfig('version-IA-1.1');
    const tc = banks.IA.versions['1.1'].payload.test_cases.find((t) => t.name === 'Worked example D')!;
    const client = profileFor(config, tc, 'client-pinned');
    const id = await started(deps, client, 'IA');
    store.live.IA = IA_LIVE; // 1.2 goes live while the client is answering
    let step = await getStep(deps, client, id);
    for (let g = 0; step.kind === 'question' && g < 200; g++) {
      step = (await saveAnswer(deps, client, id, step.question.qid, tc.answers[step.question.qid])).step;
    }
    await submit(deps, client, id);
    const result = (await store.getResult(id))!.result as AssessmentResult;
    // On 1.1, Worked example D (T7 = Rarely) is still Couple; on 1.2 it would be individual.
    expect([result.versionId, result.format?.type]).toEqual(['version-IA-1.1', 'couple']);
    expect(loaded).not.toContain(IA_LIVE); // the new live version is never loaded for this attempt
  });
});

describe('report document', () => {
  it('both languages, crisis layout first block, filled plan line', async () => {
    const { deps, store } = setup();
    const config = await deps.loadConfig(IA_LIVE);
    const f = banks.IA.versions['1.2'].payload.test_cases.find((t) => t.name === 'Worked example F')!;
    const { report } = await playThrough(deps, store, config, { ...f, answers: { ...f.answers, I8: 'both' } }, 1);
    expect(report.languages).toEqual(['en', 'hi']);
    expect(report.layout).toBe('crisis');
    expect(report.sections.en?.crisis).toContain('14416');
    expect(report.sections.en?.plan).toBeNull();
    expect(report.sections.hi?.crisis).toBeTruthy();

    const b = banks.IA.versions['1.2'].payload.test_cases.find((t) => t.name === 'Worked example B')!;
    const run = await playThrough(deps, store, config, b, 2);
    expect(run.report.sections.en?.plan?.line).toBe(
      'Based on your answers, we recommend the Reset Plan: 6 sessions, couple sessions with both of you, weekly, about 6 weeks.'
    );
    expect(run.report.sections.en?.snapshot.areas.map((a) => [a.module, a.percent, a.bandName])).toEqual([
      ['CORE', 39, 'Mild'],
      ['A', 67, 'Moderate'],
    ]);
  });
});
