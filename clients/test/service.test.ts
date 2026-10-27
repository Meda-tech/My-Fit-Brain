import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRISIS_QUESTION_ID, HOME_SAFETY_QUESTION_ID, YES, NO, type Report, type Result } from '@mfb/questionnaire';
import * as service from '../lib/assessment/service';
import { AssessmentError, type ClientProfile, type Step } from '../lib/assessment/types';
import { MemoryStore } from './memory-store';

// The client flow on the Intimacy starting draft: pay → consent → answer every question → submit.

const intimacy = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/questionnaires/intimacy.json'), 'utf8'));
const client: ClientProfile = { id: 'client-1', full_name: 'Asha Verma' };
const other: ClientProfile = { id: 'client-2', full_name: 'Someone Else' };

function setup() {
  const store = new MemoryStore();
  store.addLiveVersion('IA', intimacy);
  const deps: service.ServiceDeps = { store, now: () => new Date('2026-10-22T10:00:00.000Z') };
  return { store, deps };
}

async function paidAndStarted(deps: service.ServiceDeps) {
  const attempt = await service.createPaidAttempt(deps, client, 'IA', { ref: 'pay_1', paidAt: '2026-10-22T09:00:00.000Z' }, 'hi');
  await service.giveConsent(deps, client, attempt.id);
  return attempt;
}

/** Answers every question with the option at `index` (or the last one), until the finish step. */
async function answerAll(deps: service.ServiceDeps, attemptId: string, choose: (step: Extract<Step, { kind: 'question' }>) => string[]) {
  let step = await service.openRunner(deps, client, attemptId);
  for (let guard = 0; guard < 300 && step.kind === 'question'; guard += 1) {
    const r = await service.answer(deps, client, attemptId, step.question.id, choose(step));
    step = r.step;
  }
  return step;
}

