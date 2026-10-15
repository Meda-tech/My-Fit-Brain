import type { TestCase, VersionConfig } from '@mfb/questionbank';
import { score } from './score';
import type { AssessmentResult, Sex, TestCaseDiff, TestCaseRun } from './types';

// Runs a stored test case and compares the result with its expectations.

export function runTestCase(config: VersionConfig, testCase: Pick<TestCase, 'context' | 'answers' | 'expected'>): TestCaseRun {
  const reg = config.scoring.registration;
  // Test cases store gender as the sex question's option code; registration uses the label.
  const sex = Object.entries(reg.sex_options).find(([, code]) => code === testCase.context.sex)?.[0] as Sex | undefined;
  if (!sex) {
    return { passed: false, actual: null, diffs: [], error: `Test case gender "${testCase.context.sex}" is not a registration option.` };
  }

  let actual: AssessmentResult;
  try {
    actual = score(config, { sex, age: testCase.context.age, mode: 'initial' }, testCase.answers);
  } catch (err) {
    return { passed: false, actual: null, diffs: [], error: err instanceof Error ? err.message : String(err) };
  }

  const diffs = compareResult(actual, testCase.expected, testCase.context.path);
  return { passed: diffs.length === 0, actual, diffs, error: null };
}

/** Differences between a result and a test case's expectations (empty = matches). */
export function compareResult(
  actual: AssessmentResult,
  e: TestCase['expected'],
  expectedPath?: 'partner' | 'solo' | null
): TestCaseDiff[] {
  const diffs: TestCaseDiff[] = [];
  const check = (field: string, expected: unknown, got: unknown) => {
    if (JSON.stringify(expected) !== JSON.stringify(got)) diffs.push({ field, expected, actual: got });
  };

  const bands = Object.fromEntries(Object.entries(actual.modules).map(([m, r]) => [m, r.band]));
  check('bands', sortKeys(e.bands), sortKeys(bands));
  check('primary', e.primary, actual.primary);
  const breakdown = Object.fromEntries((actual.points?.breakdown ?? []).map((b) => [b.key, b.points]));
  for (const [key, value] of Object.entries(e.points)) {
    if (key === 'TOTAL') check('points.TOTAL', value, actual.points?.total ?? null);
    else check(`points.${key}`, value, breakdown[key] ?? null);
  }
  check('tier', e.tier, actual.tier);
  check('format', e.format, actual.format?.type ?? null);
  check('flags', [...e.flags].sort(), actual.flags.map((f) => f.key).sort());
  check('layout', e.layout, actual.layout);
  if (e.extra_text_keys) check('extra_text_keys', e.extra_text_keys, actual.format?.addTextKeys ?? []);
  if (e.interpretation_keys) check('interpretation_keys', e.interpretation_keys, actual.report.interpretation);
  if (e.notify) check('notify', [...e.notify].sort(), [...new Set(actual.notify.flatMap((n) => n.recipients))].sort());
  if (expectedPath) check('path', expectedPath, actual.path);

  return diffs;
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}
