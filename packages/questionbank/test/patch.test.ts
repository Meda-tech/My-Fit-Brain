import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEED_TESTS } from '../seeds/index';
import { prepareImport } from '../src/import';
import { applyPatch, patchSchema, patchToSql, PatchError, type VersionPatch } from '../src/patch';
import { flagSchema, formatRuleSchema, reportRulesSchema, scoringSchema, testCaseSchema } from '../src/rules';
import { compareVersionLabels } from '../src/version-label';
import { validatePayload } from '../src/validate';
import { FILES, prepareBank, readBank } from './helpers';

const patchDir = fileURLToPath(new URL('../patches/', import.meta.url));
const loadPatch = (name: string): VersionPatch => patchSchema.parse(JSON.parse(readFileSync(patchDir + name, 'utf8')));

describe('version patches (offline)', async () => {
  const iaBase = (await prepareBank('IA')).payload!;
  const maBase = (await prepareBank('MA')).payload!;
  const ctx = {
    resolveText: (test: string, key: string) => (test === 'MA' ? maBase : iaBase).texts.find((t) => t.key === key) ?? null,
  };
  const iaPatch = loadPatch('IA-1.2.patch.json');
  const maPatch = loadPatch('MA-1.1.patch.json');
  const ia = applyPatch(iaBase, iaPatch, ctx);
  const ma = applyPatch(maBase, maPatch, ctx);

  it('every operation names a decision', () => {
    for (const p of [iaPatch, maPatch]) for (const op of p.operations) expect(op.decision).toMatch(/^D\d+$/);
  });

  it.each([
    ['IA 1.2', () => ia, () => iaBase],
    ['MA 1.1', () => ma, () => maBase],
  ])('%s passes the zod schemas and validation with zero issues', (_name, get, base) => {
    const p = get();
    expect(scoringSchema.safeParse(p.scoring).success).toBe(true);
    expect(reportRulesSchema.safeParse(p.report_rules).success).toBe(true);
    for (const f of p.flags) expect(flagSchema.safeParse(f).success, f.key).toBe(true);
    for (const r of p.format_rules) expect(formatRuleSchema.safeParse(r).success, r.key).toBe(true);
    for (const t of p.test_cases) expect(testCaseSchema.safeParse(t).success, t.name).toBe(true);
    // Validated against the version it is based on (protected questions and flags).
    expect(validatePayload(p, base())).toEqual([]);
  });

  it('IA 1.2 applies D2, D4, D5, D6, D8, D12, D13, D16, D19', () => {
    expect(ia.version_label).toBe('1.2');
    expect(ia.options.filter((o) => o.exclusive).map((o) => `${o.qid}.${o.option_code}`)).toEqual(['R1.none_of_these']);
    expect(ia.questions.filter((q) => ['R2', 'R3', 'R4', 'R5', 'R6'].includes(q.qid)).every((q) => q.scored === 'no')).toBe(true);
    expect(ia.flags.map((f) => f.key)).toEqual([
      'AGE_STOP', 'CRISIS', 'SAFETY', 'MED_MALE', 'MED_FEMALE', 'MED_ONSET', 'MED_GENERAL', 'NRI', 'MIND_LED_PATTERN',
      'SEPARATION_THOUGHTS', 'RELATIONSHIP_SAFETY_CHECK', 'LOW_REPAIR_MOTIVATION',
    ]);
    expect(ia.flags.map((f) => f.sort)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const onset = ia.texts.find((t) => t.key === 'MED_ONSET')!;
    const maOnset = maBase.texts.find((t) => t.key === 'MED_ONSET')!;
    expect([onset.text_en, onset.text_hi]).toEqual([maOnset.text_en, maOnset.text_hi]);
    for (const key of ['CRISIS', 'SAFETY']) {
      expect(ia.flags.find((f) => f.key === key)!.effects.notify).toEqual(['coordinator', 'counsellor']);
    }
    for (const key of ['RELATIONSHIP_SAFETY_CHECK', 'LOW_REPAIR_MOTIVATION']) {
      expect(ia.flags.find((f) => f.key === key)!.effects).toMatchObject({ force_format: 'individual', printed: false });
    }
    expect(ia.scoring.gate).toEqual({ qid: 'G1', max_choices: 2, min_choices: 1 });
    expect(ia.format_rules.at(-1)).toMatchObject({ key: 'DEFAULT_INDIVIDUAL', condition: { all: [] }, format: 'individual' });
    expect(ia.report_rules.interpretation.fallback).toBe('core');
    expect(ia.texts).toHaveLength(iaBase.texts.length + 1);
  });

  it('MA 1.1 applies D2, D12, D13, D19', () => {
    expect(ma.options.filter((o) => o.exclusive).map((o) => `${o.qid}.${o.option_code}`)).toEqual(['MR1.none_of_these']);
    expect(ma.scoring.gate).toEqual({ qid: 'MG1', max_choices: 2, min_choices: 1 });
    expect(ma.report_rules.interpretation.fallback).toBe('core');
    for (const key of ['CRISIS', 'SAFETY']) {
      expect(ma.flags.find((f) => f.key === key)!.effects.notify).toEqual(['coordinator', 'counsellor']);
    }
    expect(ma.flags).toHaveLength(maBase.flags.length);
  });

  it('test cases: worked examples kept, Worked example D adjusted, new manual cases added', () => {
    expect(ia.test_cases).toHaveLength(12);
    expect(ma.test_cases).toHaveLength(7);
    const d = ia.test_cases.find((t) => t.name === 'Worked example D')!;
    expect(d.answers.T7).toBe('sometimes');
    expect(d.expected).toEqual(iaBase.test_cases.find((t) => t.name === 'Worked example D')!.expected);
    expect(ia.test_cases.filter((t) => t.source === 'manual').map((t) => t.name)).toEqual([
      'T7_RARELY', 'T8_NEVER', 'R2_PNS_ONSET', 'C11_OFTEN', 'LOW_MODULE_FALLBACK', 'SAFETY_BEATS_COUPLE',
    ]);
    expect(ma.test_cases.filter((t) => t.source === 'manual').map((t) => t.name)).toEqual(['LOW_MODULE_FALLBACK', 'CRISIS_NOTIFY']);
    const t8 = ia.test_cases.find((t) => t.name === 'T8_NEVER')!;
    expect([t8.answers.T7, t8.answers.T8]).toEqual(['often', 'never']);
  });

  it('a protected flag may gain effects but not lose them', () => {
    const weakened = structuredClone(ia);
    weakened.flags.find((f) => f.key === 'SAFETY')!.effects = { report_block: 'SAFETY' };
    expect(validatePayload(weakened, iaBase).map((i) => i.code)).toContain('protected_changed');
  });

  it('rejects patches that do not fit the payload', () => {
    expect(() => applyPatch(maBase, iaPatch, ctx)).toThrow(PatchError);
    const bad = structuredClone(iaPatch);
    bad.operations = [{ op: 'set_question', decision: 'D16', qid: 'NOPE', set: { scored: 'no' } }];
    expect(() => applyPatch(iaBase, bad, ctx)).toThrow(/Operation 1 \(set_question, D16\): question NOPE not found/);
  });

  it('generates one DO block that copies, patches, validates and optionally submits (never publishes)', () => {
    const sql = patchToSql(iaPatch, { submit: true });
    expect(sql).toContain("v := public.qb_start_new_version('IA', '1.2');");
    expect(sql).toContain('PERFORM public.qb_raise_if_invalid(v);');
    expect(sql).toContain('PERFORM public.qb_submit_for_review(v);');
    expect(sql).not.toContain('qb_publish');
    expect(sql.match(/-- \d+\. D\d+:/g)).toHaveLength(iaPatch.operations.length);
    expect(patchToSql(maPatch)).not.toContain('qb_submit_for_review');
  });
});

describe('import guard: older or equal version', () => {
  it('compares labels numerically', () => {
    expect(compareVersionLabels('1.10', '1.2')).toBeGreaterThan(0);
    expect(compareVersionLabels('1.1', '1.1.0')).toBe(0);
    expect(compareVersionLabels('1.1', '1.2')).toBeLessThan(0);
  });

  it('blocks importing 1.1 when 1.2 exists, unless forced', async () => {
    const opts = { fileName: FILES.IA, tests: SEED_TESTS, latestLabel: async () => '1.2' };
    const blocked = await prepareImport(readBank('IA'), opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0]).toMatch(/would replace decisions made in later versions; start a new version instead/);
    const forced = await prepareImport(readBank('IA'), { ...opts, force: true });
    expect(forced.payload).not.toBeNull();
    expect(forced.warnings.some((w) => w.startsWith('Forced:'))).toBe(true);
  });
});
