import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { VersionConfig } from '@mfb/questionbank';
import {
  AssessmentStoppedError,
  IncompleteAssessmentError,
  InvalidAnswerError,
  bandFor,
  checkInterrupts,
  compareProgress,
  evaluateCondition,
  buildFacts,
  getFlow,
  nextQuestion,
  pruneAnswers,
  resolveReportTexts,
  roundPercent,
  score,
  type Answers,
  type AssessmentResult,
  type EngineContext,
} from '../src/index';
import { contextOf, loadBanks, setModuleSum, testCase } from './helpers';

const banks = await loadBanks();
const IA = banks.IA.live;
const MA = banks.MA.live;
const iaCase = (name: string) => testCase(banks.IA.livePayload, name);
const maCase = (name: string) => testCase(banks.MA.livePayload, name);

/** Answers every remaining visible question with a neutral default (never / no / first option). */
function complete(config: VersionConfig, ctx: EngineContext, answers: Answers): Answers {
  const out = { ...answers };
  for (let i = 0; i < 200; i++) {
    const next = nextQuestion(config, ctx, out);
    if (!next) return out;
    if (next.type === 'multi') out[next.qid] = [next.options.find((o) => o.exclusive)?.code ?? next.options[0].code];
    else if (next.type === 'likert') out[next.qid] = 'never';
    else if (next.type === 'yn') out[next.qid] = 'no';
    else out[next.qid] = next.options[0].code;
  }
  throw new Error('flow did not finish');
}

const female30: EngineContext = { sex: 'Female', age: 30, mode: 'initial' };
const male30: EngineContext = { sex: 'Male', age: 30, mode: 'initial' };

describe('band edges and rounding', () => {
  it('rounds half up in exact arithmetic', () => {
    expect(roundPercent(51, 200)).toBe(26); // 25.5 → 26
    expect(roundPercent(50, 200)).toBe(25);
    expect(roundPercent(17, 33)).toBe(52); // 51.52
    expect(roundPercent(25, 33)).toBe(76); // 75.76
  });

  it('maps 25/26, 50/51, 75/76 to the configured bands', () => {
    expect([25, 26, 50, 51, 75, 76].map((p) => bandFor(IA, p))).toEqual(['Low', 'Mild', 'Mild', 'Moderate', 'Moderate', 'High']);
  });

  it('real modules at the edges', () => {
    const solo = iaCase('Worked example E').answers;
    // SOLO, female, module D: 4 scored items shown (F1, F2, F3, F7) → 3/12 = 25% Low.
    let a: Answers = { ...solo, I2: 'female', G1: ['D'] };
    a = pruneAnswers(IA, female30, a).answers;
    a = setModuleSum(IA, a, 'D', 3, 'solo');
    a = setModuleSum(IA, a, 'SOLO_CORE', 7, 'solo'); // 7/27 = 25.9 → 26 Mild
    const r = score(IA, female30, complete(IA, female30, a));
    expect([r.modules.D.percent, r.modules.D.band, r.modules.D.scoredItems]).toEqual([25, 'Low', 4]);
    expect([r.modules.SOLO_CORE.percent, r.modules.SOLO_CORE.band]).toEqual([26, 'Mild']);

    const base = iaCase('Worked example B'); // male, partner, A only
    const ctx = contextOf(IA, base);
    const at = (core: number, mod: number) => score(IA, ctx, setModuleSum(IA, setModuleSum(IA, base.answers, 'CORE', core, 'partner'), 'A', mod, 'partner'));
    const r50 = at(17, 12);
    expect([r50.modules.A.percent, r50.modules.A.band, r50.modules.CORE.percent, r50.modules.CORE.band]).toEqual([50, 'Mild', 52, 'Moderate']);
    const r75 = at(25, 18);
    expect([r75.modules.A.percent, r75.modules.A.band, r75.modules.CORE.percent, r75.modules.CORE.band]).toEqual([75, 'Moderate', 76, 'High']);
  });
});

