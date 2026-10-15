import { z } from 'zod';

// One condition shape for every rule (visibility, option rules, points, overrides, flags, format,
// tone, core module). Documented in docs/questionbank/rules-reference.md.

export const BAND_NAMES = ['Low', 'Mild', 'Moderate', 'High'] as const;
export type BandName = (typeof BAND_NAMES)[number];

/** Band order: Low < Mild < Moderate < High. */
export function bandRank(band: BandName): number {
  return BAND_NAMES.indexOf(band);
}

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: 'answer'; q: string; op: 'eq' | 'neq' | 'in' | 'not_in'; value: string | string[] }
  | { fact: 'answer_value'; q: string; op: 'eq' | 'gte' | 'lte' | 'gt' | 'lt'; value: number }
  | { fact: 'answered_any_except'; q: string; value: string[] }
  | { fact: 'sex'; op: 'eq' | 'in'; value: string | string[] }
  | { fact: 'age'; op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq'; value: number }
  | { fact: 'age_band'; op: 'eq' | 'in'; value: string | string[] }
  | { fact: 'path'; op: 'eq'; value: 'partner' | 'solo' }
  | { fact: 'module_chosen'; value: string }
  | { fact: 'chosen_count'; op: 'eq' | 'gte' | 'lte'; value: number }
  | { fact: 'chosen_kinds'; op: 'only' | 'includes'; value: ('couple' | 'individual')[] }
  | { fact: 'band'; module: string; op: 'eq' | 'gte' | 'lte'; value: BandName }
  | { fact: 'all_bands'; scope: 'core_and_chosen' | 'chosen'; op: 'lte' | 'gte'; value: BandName }
  | { fact: 'count_bands'; scope: 'chosen'; op: 'gte'; value: 'Moderate' | 'High'; count: number }
  | { fact: 'flag'; key: string };

const band = z.enum(BAND_NAMES);
const strOrList = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(conditionSchema) }),
    z.strictObject({ any: z.array(conditionSchema).min(1) }),
    z.strictObject({ not: conditionSchema }),
    z.strictObject({
      fact: z.literal('answer'),
      q: z.string().min(1),
      op: z.enum(['eq', 'neq', 'in', 'not_in']),
      value: strOrList,
    }),
    z.strictObject({
      fact: z.literal('answer_value'),
      q: z.string().min(1),
      op: z.enum(['eq', 'gte', 'lte', 'gt', 'lt']),
      value: z.number().int(),
    }),
    z.strictObject({
      fact: z.literal('answered_any_except'),
      q: z.string().min(1),
      value: z.array(z.string().min(1)),
    }),
    z.strictObject({ fact: z.literal('sex'), op: z.enum(['eq', 'in']), value: strOrList }),
    z.strictObject({
      fact: z.literal('age'),
      op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
      value: z.number().int(),
    }),
    z.strictObject({ fact: z.literal('age_band'), op: z.enum(['eq', 'in']), value: strOrList }),
    z.strictObject({ fact: z.literal('path'), op: z.literal('eq'), value: z.enum(['partner', 'solo']) }),
    z.strictObject({ fact: z.literal('module_chosen'), value: z.string().min(1) }),
    z.strictObject({
      fact: z.literal('chosen_count'),
      op: z.enum(['eq', 'gte', 'lte']),
      value: z.number().int().min(0),
    }),
    z.strictObject({
      fact: z.literal('chosen_kinds'),
      op: z.enum(['only', 'includes']),
      value: z.array(z.enum(['couple', 'individual'])).min(1),
    }),
    z.strictObject({
      fact: z.literal('band'),
      module: z.string().min(1),
      op: z.enum(['eq', 'gte', 'lte']),
      value: band,
    }),
    z.strictObject({
      fact: z.literal('all_bands'),
      scope: z.enum(['core_and_chosen', 'chosen']),
      op: z.enum(['lte', 'gte']),
      value: band,
    }),
    z.strictObject({
      fact: z.literal('count_bands'),
      scope: z.literal('chosen'),
      op: z.literal('gte'),
      value: z.enum(['Moderate', 'High']),
      count: z.number().int().min(1),
    }),
    z.strictObject({ fact: z.literal('flag'), key: z.string().min(1) }),
  ])
);

/** Module references in `band` that are roles, not module codes. */
export const BAND_MODULE_ROLES = ['primary', 'second', 'core'] as const;

export interface ConditionRefs {
  questions: { qid: string; optionCodes: string[] }[];
  modules: string[];
  flags: string[];
  ageBands: string[];
  sexes: string[];
}

/** Every question, option code, module and flag a condition refers to (for validation). */
export function conditionRefs(condition: Condition, refs: ConditionRefs = emptyRefs()): ConditionRefs {
  if ('all' in condition) condition.all.forEach((c) => conditionRefs(c, refs));
  else if ('any' in condition) condition.any.forEach((c) => conditionRefs(c, refs));
  else if ('not' in condition) conditionRefs(condition.not, refs);
  else {
    switch (condition.fact) {
      case 'answer':
        refs.questions.push({ qid: condition.q, optionCodes: toList(condition.value) });
        break;
      case 'answered_any_except':
        refs.questions.push({ qid: condition.q, optionCodes: condition.value });
        break;
      case 'answer_value':
        refs.questions.push({ qid: condition.q, optionCodes: [] });
        break;
      case 'module_chosen':
        refs.modules.push(condition.value);
        break;
      case 'band':
        if (!(BAND_MODULE_ROLES as readonly string[]).includes(condition.module)) {
          refs.modules.push(condition.module);
        }
        break;
      case 'flag':
        refs.flags.push(condition.key);
        break;
      case 'age_band':
        refs.ageBands.push(...toList(condition.value));
        break;
      case 'sex':
        refs.sexes.push(...toList(condition.value));
        break;
      default:
        break;
    }
  }
  return refs;
}

function emptyRefs(): ConditionRefs {
  return { questions: [], modules: [], flags: [], ageBands: [], sexes: [] };
}

function toList(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}
