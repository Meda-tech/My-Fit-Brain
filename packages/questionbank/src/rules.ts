import { z } from 'zod';
import { BAND_NAMES, conditionSchema } from './conditions';

// Zod schemas for the rule tables (qb_scoring, qb_point_rules, qb_overrides, qb_visibility_rules,
// qb_option_rules, qb_flags, qb_format_rules, qb_report_rules) and for a seed rules file.

const key = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Keys are UPPER_SNAKE_CASE');
const qid = z.string().min(1);
const textKey = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const band = z.enum(BAND_NAMES);

export const NOTIFY_RECIPIENTS = ['coordinator', 'counsellor'] as const;

export const MODULE_KINDS = [
  'intake', 'gate', 'core', 'solo_core', 'couple', 'individual', 'dose', 'flag',
] as const;
export const FORMATS = ['individual', 'couple', 'mixed', 'individual_partner_joins'] as const;
export const OPTION_RULE_KINDS = ['hide', 'order_first'] as const;
export const POINT_SOURCES = ['primary_band_severity', 'answer_value', 'fixed'] as const;

export const scoringSchema = z.strictObject({
  scale: z.strictObject({
    likert: z.record(z.string(), z.number().int()),
    yn: z.record(z.string(), z.number().int()),
    /** Reverse items score `reverse_max − value`. */
    reverse_max: z.number().int(),
  }),
  bands: z
    .array(
      z.strictObject({
        code: band,
        min: z.number().int(),
        max: z.number().int(),
        name_en: z.string().min(1),
        name_hi: z.string().min(1),
        severity_points: z.number().int(),
      })
    )
    .length(4),
  rounding: z.literal('half_up'),
  core_module: z.strictObject({
    rules: z.array(
      z.strictObject({
        when: conditionSchema,
        module: z.string().min(1),
        path: z.enum(['partner', 'solo']).nullable(),
      })
    ),
    default: z.strictObject({
      module: z.string().min(1),
      path: z.enum(['partner', 'solo']).nullable(),
    }),
  }),
  /** min_choices is required from IA 1.2 / MA 1.1 (decision D12); validation reports it when missing. */
  gate: z.strictObject({ qid, min_choices: z.number().int().min(0).optional(), max_choices: z.number().int().min(1) }),
  primary: z.strictObject({ tie: z.literal('first_chosen'), fallback: z.literal('core') }),
  tier_thresholds: z
    .array(z.strictObject({ max_points: z.number().int().nullable(), sessions: z.number().int() }))
    .min(1),
  pace: z.record(
    z.string().regex(/^\d+$/),
    z.array(z.strictObject({ sessions: z.number().int(), every: z.enum(['week', 'fortnight']) })).min(1)
  ),
  progress: z.strictObject({
    better_at: z.number().int(),
    worse_at: z.number().int(),
    schedule: z.array(
      z.strictObject({
        after_session: z.number().int(),
        plan_sessions: z.number().int().optional(),
      })
    ),
    items: z.strictObject({
      core: z.boolean(),
      chosen_modules: z.boolean(),
      qids: z.array(qid),
    }),
    reuse_qids: z.array(qid),
    texts: z.strictObject({
      heading: textKey,
      line: textKey,
      better: textKey,
      same: textKey,
      worse: textKey,
    }),
    id_suffix: z.string().min(1),
  }),
  /** How registration fills intake answers (never asked twice). */
  registration: z.strictObject({
    age_band_qid: qid,
    sex_qid: qid,
    sex_options: z.record(z.string(), z.string()),
    age_bands: z.array(
      z.strictObject({
        option_code: z.string().min(1),
        min: z.number().int().nullable(),
        max: z.number().int().nullable(),
      })
    ),
  }),
});

export const pointRuleSchema = z.strictObject({
  key,
  label: z.string().min(1),
  source: z.enum(POINT_SOURCES),
  qid: qid.nullable(),
  points: z.number().int().nullable(),
  condition: conditionSchema.nullable(),
  sort: z.number().int(),
});

export const overrideSchema = z.strictObject({
  key,
  label: z.string().min(1),
  condition: conditionSchema,
  action: z.enum(['cap', 'floor']),
  sessions: z.number().int(),
  sort: z.number().int(),
});

export const visibilityRuleSchema = z.strictObject({ qid, condition: conditionSchema });

export const optionRuleSchema = z.strictObject({
  qid,
  option_code: z.string().min(1),
  kind: z.enum(OPTION_RULE_KINDS),
  condition: conditionSchema,
  sort: z.number().int(),
});

export const flagEffectsSchema = z.strictObject({
  report_block: textKey.optional(),
  dashboard_tag: z.string().min(1).optional(),
  force_format: z.enum(FORMATS).optional(),
  layout: z.literal('crisis').optional(),
  interrupt: z.literal(true).optional(),
  stop: z.literal(true).optional(),
  notify: z.array(z.enum(NOTIFY_RECIPIENTS)).min(1).optional(),
  printed: z.literal(false).optional(),
});