describe('SOLO path', () => {
  const tc = iaCase('Worked example E');
  const ctx = contextOf(IA, tc);
  const flow = getFlow(IA, ctx, tc.answers);
  const result = score(IA, ctx, tc.answers);

  it('never shows partner items', () => {
    const partnerQids = IA.questions.filter((q) => q.path === 'partner').map((q) => q.qid);
    expect(flow.filter((f) => partnerQids.includes(f.qid))).toEqual([]);
    expect(result.path).toBe('solo');
    expect(result.coreModule).toBe('SOLO_CORE');
  });

  it('uses the smaller divisor', () => {
    expect(result.modules.C.scoredItems).toBe(8); // partner path: 9 (one partner-only item)
    expect(result.modules.C.max).toBe(24);
  });

  it('gate hides A and B', () => {
    const gate = flow.find((f) => f.qid === IA.scoring.gate.qid)!;
    expect(gate.options.map((o) => o.code)).not.toContain('A');
    expect(gate.options.map((o) => o.code)).not.toContain('B');
  });

  it('format individual', () => {
    expect(result.format).toMatchObject({ type: 'individual', source: { kind: 'rule', key: 'SOLO_INDIVIDUAL' } });
  });
});

describe('Prefer not to say', () => {
  const ctx: EngineContext = { sex: 'Prefer not to say', age: 30, mode: 'initial' };
  const base = { ...iaCase('R2_PNS_ONSET').answers };

  it('is offered both C and D, and sees C and D items when chosen', () => {
    const flow = getFlow(IA, ctx, { ...base, G1: ['C', 'D'] });
    const gate = flow.find((f) => f.qid === 'G1')!;
    expect(gate.options.map((o) => o.code)).toEqual(expect.arrayContaining(['C', 'D']));
    const modules = new Set(flow.map((f) => f.module));
    expect(modules.has('C') && modules.has('D')).toBe(true);
    // R3 / R4 follow the modules chosen (visibility rules).
    expect(flow.map((f) => f.qid)).toEqual(expect.arrayContaining(['R3', 'R4']));
  });

  it('without C or D chosen, R3 and R4 are not shown', () => {
    const flow = getFlow(IA, ctx, base);
    expect(flow.map((f) => f.qid)).not.toContain('R3');
    expect(flow.map((f) => f.qid)).not.toContain('R4');
  });
});

describe('gate', () => {
  const tc = iaCase('Worked example B');
  const ctx = contextOf(IA, tc);

  it('enforces min and max choices', () => {
    const gate = getFlow(IA, ctx, tc.answers).find((f) => f.qid === 'G1')!;
    expect([gate.minChoices, gate.maxChoices]).toEqual([1, 2]);
    expect(() => getFlow(IA, ctx, { ...tc.answers, G1: ['A', 'B', 'E'] })).toThrow(InvalidAnswerError);
    // An empty gate is unanswered: it is the next question.
    const { G1: _drop, ...rest } = tc.answers;
    void _drop;
    expect(nextQuestion(IA, ctx, { ...rest, G1: [] })?.qid).toBe('G1');
  });

  it('chosen order drives the primary tie-break and module order', () => {
    let a: Answers = { ...tc.answers, G1: ['B', 'A'] };
    a = complete(IA, ctx, setModuleSum(IA, setModuleSum(IA, a, 'A', 16, 'partner'), 'B', 16, 'partner'));
    const ba = score(IA, ctx, a);
    expect([ba.modules.A.band, ba.modules.B.band]).toEqual(['Moderate', 'Moderate']);
    expect(ba.primary).toBe('B');
    const ab = score(IA, ctx, { ...a, G1: ['A', 'B'] });
    expect(ab.primary).toBe('A');
    const order = getFlow(IA, ctx, a).map((f) => f.module);
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('A'));
  });

  it('rejects an exclusive option combined with others', () => {
    expect(() => getFlow(IA, ctx, { ...tc.answers, R1: ['none_of_these', 'diabetes'] })).toThrow(/cannot be combined/);
    expect(() => score(IA, ctx, { ...tc.answers, R1: ['none_of_these', 'diabetes'] })).toThrow(InvalidAnswerError);
  });
});

describe('Mind gate ordering', () => {
  const order = (occupation: string) =>
    getFlow(MA, female30, { MI3: occupation }).find((f) => f.qid === 'MG1')!.options.map((o) => o.code);
  it('students see K first, working people W first, others the default order', () => {
    expect(order('student')[0]).toBe('K');
    expect(order('working_job')[0]).toBe('W');
    expect(order('self_employed_business')[0]).toBe('W');
    expect(order('homemaker')).toEqual(['H', 'L', 'W', 'K']);
  });
});

