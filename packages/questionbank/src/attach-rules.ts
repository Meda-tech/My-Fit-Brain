import { SEED_RULES, SEED_TEST_CASES } from '../seeds/index';
import { seedRulesSchema, seedTestCasesSchema, type TestCase } from './rules';
import type { ContentPayload, ImportPayload, QbModule, RulesPayload, RulesSource } from './types';

// Adds rules (and test cases) to a parsed workbook: from the matching seed file when one exists,
// otherwise copied from the latest version of that test in the database.

export interface LatestVersionRules extends RulesPayload {
  version_id: string;
  version_label: string;
  modules: Pick<QbModule, 'code' | 'kind'>[];
  protected_questions: string[];
  test_cases: TestCase[];
}

export interface AttachResult {
  payload: ImportPayload | null;
  source: RulesSource | null;
  errors: string[];
  warnings: string[];
}

export async function attachRules(
  content: ContentPayload,
  options: {
    /** Loads the latest version's rules for this test, or null when there is none. */
    loadLatest?: (testCode: string) => Promise<LatestVersionRules | null>;
    changeNote?: string | null;
  } = {}
): Promise<AttachResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seedKey = `${content.test_code}-${content.version_label}`;

  let rules: RulesPayload;
  let moduleKinds: Record<string, QbModule['kind']>;
  let protectedQuestions: string[];
  let testCases: TestCase[];
  let source: RulesSource;

  if (SEED_RULES[seedKey]) {
    const parsed = seedRulesSchema.safeParse(SEED_RULES[seedKey]);
    if (!parsed.success) {
      return {
        payload: null,
        source: null,
        errors: parsed.error.issues.map((i) => `Seed ${seedKey}.rules.json: ${i.path.join('.')} — ${i.message}`),
        warnings,
      };
    }
    const seed = parsed.data;
    rules = {
      scoring: seed.scoring,
      point_rules: seed.point_rules,
      overrides: seed.overrides,
      visibility_rules: seed.visibility_rules,
      option_rules: seed.option_rules,
      flags: seed.flags,
      format_rules: seed.format_rules,
      report_rules: seed.report_rules,
    };
    moduleKinds = seed.module_kinds;
    protectedQuestions = seed.protected.questions;
    for (const key of seed.protected.flags) {
      const flag = rules.flags.find((f) => f.key === key);
      if (flag && !flag.is_protected) errors.push(`Seed ${seedKey}: flag ${key} is listed as protected but is_protected is false.`);
    }
    const cases = SEED_TEST_CASES[seedKey] ? seedTestCasesSchema.safeParse(SEED_TEST_CASES[seedKey]) : null;
    if (cases && !cases.success) {
      errors.push(...cases.error.issues.map((i) => `Seed ${seedKey}.test-cases.json: ${i.path.join('.')} — ${i.message}`));
    }
    testCases = cases?.success ? cases.data.test_cases : [];
    source = { kind: 'seed', file: `${seedKey}.rules.json` };
  } else {
    const latest = options.loadLatest ? await options.loadLatest(content.test_code) : null;
    if (!latest) {
      return {
        payload: null,
        source: null,
        errors: [
          `No seed rules file for ${seedKey} and no earlier ${content.test_code} version to copy rules from.`,
        ],
        warnings,
      };
    }
    rules = {
      scoring: latest.scoring,
      point_rules: latest.point_rules,
      overrides: latest.overrides,
      visibility_rules: latest.visibility_rules,
      option_rules: latest.option_rules,
      flags: latest.flags,
      format_rules: latest.format_rules,
      report_rules: latest.report_rules,
    };
    moduleKinds = Object.fromEntries(latest.modules.map((m) => [m.code, m.kind]));
    protectedQuestions = latest.protected_questions;
    testCases = latest.test_cases.map((tc) => ({ ...tc, verified: false }));
    source = { kind: 'copied', from_version_id: latest.version_id, from_version_label: latest.version_label };
    warnings.push(`Rules copied from version ${latest.version_label}. Check them against this workbook before publishing.`);
  }

  const modules: QbModule[] = [];
  for (const m of content.modules) {
    const kind = moduleKinds[m.code];
    if (!kind) errors.push(`Module ${m.code} has no kind in the rules (${source.kind === 'seed' ? source.file : 'copied rules'}).`);
    else modules.push({ ...m, kind });
  }
  for (const code of Object.keys(moduleKinds)) {
    if (!content.modules.some((m) => m.code === code)) warnings.push(`Rules list module ${code}, which is not in the workbook.`);
  }

  for (const qid of protectedQuestions) {
    if (!content.questions.some((q) => q.qid === qid)) errors.push(`Protected question ${qid} is not in the workbook.`);
  }
  const questions = content.questions.map((q) => ({ ...q, is_protected: protectedQuestions.includes(q.qid) }));

  // Band names and ranges must match the Session Tiers tab.
  const bands = rules.scoring.bands;
  content.sheet_bands.forEach((sheet, i) => {
    const b = bands[i];
    if (!b || b.min !== sheet.min || b.max !== sheet.max || b.name_en !== sheet.name_en || b.name_hi !== sheet.name_hi) {
      errors.push(
        `Band ${i + 1} in the rules (${b ? `${b.min}–${b.max} ${b.name_en}/${b.name_hi}` : 'missing'}) does not match the ` +
          `Session Tiers tab (${sheet.min}–${sheet.max} ${sheet.name_en}/${sheet.name_hi}).`
      );
    }
  });

  // Worked Examples: expected tier in the workbook must match the stored test case.
  for (const w of content.sheet_worked_examples) {
    const tc = testCases.find((t) => t.source === 'worked_example' && t.name === `Worked example ${w.case}`);
    if (!tc) warnings.push(`Worked example ${w.case} has no test case.`);
    else if (tc.expected.tier !== w.expected_tier) {
      errors.push(`Worked example ${w.case}: workbook expects tier ${w.expected_tier}, test case expects ${tc.expected.tier}.`);
    }
  }

  if (errors.length) return { payload: null, source, errors, warnings };

  return {
    payload: {
      test_code: content.test_code,
      version_label: content.version_label,
      source_file_name: content.source_file_name,
      source_checksum: content.source_checksum,
      change_note: options.changeNote ?? null,
      modules,
      questions,
      options: content.options,
      texts: content.texts,
      item_texts: content.item_texts,
      tiers: content.tiers,
      ...rules,
      test_cases: testCases,
    },
    source,
    errors,
    warnings,
  };
}