export const flagSchema = z.strictObject({
  key,
  condition: conditionSchema,
  effects: flagEffectsSchema,
  is_protected: z.boolean(),
  sort: z.number().int(),
});

export const formatRuleSchema = z.strictObject({
  key,
  condition: conditionSchema,
  format: z.enum(FORMATS),
  /** Mixed format: sessions → [individual, couple]. */
  split: z.record(z.string().regex(/^\d+$/), z.tuple([z.number().int(), z.number().int()])).nullable(),
  add_text_key: textKey.nullable(),
  sort: z.number().int(),
});

export const reportRulesSchema = z.strictObject({
  strengths: z.strictObject({
    count: z.number().int().min(1),
    priority: z.array(qid).min(1),
    answer: z.literal('often'),
  }),
  stuck: z.strictObject({
    count: z.number().int().min(1),
    module_order: z.array(z.enum(['primary', 'second', 'core'])).min(1),
    answer_order: z.array(z.enum(['often', 'sometimes'])).min(1),
  }),
  focus: z.strictObject({
    lines: z.number().int().min(1),
    second_module_min_band: band,
    /** When the second module qualifies: lines from primary, then from second. */
    split_when_second: z.tuple([z.number().int(), z.number().int()]),
    separator: z.string().min(1),
  }),
  tone: z.strictObject({
    condition: conditionSchema,
    ready_key: textKey,
    gentle_key: textKey,
  }),
  interpretation: z.strictObject({
    order: z.array(z.enum(['primary', 'second', 'core'])).min(1),
    second_min_band: band,
    /** No text for a module's band → use the core's text for the core's band (D13). Required from IA 1.2 / MA 1.1. */
    fallback: z.enum(['core', 'none']).optional(),
  }),
  layouts: z.strictObject({
    crisis: z.strictObject({
      top_block: textKey,
      hide: z.array(textKey),
      next_key: textKey,
    }),
  }),
  /** Text inserted as {FORMAT} in PLAN_LINE, per format (Mind has none: its PLAN_LINE is fixed). */
  format_texts: z.partialRecord(z.enum(FORMATS), textKey),
  report_language: z.strictObject({
    qid,
    map: z.record(z.string(), z.array(z.enum(['en', 'hi'])).min(1)),
  }),
});

/** A seed rules file: packages/questionbank/seeds/<TEST>-<VERSION>.rules.json */
export const seedRulesSchema = z.strictObject({
  test_code: z.string().min(1),
  version_label: z.string().min(1),
  module_kinds: z.record(z.string(), z.enum(MODULE_KINDS)),
  protected: z.strictObject({ questions: z.array(qid), flags: z.array(key) }),
  scoring: scoringSchema,
  point_rules: z.array(pointRuleSchema),
  overrides: z.array(overrideSchema),
  visibility_rules: z.array(visibilityRuleSchema),
  option_rules: z.array(optionRuleSchema),
  flags: z.array(flagSchema),
  format_rules: z.array(formatRuleSchema),
  report_rules: reportRulesSchema,
});

export const testCaseSchema = z.strictObject({
  name: z.string().min(1),
  source: z.enum(['worked_example', 'manual']),
  context: z.strictObject({
    sex: z.string().min(1),
    age: z.number().int(),
    path: z.enum(['partner', 'solo']).nullable(),
  }),
  answers: z.record(z.string(), z.union([z.string().min(1), z.array(z.string().min(1))])),
  expected: z.strictObject({
    bands: z.record(z.string(), band),
    primary: z.string().min(1),
    points: z.record(z.string(), z.number().int()),
    tier: z.number().int(),
    format: z.enum(FORMATS),
    flags: z.array(z.string()),
    layout: z.enum(['standard', 'crisis']),
    extra_text_keys: z.array(textKey).optional(),
    /** Interpretation text keys in print order (after fallback, without repeats). */
    interpretation_keys: z.array(textKey).optional(),
    notify: z.array(z.enum(NOTIFY_RECIPIENTS)).optional(),
  }),
  verified: z.boolean(),
  notes: z.string(),
});

export const seedTestCasesSchema = z.strictObject({
  test_code: z.string().min(1),
  version_label: z.string().min(1),
  test_cases: z.array(testCaseSchema),
});

export type Scoring = z.infer<typeof scoringSchema>;
export type PointRule = z.infer<typeof pointRuleSchema>;
export type Override = z.infer<typeof overrideSchema>;
export type VisibilityRule = z.infer<typeof visibilityRuleSchema>;
export type OptionRule = z.infer<typeof optionRuleSchema>;
export type FlagEffects = z.infer<typeof flagEffectsSchema>;
export type Flag = z.infer<typeof flagSchema>;
export type FormatRule = z.infer<typeof formatRuleSchema>;
export type ReportRules = z.infer<typeof reportRulesSchema>;
export type SeedRules = z.infer<typeof seedRulesSchema>;
export type TestCase = z.infer<typeof testCaseSchema>;
export type SeedTestCases = z.infer<typeof seedTestCasesSchema>;
export type ModuleKind = (typeof MODULE_KINDS)[number];
export type Format = (typeof FORMATS)[number];