describe('pruneAnswers', () => {
  const tc = iaCase('Worked example A'); // female, partner, B only
  const ctx = contextOf(IA, tc);

  it('partner → solo removes partner items, the partner core and hidden gate choices', () => {
    const { answers, removed } = pruneAnswers(IA, ctx, { ...tc.answers, I6: 'i_do_not_have_a_partner_right_now' });
    expect(removed).toEqual(expect.arrayContaining(['C1', 'C11', 'B1', 'G1']));
    expect(answers.G1).toBeUndefined(); // B was the only choice and is hidden on the solo path
    expect(Object.keys(answers).some((q) => q.startsWith('B'))).toBe(false);
  });

  it('solo → partner removes the solo core', () => {
    const solo = iaCase('Worked example E');
    const { removed } = pruneAnswers(IA, contextOf(IA, solo), { ...solo.answers, I6: 'yes_and_they_are_willing_to_join_sessions' });
    expect(removed).toEqual(expect.arrayContaining(['CS1', 'CS9']));
  });

  it('changing the gate removes the old module answers', () => {
    const { answers, removed } = pruneAnswers(IA, ctx, { ...tc.answers, G1: ['A'] });
    expect(removed).toEqual(expect.arrayContaining(['B1', 'B8']));
    expect(answers.G1).toEqual(['A']);
  });
});

describe('interrupts, crisis, safety, age stop', () => {
  it('CRISIS fires as soon as the self-harm question is answered yes', () => {
    const ctx = female30;
    expect(checkInterrupts(IA, ctx, { I6: 'no_they_do_not_know' })).toEqual([]);
    expect(checkInterrupts(IA, ctx, { R5: 'yes' }).map((f) => f.key)).toEqual(['CRISIS']);
    expect(checkInterrupts(MA, ctx, { MR5: 'yes' }).map((f) => f.key)).toEqual(['CRISIS']);
  });

  it('crisis layout hides the plan but stores the tier', () => {
    const tc = iaCase('Worked example F');
    const r = score(IA, contextOf(IA, tc), tc.answers);
    expect(r.layout).toBe('crisis');
    expect(r.report.plan).toBeNull();
    expect(r.report.hidden.length).toBeGreaterThan(0);
    expect(r.report.blocks[0]).toBe(IA.report_rules.layouts.crisis.top_block);
    expect(r.report.nextStep).toBe(IA.report_rules.layouts.crisis.next_key);
    expect(r.tier).toBe(12);
  });

  it('SAFETY forces individual (and beats the couple rule)', () => {
    const tc = iaCase('SAFETY_BEATS_COUPLE');
    const r = score(IA, contextOf(IA, tc), tc.answers);
    expect(r.format).toMatchObject({ type: 'individual', source: { kind: 'flag', key: 'SAFETY' } });
  });

  it('the first forcing flag in sort order wins', () => {
    const tc = iaCase('T7_RARELY');
    const r = score(IA, contextOf(IA, tc), { ...tc.answers, R6: 'yes' });
    expect(r.flags.map((f) => f.key)).toEqual(['SAFETY', 'RELATIONSHIP_SAFETY_CHECK']);
    expect(r.format?.source).toEqual({ kind: 'flag', key: 'SAFETY' });
  });

  it('AGE_STOP fires on under 18 and score refuses', () => {
    const tc = iaCase('Worked example A');
    const minor: EngineContext = { sex: 'Female', age: 16, mode: 'initial' };
    expect(checkInterrupts(IA, minor, {}).map((f) => f.key)).toEqual(['AGE_STOP']);
    expect(() => score(IA, minor, tc.answers)).toThrow(AssessmentStoppedError);
  });

  it('score refuses an incomplete assessment and lists the missing questions', () => {
    const tc = iaCase('Worked example A');
    const { R6: _r6, D2: _d2, ...partial } = tc.answers;
    void _r6;
    void _d2;
    try {
      score(IA, contextOf(IA, tc), partial);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IncompleteAssessmentError);
      expect((err as IncompleteAssessmentError).missing).toEqual(['D2', 'R6']);
    }
  });
});

