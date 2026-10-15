import iaRules from './IA-1.1.rules.json';
import iaCases from './IA-1.1.test-cases.json';
import maRules from './MA-1.0.rules.json';
import maCases from './MA-1.0.test-cases.json';
import tests from './tests.json';

// Seed files: Excel rule prose converted once into data (docs/tasks/03-rules-mapping.md).
// Keyed by "<TEST>-<VERSION>". Validated with zod where they are used (attach-rules.ts).

export const SEED_RULES: Record<string, unknown> = {
  'IA-1.1': iaRules,
  'MA-1.0': maRules,
};

export const SEED_TEST_CASES: Record<string, unknown> = {
  'IA-1.1': iaCases,
  'MA-1.0': maCases,
};

/** The two tests as seeded by the migration (used when no database is at hand, e.g. tests and SQL export). */
export const SEED_TESTS: { code: string; name_en: string; name_hi: string | null; report_id_prefix: string; sort: number }[] =
  tests;
