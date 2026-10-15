import { describe, expect, it } from 'vitest';
import { runTestCase } from '../src/test-cases';
import { loadBanks } from './helpers';

// Every stored test case of the live versions (11 Worked Examples + 8 Task 03b cases) must pass.
// The base versions (IA 1.1, MA 1.0) keep their own 11 Worked Examples, which must also still pass.

const banks = await loadBanks();

describe.each([
  ['IA 1.2 (live)', banks.IA.live, 12],
  ['MA 1.1 (live)', banks.MA.live, 7],
])('%s test cases', (_name, config, count) => {
  const payload = config === banks.IA.live ? banks.IA.livePayload : banks.MA.livePayload;
  it('has the expected number of cases', () => {
    expect(payload.test_cases).toHaveLength(count);
  });
  it.each(payload.test_cases.map((tc) => [tc.name, tc] as const))('%s', (_n, tc) => {
    const run = runTestCase(config, tc);
    expect(run.error).toBeNull();
    expect(run.diffs).toEqual([]);
    expect(run.passed).toBe(true);
  });
});

describe('base versions keep their Worked Examples', () => {
  it.each([
    ['IA 1.1', banks.IA],
    ['MA 1.0', banks.MA],
  ])('%s', (_n, bank) => {
    // The base payload's own cases (IA Worked example D still answers T7 = Rarely there).
    const worked = bank.basePayload.test_cases;
    expect(worked.every((t) => t.source === 'worked_example')).toBe(true);
    for (const tc of worked) {
      const run = runTestCase(bank.base, tc);
      expect({ name: tc.name, error: run.error, diffs: run.diffs }).toEqual({ name: tc.name, error: null, diffs: [] });
    }
  });

  it('IA Worked example D with T7 = Rarely fails on 1.2 (the Task 03b reason for the change)', () => {
    const original = banks.IA.basePayload.test_cases.find((t) => t.name === 'Worked example D')!;
    expect(original.answers.T7).toBe('rarely');
    const run = runTestCase(banks.IA.live, original);
    expect(run.diffs).toEqual([
      { field: 'format', expected: 'couple', actual: 'individual' },
      { field: 'flags', expected: [], actual: ['RELATIONSHIP_SAFETY_CHECK'] },
    ]);
  });
});