describe('overrides in isolation', () => {
  it('all mild caps the tier', () => {
    const tc = iaCase('Worked example A');
    const r = score(IA, contextOf(IA, tc), {
      ...tc.answers, D1: 'more_than_3_years', D2: 'severely', D3: 'tried_many_things_nothing_worked',
    });
    expect([r.points?.total, r.tierBeforeOverrides, r.tier]).toEqual([8, 8, 6]);
    expect(r.overridesApplied).toEqual([{ key: 'ALL_MILD', from: 8, to: 6 }]);
  });

  it('severe + long raises the tier', () => {
    const tc = maCase('Worked example E');
    const r = score(MA, contextOf(MA, tc), tc.answers);
    expect([r.tierBeforeOverrides, r.tier]).toEqual([6, 8]);
    expect(r.overridesApplied).toEqual([{ key: 'SEVERE_LONG', from: 6, to: 8 }]);
  });

  it('a High trust wound raises the tier', () => {
    const tc = iaCase('Worked example A');
    let a: Answers = { ...tc.answers, G1: ['G'], D1: 'less_than_3_months', D2: 'not_at_all', D3: 'nothing_yet' };
    a = pruneAnswers(IA, female30, a).answers;
    a = setModuleSum(IA, a, 'G', 16, 'partner');
    a = complete(IA, female30, { ...a, T7: 'often', T8: 'often', T1: 'yes' }); // G 14/18 = 78% High
    const r = score(IA, contextOf(IA, tc), a);
    expect(r.modules.G.band).toBe('High');
    expect([r.points?.total, r.tierBeforeOverrides, r.tier]).toEqual([4, 4, 8]);
    expect(r.overridesApplied).toEqual([{ key: 'TRUST_WOUND_HIGH', from: 4, to: 8 }]);
  });
});

describe('format', () => {
  it('mixed: couple + individual module with a willing partner, split by tier', () => {
    const tc = iaCase('Worked example B'); // male, A
    const ctx = contextOf(IA, tc);
    let a: Answers = { ...tc.answers, G1: ['A', 'C'] };
    a = setModuleSum(IA, a, 'C', 10, 'partner');
    a = complete(IA, ctx, { ...a, M4: 'often', M10: 'slowly_over_months', R4: 'no' });
    const r = score(IA, ctx, a);
    expect(r.format?.type).toBe('mixed');
    const split = IA.format_rules.find((f) => f.key === 'MIXED')!.split![String(r.tier)];
    expect(r.format?.split).toEqual({ individual: split[0], couple: split[1] });
    expect(r.report.plan?.formatTextKey).toBe(IA.report_rules.format_texts.mixed);
  });

  it('PARENT_LINE for Mind K at 18–24 only', () => {
    const tc = maCase('Worked example B');
    expect(score(MA, contextOf(MA, tc), tc.answers).format?.addTextKeys).toEqual(['PARENT_LINE']);
    const older = score(MA, { ...contextOf(MA, tc), age: 26 }, { ...tc.answers, MI1: '25_34' });
    expect(older.format?.addTextKeys).toEqual([]);
  });
});

describe('progress mode', () => {
  const first = (): AssessmentResult => {
    const tc = iaCase('Worked example B'); // A 67%, core 39%
    return score(IA, contextOf(IA, tc), tc.answers);
  };

  it('classifies change at −10, −9, +9, +10', () => {
    const f = first();
    const at = (now: number) => compareProgress(IA, f, { ...f, modules: { ...f.modules, A: { ...f.modules.A, percent: now } } });
    const a = f.modules.A.percent!;
    expect([a - 10, a - 9, a + 9, a + 10].map((n) => at(n).areas.find((x) => x.module === 'A')!.classification)).toEqual([
      'better', 'same', 'same', 'worse',
    ]);
    expect(at(a - 10).areas.find((x) => x.module === 'A')!.textKey).toBe(IA.scoring.progress.texts.better);
  });

  it('asks only the configured items and compares the same areas', () => {
    const f = first();
    const ctx: EngineContext = { sex: 'Male', age: 36, mode: 'progress', firstResult: f };
    const flow = getFlow(IA, ctx, {});
    const asked = new Set(flow.filter((i) => !i.prefilled).map((i) => i.module));
    expect([...asked].sort()).toEqual(['A', 'CORE', 'DOSE', 'FLAG']);
    expect(flow.filter((i) => i.module === 'DOSE' || i.module === 'FLAG').map((i) => i.qid)).toEqual(IA.scoring.progress.items.qids);
    let a: Answers = setModuleSum(IA, {}, 'A', 14, 'partner');
    a = complete(IA, ctx, setModuleSum(IA, a, 'CORE', 13, 'partner'));
    const progress = score(IA, ctx, a);
    expect([progress.mode, progress.tier, progress.points]).toEqual(['progress', null, null]);
    const cmp = compareProgress(IA, f, progress);
    expect(cmp.areas.map((x) => [x.module, x.change, x.classification])).toEqual([
      ['CORE', 0, 'same'],
      ['A', 58 - 67, 'same'],
    ]);
  });
});

