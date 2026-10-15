import { describe, expect, it } from 'vitest';
import { SEED_RULES, SEED_TEST_CASES } from '../seeds/index';
import { conditionSchema } from '../src/conditions';
import { toImportSql } from '../src/import';
import { seedRulesSchema, seedTestCasesSchema } from '../src/rules';
import { prepareBank } from './helpers';

describe('seed rule files', () => {
  it.each(Object.keys(SEED_RULES))('%s passes the zod schema', (key) => {
    const result = seedRulesSchema.safeParse(SEED_RULES[key]);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it.each(Object.keys(SEED_TEST_CASES))('%s test cases pass the zod schema', (key) => {
    const result = seedTestCasesSchema.safeParse(SEED_TEST_CASES[key]);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });
});

describe('full import payload (workbook + seed rules + test cases)', async () => {
  const ia = await prepareBank('IA');
  const ma = await prepareBank('MA');

  it.each([
    ['IA', ia],
    ['MA', ma],
  ])('%s: rules attach from the seed and every reference resolves', (_test, prepared) => {
    expect(prepared.errors).toEqual([]);
    expect(prepared.source?.kind).toBe('seed');
    // Validation covers every qid, option code, module, flag and text key used by the rules.
    expect(prepared.issues).toEqual([]);
    expect(prepared.ok).toBe(true);
  });

  it('module kinds come from the seed', () => {
    const kinds = Object.fromEntries(ia.payload!.modules.map((m) => [m.code, m.kind]));
    expect(kinds).toMatchObject({ CORE: 'core', SOLO_CORE: 'solo_core', A: 'couple', B: 'couple', G: 'couple', C: 'individual', F: 'individual' });
    expect(ma.payload!.modules.find((m) => m.code === 'MCORE')!.kind).toBe('core');
  });

  it('protected questions and flags are marked', () => {
    expect(ia.payload!.questions.filter((q) => q.is_protected).map((q) => q.qid)).toEqual(['I1', 'G1', 'R5', 'R6']);
    expect(ma.payload!.questions.filter((q) => q.is_protected).map((q) => q.qid)).toEqual(['MI1', 'MG1', 'MR5', 'MR6']);
    for (const p of [ia.payload!, ma.payload!]) {
      expect(p.flags.filter((f) => f.is_protected).map((f) => f.key)).toEqual(['AGE_STOP', 'CRISIS', 'SAFETY']);
    }
  });

  it('worked examples become unverified test cases with complete answer sets', () => {
    expect(ia.payload!.test_cases.map((t) => t.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'].map((c) => `Worked example ${c}`));
    expect(ma.payload!.test_cases).toHaveLength(5);
    for (const p of [ia.payload!, ma.payload!]) {
      for (const tc of p.test_cases) {
        expect(tc.source).toBe('worked_example');
        expect(tc.verified).toBe(false);
        // Every intake, dose and always-shown flag question is answered.
        for (const q of p.questions.filter((x) => ['INTAKE', 'DOSE'].includes(x.module_code))) {
          expect(tc.answers[q.qid], `${tc.name} ${q.qid}`).toBeDefined();
        }
      }
    }
    const f = ia.payload!.test_cases.find((t) => t.name === 'Worked example F')!;
    expect(f.answers.R5).toBe('yes');
    expect(f.expected).toMatchObject({ flags: ['CRISIS'], layout: 'crisis', tier: 12 });
    const c = ma.payload!.test_cases.find((t) => t.name === 'Worked example C')!;
    expect(c.answers.MC7).toBe('never');
    expect(c.expected.points.ISOLATION).toBe(1);
  });

  it('expected points add up to the total and tiers match the workbook', () => {
    for (const p of [ia.payload!, ma.payload!]) {
      for (const tc of p.test_cases) {
        const { TOTAL, ...parts } = tc.expected.points;
        expect(Object.values(parts).reduce((a, v) => a + v, 0), tc.name).toBe(TOTAL);
      }
    }
  });

  it('exports as one SQL statement for the SQL Editor', () => {
    const sql = toImportSql(ia.payload!);
    expect(sql).toMatch(/^-- Import IA 1\.1/);
    expect(sql).toContain('select public.qb_import_version($qbjson$');
    expect(sql.trim().endsWith('$qbjson$::jsonb) as version_id;')).toBe(true);
  });
});

describe('condition schema', () => {
  it('accepts every documented shape', () => {
    const ok = [
      { all: [] },
      { not: { fact: 'flag', key: 'SAFETY' } },
      { fact: 'answer', q: 'I6', op: 'in', value: ['a', 'b'] },
      { fact: 'answered_any_except', q: 'R1', value: ['none_of_these'] },
      { fact: 'count_bands', scope: 'chosen', op: 'gte', value: 'Moderate', count: 2 },
      { fact: 'chosen_kinds', op: 'only', value: ['couple'] },
      { fact: 'band', module: 'primary', op: 'eq', value: 'High' },
    ];
    for (const c of ok) expect(conditionSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
  });

  it('rejects unknown facts, operators and extra keys', () => {
    const bad = [
      { fact: 'mood', op: 'eq', value: 1 },
      { fact: 'answer', q: 'C1', op: 'gt', value: 'often' },
      { fact: 'band', module: 'A', op: 'eq', value: 'Severe' },
      { any: [] },
      { fact: 'flag', key: 'CRISIS', extra: true },
    ];
    for (const c of bad) expect(conditionSchema.safeParse(c).success, JSON.stringify(c)).toBe(false);
  });
});