describe('purchase and consent', () => {
  it('creates one attempt per payment with a report ID and the live version', async () => {
    const { store, deps } = setup();
    const a = await service.createPaidAttempt(deps, client, 'IA', { ref: 'pay_1', paidAt: '2026-10-22T09:00:00.000Z' }, 'en');
    expect(a.report_id).toBe('MFB-IA-2026-00001');
    expect(a.version_id).toBe('version-1');
    expect(a.status).toBe('paid');
    const again = await service.createPaidAttempt(deps, client, 'IA', { ref: 'pay_1', paidAt: '2026-10-22T09:00:00.000Z' }, 'en');
    expect(again.id).toBe(a.id);
    expect(store.counter).toBe(1);
    await expect(service.createPaidAttempt(deps, client, 'XX', { ref: 'pay_2', paidAt: '2026-10-22T09:00:00.000Z' })).rejects.toMatchObject({ code: 'NO_LIVE_VERSION' });
  });

  it('shows consent first, then the first question', async () => {
    const { deps } = setup();
    const a = await service.createPaidAttempt(deps, client, 'IA', { ref: 'pay_1', paidAt: '2026-10-22T09:00:00.000Z' });
    expect((await service.openRunner(deps, client, a.id)).kind).toBe('consent');
    await service.giveConsent(deps, client, a.id);
    const step = await service.openRunner(deps, client, a.id);
    expect(step.kind).toBe('question');
    if (step.kind === 'question') {
      expect(step.question.id).toBe('q_i4');
      expect(step.question.position).toBe(1);
      expect(step.question.canGoBack).toBe(false);
    }
  });

  it('never shows another client’s attempt', async () => {
    const { deps } = setup();
    const a = await paidAndStarted(deps);
    await expect(service.openRunner(deps, other, a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('answering', () => {
  it('rejects answers to hidden questions and unknown options', async () => {
    const { deps } = setup();
    const a = await paidAndStarted(deps);
    await expect(service.answer(deps, client, a.id, 'q_c1', ['o_often'])).rejects.toMatchObject({ code: 'NOT_VISIBLE' });
    await expect(service.answer(deps, client, a.id, 'q_i4', ['o_nope'])).rejects.toMatchObject({ code: 'INVALID_ANSWER' });
    await expect(service.answer(deps, client, a.id, 'q_i4', ['o_1_3_years', 'o_3_10_years'])).rejects.toMatchObject({ code: 'INVALID_ANSWER' });
  });

  it('routes solo clients past partner questions and clears answers when the path changes', async () => {
    const { store, deps } = setup();
    const a = await paidAndStarted(deps);
    await service.answer(deps, client, a.id, 'q_i4', ['o_not_applicable']);
    await service.answer(deps, client, a.id, 'q_i5', ['o_india']);
    await service.answer(deps, client, a.id, 'q_i6', ['o_yes_willing']);
    await service.answer(deps, client, a.id, 'q_i7', ['o_no_children']);
    await service.answer(deps, client, a.id, 'q_g1', ['o_a']);
    const core = await service.answer(deps, client, a.id, 'q_c1', ['o_often']);
    expect(core.step.kind === 'question' && core.step.question.id).toBe('q_c2');
    // Back to I6 and switch to "no partner": the core and module A answers go, the solo core appears.
    const switched = await service.answer(deps, client, a.id, 'q_i6', ['o_no_partner']);
    expect(switched.step.kind === 'question' && switched.step.question.id).toBe('q_cs1');
    expect(Object.keys(store.answers.get(a.id)!)).toEqual(['q_i4', 'q_i5', 'q_i6', 'q_i7', 'q_g1']);
  });

  it('shows the support screen once and records alerts for crisis and home safety', async () => {
    const { store, deps } = setup();
    const a = await paidAndStarted(deps);
    const step = await answerAll(deps, a.id, (s) => {
      if (s.question.id === CRISIS_QUESTION_ID || s.question.id === HOME_SAFETY_QUESTION_ID) return [YES];
      return [s.question.options[0].id];
    });
    expect(step.kind).toBe('finish');
    expect(store.alerts).toEqual([
      { attemptId: a.id, kind: 'crisis' },
      { attemptId: a.id, kind: 'home_safety' },
    ]);
    // The interrupt came with the crisis answer.
    const back = await service.back(deps, client, a.id, null);
    expect(back.kind === 'question' && back.question.id).toBe(HOME_SAFETY_QUESTION_ID);
    const again = await service.answer(deps, client, a.id, CRISIS_QUESTION_ID, [YES]);
    expect(again.interrupt?.text.en).toContain('14416');
    expect(store.alerts.length).toBe(2);
  });

  it('goes back one visible question', async () => {
    const { deps } = setup();
    const a = await paidAndStarted(deps);
    await service.answer(deps, client, a.id, 'q_i4', ['o_1_3_years']);
    await service.answer(deps, client, a.id, 'q_i5', ['o_india']);
    const back = await service.back(deps, client, a.id, { kind: 'question', id: 'q_i6' });
    expect(back.kind === 'question' && back.question.id).toBe('q_i5');
    expect(back.kind === 'question' && back.question.saved).toEqual(['o_india']);
  });
});

describe('submit', () => {
  it('refuses an unfinished assessment', async () => {
    const { deps } = setup();
    const a = await paidAndStarted(deps);
    await service.answer(deps, client, a.id, 'q_i4', ['o_1_3_years']);
    await expect(service.submit(deps, client, a.id, 'en')).rejects.toMatchObject({ code: 'INCOMPLETE' });
  });

  it('scores once, stores the report in the client’s language and freezes the attempt', async () => {
    const { store, deps } = setup();
    const a = await paidAndStarted(deps);
    await answerAll(deps, a.id, (s) => {
      if (s.question.id === 'q_i6') return ['o_yes_willing'];
      if (s.question.id === 'q_g1') return ['o_a', 'o_b'];
      if (s.question.id === CRISIS_QUESTION_ID || s.question.id === HOME_SAFETY_QUESTION_ID) return [NO];
      // The highest-value option everywhere else.
      const best = [...s.question.options].sort((x, y) => (x.skip ? 1 : 0) - (y.skip ? 1 : 0)).at(-1)!;
      return [s.question.options.find((o) => !o.skip && o.id !== best.id) ? s.question.options.filter((o) => !o.skip).at(-1)!.id : s.question.options[0].id];
    });
    const r = await service.submit(deps, client, a.id, 'hi');
    expect(r.status).toBe('completed');
    const stored = store.results.get(a.id)!;
    const result = stored.result as Result;
    const report = stored.report as Report;
    expect(result.sections.filter((s) => s.shown && s.scored).map((s) => s.id)).toEqual(['s_core', 's_a', 's_b']);
    expect(result.main).not.toBeNull();
    expect(result.plan).not.toBeNull();
    expect(report.lang).toBe('hi');
    expect(report.title).toBe('MFB इंटिमेसी असेसमेंट');
    expect(report.clientName).toBe('Asha Verma');
    expect(report.reportId).toBe('MFB-IA-2026-00001');
    expect(report.snapshot.areas).toHaveLength(3);
    expect(report.plan?.note).toBe('आपका काउंसलर आपके साथ फ़ॉर्मेट की पुष्टि करेगा।');
    const attempt = (await store.getAttempt(a.id))!;
    expect(attempt.status).toBe('completed');
    expect(attempt.language).toBe('hi');
    // Idempotent, and no more answers.
    expect((await service.submit(deps, client, a.id, 'en')).status).toBe('completed');
    expect((await service.openRunner(deps, client, a.id)).kind).toBe('completed');
    await expect(service.answer(deps, client, a.id, 'q_i4', ['o_1_3_years'])).rejects.toBeInstanceOf(AssessmentError);
  });
});

describe('client details', () => {
  const list = [
    { id: 'd_health', text: { en: 'Do you have any health problem?', hi: 'क्या आपको कोई स्वास्थ्य समस्या है?' } },
    { id: 'd_goal', text: { en: 'What would you like to change first?', hi: 'आप सबसे पहले क्या बदलना चाहेंगे?' } },
  ];
  const plain = (s: Extract<Step, { kind: 'question' }>) =>
    s.question.id === CRISIS_QUESTION_ID || s.question.id === HOME_SAFETY_QUESTION_ID ? [NO] : [s.question.options[0].id];

  it('asks the typed questions after the safety questions, then finishes', async () => {
    const { store, deps } = setup();
    store.setClientDetails('IA', list);
    const a = await paidAndStarted(deps);
    const first = await answerAll(deps, a.id, plain);
    expect(first.kind).toBe('detail');
    if (first.kind !== 'detail') return;
    expect(first.detail.id).toBe('d_health');
    expect(first.detail.total).toBe(first.detail.position + 1);
    // Typed answers are required and checked; a detail never opens before the questions are done.
    await expect(service.answerDetail(deps, client, a.id, 'd_health', '   ')).rejects.toMatchObject({ code: 'INVALID_ANSWER' });
    await expect(service.answerDetail(deps, client, a.id, 'd_health', 'x'.repeat(1001))).rejects.toMatchObject({ code: 'INVALID_ANSWER' });
    await expect(service.answerDetail(deps, client, a.id, 'd_nope', 'Hello')).rejects.toMatchObject({ code: 'NOT_VISIBLE' });
    await expect(service.submit(deps, client, a.id, 'en')).rejects.toMatchObject({ code: 'INCOMPLETE' });

    const second = await service.answerDetail(deps, client, a.id, 'd_health', '  Sugar, since 2020.  ');
    expect(second.step.kind === 'detail' && second.step.detail.id).toBe('d_goal');
    const done = await service.answerDetail(deps, client, a.id, 'd_goal', 'Feel closer to my partner.');
    expect(done.step.kind).toBe('finish');
    expect(store.details.get(a.id)).toEqual([
      { detail_id: 'd_health', question: list[0].text, answer: 'Sugar, since 2020.', sort: 0 },
      { detail_id: 'd_goal', question: list[1].text, answer: 'Feel closer to my partner.', sort: 1 },
    ]);
    expect((await service.submit(deps, client, a.id, 'en')).status).toBe('completed');
    await expect(service.answerDetail(deps, client, a.id, 'd_goal', 'Changed')).rejects.toMatchObject({ code: 'WRONG_STATUS' });
  });

  it('goes back through the typed questions to the last safety question', async () => {
    const { store, deps } = setup();
    store.setClientDetails('IA', list);
    const a = await paidAndStarted(deps);
    await answerAll(deps, a.id, plain);
    await service.answerDetail(deps, client, a.id, 'd_health', 'None');
    await service.answerDetail(deps, client, a.id, 'd_goal', 'Sleep better');
    const fromFinish = await service.back(deps, client, a.id, null);
    expect(fromFinish.kind === 'detail' && fromFinish.detail.saved).toBe('Sleep better');
    const fromGoal = await service.back(deps, client, a.id, { kind: 'detail', id: 'd_goal' });
    expect(fromGoal.kind === 'detail' && fromGoal.detail.id).toBe('d_health');
    const fromHealth = await service.back(deps, client, a.id, { kind: 'detail', id: 'd_health' });
    expect(fromHealth.kind === 'question' && fromHealth.question.id).toBe(HOME_SAFETY_QUESTION_ID);
  });

  it('uses the current list: a question added later is asked, old answers keep their text', async () => {
    const { store, deps } = setup();
    store.setClientDetails('IA', [list[0]]);
    const a = await paidAndStarted(deps);
    await answerAll(deps, a.id, plain);
    await service.answerDetail(deps, client, a.id, 'd_health', 'None');
    store.setClientDetails('IA', [{ id: 'd_health', text: { en: 'Edited question', hi: null } }, list[1]]);
    const step = await service.openRunner(deps, client, a.id);
    expect(step.kind === 'detail' && step.detail.id).toBe('d_goal');
    expect(store.details.get(a.id)![0].question.en).toBe('Do you have any health problem?');
  });
});