describe('Task 03b behaviour', () => {
  it('unprinted flags go to counsellor tags, not the report', () => {
    const tc = iaCase('C11_OFTEN');
    const r = score(IA, contextOf(IA, tc), tc.answers);
    expect(r.counsellor.tags).toContain('SEPARATION_THOUGHTS');
    expect(r.report.blocks).toEqual([]);
  });

  it('notify recipients are passed through', () => {
    const tc = maCase('CRISIS_NOTIFY');
    const r = score(MA, contextOf(MA, tc), tc.answers);
    expect(r.notify).toEqual([{ flag: 'CRISIS', recipients: ['coordinator', 'counsellor'] }]);
  });

  it('interpretation fallback none prints nothing for a module without a text', () => {
    const tc = iaCase('LOW_MODULE_FALLBACK');
    const none = structuredClone(IA);
    none.report_rules.interpretation.fallback = 'none';
    const r = score(none, contextOf(none, tc), tc.answers);
    expect(r.report.interpretation).toEqual(['INTERP_CORE_MILD']); // the core line only
    expect(r.warnings.map((w) => w.code)).toContain('NO_INTERPRETATION_TEXT');
  });
});

describe('report texts', () => {
  const tc = iaCase('Worked example C');
  const result = score(IA, contextOf(IA, tc), tc.answers);

  it('resolves every key from the version texts', () => {
    const texts = resolveReportTexts(IA, result, 'both');
    expect(texts.warnings).toEqual([]);
    expect(texts.interpretation.every((t) => t?.en && t?.hi)).toBe(true);
    expect(texts.plan?.name?.en).toBe(IA.tiers.find((t) => t.sessions === result.tier)!.plan_en);
  });

  it('a missing text gives null and a warning, never invented text', () => {
    const broken = structuredClone(IA);
    broken.texts = broken.texts.filter((t) => t.key !== result.report.tone);
    const texts = resolveReportTexts(broken, result, 'en');
    // The closing tone is also the next step in the standard layout: both are null, nothing is filled in.
    expect(result.report.nextStep).toBe(result.report.tone);
    expect([texts.tone, texts.nextStep]).toEqual([null, null]);
    const warning = { code: 'TEXT_MISSING', message: `No text with key ${result.report.tone}.` };
    expect(texts.warnings).toEqual([warning, warning]);
  });
});

describe('determinism and purity', () => {
  it('same input twice gives identical JSON', () => {
    const tc = iaCase('Worked example D');
    const ctx = contextOf(IA, tc);
    expect(JSON.stringify(score(IA, ctx, tc.answers))).toBe(JSON.stringify(score(IA, ctx, tc.answers)));
  });

  it('unknown facts and operators throw', () => {
    const facts = buildFacts(IA, female30, {});
    expect(() => evaluateCondition({ fact: 'mood' } as never, facts)).toThrow(/unknown condition fact/);
    expect(() => evaluateCondition({ fact: 'age', op: 'between', value: 3 } as never, facts)).toThrow(/unknown operator/);
    expect(() => evaluateCondition({ fact: 'answer', q: 'NOPE', op: 'eq', value: 'x' }, facts)).toThrow(/unknown question/);
  });
});

describe('config-free guard', () => {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const source = readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(srcDir + f, 'utf8')] as const);

  it('no question ids in the engine source', () => {
    const qid = /\b(I|G|C|CS|M|A|B|D|E|F|T|R|MI|MG|MC|MD|MR|H|L|W|K)\d{1,2}\b/;
    for (const [file, text] of source) expect(text.match(qid)?.[0], file).toBeUndefined();
  });

  it('no report sentences, module codes or flag keys in the engine source', () => {
    const configs = [IA, MA];
    const needles = new Set<string>();
    for (const c of configs) {
      for (const t of c.texts) needles.add(t.text_en.slice(0, 30));
      for (const t of c.item_texts) needles.add(t.text_en.slice(0, 30));
      for (const f of c.flags) needles.add(`'${f.key}'`);
      for (const m of c.modules) if (m.code.length > 1) needles.add(`'${m.code}'`);
    }
    for (const [file, text] of source) {
      for (const n of needles) expect(text.includes(n), `${file} contains ${n}`).toBe(false);
    }
  });
});
