import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SEED_TESTS,
  applyPatch,
  configFromPayload,
  patchSchema,
  type ImportPayload,
  type TestCase,
  type VersionConfig,
} from '@mfb/questionbank';
import { prepareImport } from '@mfb/questionbank/import';
import type { Answers, EngineContext } from '../src/types';

// Builds the same configurations as the testing database, offline: the workbook + seed rules gives the
// base version (IA 1.1, MA 1.0) and the Task 03b patch gives the live one (IA 1.2, MA 1.1).

const root = fileURLToPath(new URL('../../../', import.meta.url));
const WORKBOOKS = {
  IA: 'docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v1.1_1.xlsx',
  MA: 'docs/questionbank/MFB_Mind_Assessment_QuestionBank_v1.0_1.xlsx',
} as const;
const PATCHES = { IA: 'IA-1.2.patch.json', MA: 'MA-1.1.patch.json' } as const;

async function basePayload(test: 'IA' | 'MA'): Promise<ImportPayload> {
  const file = root + WORKBOOKS[test];
  const prepared = await prepareImport(readFileSync(file), { fileName: file, tests: SEED_TESTS });
  if (!prepared.payload) throw new Error(`could not build ${test}: ${prepared.errors.join('; ')}`);
  return prepared.payload;
}

export interface Bank {
  base: VersionConfig;
  live: VersionConfig;
  basePayload: ImportPayload;
  livePayload: ImportPayload;
}

export async function loadBanks(): Promise<{ IA: Bank; MA: Bank }> {
  const ia = await basePayload('IA');
  const ma = await basePayload('MA');
  const ctx = { resolveText: (t: string, key: string) => (t === 'MA' ? ma : ia).texts.find((x) => x.key === key) ?? null };
  const patched = (test: 'IA' | 'MA', base: ImportPayload) =>
    applyPatch(base, patchSchema.parse(JSON.parse(readFileSync(root + 'packages/questionbank/patches/' + PATCHES[test], 'utf8'))), ctx);
  const iaLive = patched('IA', ia);
  const maLive = patched('MA', ma);
  return {
    IA: { base: configFromPayload(ia, { status: 'retired' }), live: configFromPayload(iaLive, { status: 'live' }), basePayload: ia, livePayload: iaLive },
    MA: { base: configFromPayload(ma, { status: 'retired' }), live: configFromPayload(maLive, { status: 'live' }), basePayload: ma, livePayload: maLive },
  };
}

export function testCase(payload: ImportPayload, name: string): TestCase {
  const tc = payload.test_cases.find((t) => t.name === name);
  if (!tc) throw new Error(`no test case ${name}`);
  return structuredClone(tc);
}

/** Engine context of a stored test case. */
export function contextOf(config: VersionConfig, tc: Pick<TestCase, 'context'>): EngineContext {
  const sex = Object.entries(config.scoring.registration.sex_options).find(([, c]) => c === tc.context.sex)![0];
  return { sex: sex as EngineContext['sex'], age: tc.context.age, mode: 'initial' };
}

/** Sets the answers of a module so that its scored items add up to `sum` (spread evenly). */
export function setModuleSum(config: VersionConfig, answers: Answers, module: string, sum: number, path: string | null): Answers {
  const out = { ...answers };
  const items = config.questions.filter(
    (q) => q.module_code === module && q.scored === 'yes' && q.type === 'likert' && (q.path === 'all' || q.path === path)
  );
  const yn = config.questions.filter((q) => q.module_code === module && q.scored === 'yes' && q.type === 'yn' && (q.path === 'all' || q.path === path));
  for (const q of yn) out[q.qid] = q.reverse ? 'yes' : 'no';
  const codes = ['never', 'rarely', 'sometimes', 'often'];
  const base = Math.floor(sum / items.length);
  let extra = sum - base * items.length;
  if (base > 3 || (base === 3 && extra > 0)) throw new Error(`${module}: ${sum} is too high`);
  for (const q of items) {
    const score = base + (extra-- > 0 ? 1 : 0);
    out[q.qid] = codes[q.reverse ? 3 - score : score];
  }
  return out;
}
