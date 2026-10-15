import { z } from 'zod';
import {
  flagEffectsSchema,
  flagSchema,
  formatRuleSchema,
  reportRulesSchema,
  scoringSchema,
  testCaseSchema,
} from './rules';
import type { ImportPayload, QbText } from './types';

// Version patches: an ordered list of operations that turns a live version into the next one.
// The same patch is applied offline to a payload (tests, CLI check) and turned into SQL that runs
// against the database through the qb_* workflow functions. The Task 05 editor will do the same
// operations through the UI.

const decision = z.string().regex(/^D([1-9]|1[0-9]|20)$/, 'decision must be D1–D20');
const key = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const scoringField = z.enum(Object.keys(scoringSchema.shape).filter((k) => k !== 'rounding') as [string, ...string[]]);
const reportField = z.enum(Object.keys(reportRulesSchema.shape) as [string, ...string[]]);

const questionSet = z
  .strictObject({
    scored: z.enum(['yes', 'no', 'points']),
    text_en: z.string().min(1),
    text_hi: z.string().min(1),
    reverse: z.boolean(),
    path: z.enum(['all', 'partner', 'solo']),
    sort: z.number().int(),
    source_note: z.string().nullable(),
  })
  .partial();

const optionSet = z
  .strictObject({
    exclusive: z.boolean(),
    label_en: z.string().min(1),
    label_hi: z.string().min(1),
    value: z.number().int().nullable(),
    sort: z.number().int(),
  })
  .partial();

const textSchema = z.strictObject({
  key,
  module_code: z.string().nullable(),
  band: z.enum(['Low', 'Mild', 'Moderate', 'High']).nullable(),
  text_en: z.string().min(1),
  text_hi: z.string().min(1),
});

export const patchOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('set_question'), decision, qid: z.string(), set: questionSet }),
  z.strictObject({ op: z.literal('set_option'), decision, qid: z.string(), option_code: z.string(), set: optionSet }),
  z.strictObject({
    op: z.literal('add_text'),
    decision,
    text: textSchema.optional(),
    /** Copy a text exactly (EN and HI) from the live version of another test. */
    copy_from: z.strictObject({ test_code: z.string(), key }).optional(),
    key: key.optional(),
  }),
  z.strictObject({
    op: z.literal('add_flag'),
    decision,
    flag: flagSchema.omit({ sort: true }),
    /** Insert directly after this flag (later flags move down); default: last. */
    after: key.optional(),
  }),
  z.strictObject({
    op: z.literal('set_flag'),
    decision,
    key,
    set: flagSchema.omit({ key: true }).partial().optional(),
    /** Top-level keys replace the existing ones (like jsonb ||). */
    merge_effects: flagEffectsSchema.optional(),
  }),
  z.strictObject({ op: z.literal('set_format_rules'), decision, rules: z.array(formatRuleSchema).min(1) }),
  z.strictObject({
    op: z.literal('set_scoring'),
    decision,
    field: scoringField,
    merge: z.record(z.string(), z.unknown()).optional(),
    value: z.unknown().optional(),
  }),
  z.strictObject({
    op: z.literal('set_report_rules'),
    decision,
    field: reportField,
    merge: z.record(z.string(), z.unknown()).optional(),
    value: z.unknown().optional(),
  }),
  z.strictObject({ op: z.literal('add_test_case'), decision, test_case: testCaseSchema }),
  z.strictObject({
    op: z.literal('set_test_case'),
    decision,
    name: z.string().min(1),
    merge_answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    set: testCaseSchema.pick({ notes: true, expected: true }).partial().optional(),
  }),
]);

export const patchSchema = z.strictObject({
  test_code: z.string().regex(/^[A-Z]{2,4}$/),
  base_version_label: z.string().regex(/^[0-9]+(\.[0-9]+)*$/),
  version_label: z.string().regex(/^[0-9]+(\.[0-9]+)*$/),
  change_note: z.string().min(1),
  operations: z.array(patchOperationSchema).min(1),
});

export type PatchOperation = z.infer<typeof patchOperationSchema>;
export type VersionPatch = z.infer<typeof patchSchema>;

export class PatchError extends Error {}

function fail(index: number, op: PatchOperation, message: string): never {
  throw new PatchError(`Operation ${index + 1} (${op.op}, ${op.decision}): ${message}`);
}

export interface ApplyContext {
  /** Text of the live version of another test (for add_text copy_from). */
  resolveText(testCode: string, key: string): QbText | null;
}

/** Applies a patch to a copy of `base` (the payload of the base version). Throws PatchError. */
export function applyPatch(base: ImportPayload, patch: VersionPatch, ctx: ApplyContext): ImportPayload {
  if (base.test_code !== patch.test_code || base.version_label !== patch.base_version_label) {
    throw new PatchError(
      `Patch is for ${patch.test_code} ${patch.base_version_label}, payload is ${base.test_code} ${base.version_label}.`
    );
  }
  const p: ImportPayload = structuredClone(base);
  p.version_label = patch.version_label;
  p.change_note = patch.change_note;

  patch.operations.forEach((op, i) => {
    switch (op.op) {
      case 'set_question': {
        const q = p.questions.find((x) => x.qid === op.qid);
        if (!q) fail(i, op, `question ${op.qid} not found`);
        Object.assign(q, op.set);
        break;
      }
      case 'set_option': {
        const o = p.options.find((x) => x.qid === op.qid && x.option_code === op.option_code);
        if (!o) fail(i, op, `option ${op.qid}.${op.option_code} not found`);
        Object.assign(o, op.set);
        break;
      }
      case 'add_text': {
        let text: QbText;
        if (op.copy_from) {
          const src = ctx.resolveText(op.copy_from.test_code, op.copy_from.key);
          if (!src) fail(i, op, `text ${op.copy_from.key} not found in live ${op.copy_from.test_code}`);
          text = { key: op.key ?? src.key, module_code: null, band: null, text_en: src.text_en, text_hi: src.text_hi };
        } else if (op.text) {
          text = op.text;
        } else {
          fail(i, op, 'needs text or copy_from');
        }
        if (p.texts.some((t) => t.key === text.key)) fail(i, op, `text ${text.key} already exists`);
        p.texts.push(text);
        break;
      }
      case 'add_flag': {
        if (p.flags.some((f) => f.key === op.flag.key)) fail(i, op, `flag ${op.flag.key} already exists`);
        let sort: number;
        if (op.after) {
          const after = p.flags.find((f) => f.key === op.after);
          if (!after) fail(i, op, `flag ${op.after} not found`);
          sort = after.sort + 1;
          for (const f of p.flags) if (f.sort > after.sort) f.sort += 1;
        } else {
          sort = Math.max(0, ...p.flags.map((f) => f.sort)) + 1;
        }
        p.flags.push({ ...op.flag, sort });
        p.flags.sort((a, b) => a.sort - b.sort);
        break;
      }
      case 'set_flag': {
        const f = p.flags.find((x) => x.key === op.key);
        if (!f) fail(i, op, `flag ${op.key} not found`);
        if (op.set) Object.assign(f, op.set);
        if (op.merge_effects) f.effects = { ...f.effects, ...op.merge_effects };
        break;
      }
      case 'set_format_rules':
        p.format_rules = structuredClone(op.rules);
        break;
      case 'set_scoring':
      case 'set_report_rules': {
        const target = (op.op === 'set_scoring' ? p.scoring : p.report_rules) as Record<string, unknown>;
        if (op.merge) target[op.field] = { ...(target[op.field] as object), ...op.merge };
        else if (op.value !== undefined) target[op.field] = op.value;
        else fail(i, op, 'needs merge or value');
        break;
      }
      case 'add_test_case':
        if (p.test_cases.some((t) => t.name === op.test_case.name)) fail(i, op, `test case ${op.test_case.name} already exists`);
        p.test_cases.push(structuredClone(op.test_case));
        break;
      case 'set_test_case': {
        const tc = p.test_cases.find((t) => t.name === op.name);
        if (!tc) fail(i, op, `test case ${op.name} not found`);
        if (op.merge_answers) tc.answers = { ...tc.answers, ...op.merge_answers };
        if (op.set) Object.assign(tc, op.set);
        break;
      }
    }
  });
  return p;
}

// ---------------------------------------------------------------------------------------------
// SQL

function lit(value: string | number | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function jsonLit(value: unknown): string {
  const json = JSON.stringify(value);
  let tag = 'qbj';
  while (json.includes(`$${tag}$`)) tag += '_';
  return `$${tag}$${json}$${tag}$::jsonb`;
}

function expectOne(index: number, op: PatchOperation, what: string): string {
  return (
    `  GET DIAGNOSTICS n = ROW_COUNT;\n` +
    `  IF n <> 1 THEN RAISE EXCEPTION 'Patch operation ${index + 1} (${op.op}, ${op.decision}): expected 1 ${what}, got %', n; END IF;`
  );
}

function setList(set: Record<string, unknown>, json: string[] = []): string {
  return Object.entries(set)
    .map(([col, v]) => `${col === 'primary' ? '"primary"' : col} = ${json.includes(col) ? jsonLit(v) : lit(v as string | number | boolean | null)}`)
    .join(', ');
}

/** One DO block: copy live → draft, apply every operation, validate, optionally submit + publish. */
export function patchToSql(patch: VersionPatch, options: { publishNote?: string | null } = {}): string {
  const v = 'v';
  const lines: string[] = [
    `-- ${patch.test_code} ${patch.base_version_label} → ${patch.version_label}: ${patch.change_note}`,
    `-- Generated by \`npm run qb:patch\`. Run once in the Supabase SQL Editor. One transaction: if any step`,
    `-- or the validation fails, nothing is saved.${options.publishNote ? ' Publishes the new version (testing databases).' : ''}`,
    'DO $qbpatch$',
    'DECLARE',
    '  v uuid;',
    '  n integer;',
    'BEGIN',
    `  IF NOT EXISTS (SELECT 1 FROM public.qb_versions WHERE test_code = ${lit(patch.test_code)} AND version_label = ${lit(patch.base_version_label)} AND status = 'live') THEN`,
    `    RAISE EXCEPTION '${patch.test_code} ${patch.base_version_label} must be the live version.';`,
    '  END IF;',
    `  ${v} := public.qb_start_new_version(${lit(patch.test_code)}, ${lit(patch.version_label)});`,
    `  UPDATE public.qb_versions SET change_note = ${lit(patch.change_note)} WHERE id = ${v};`,
    '',
  ];

  patch.operations.forEach((op, i) => {
    lines.push(`  -- ${i + 1}. ${op.decision}: ${op.op}`);
    switch (op.op) {
      case 'set_question':
        lines.push(`  UPDATE public.qb_questions SET ${setList(op.set)} WHERE version_id = ${v} AND qid = ${lit(op.qid)};`);
        lines.push(expectOne(i, op, 'question'));
        break;
      case 'set_option':
        lines.push(
          `  UPDATE public.qb_options SET ${setList(op.set)} WHERE version_id = ${v} AND qid = ${lit(op.qid)} AND option_code = ${lit(op.option_code)};`
        );
        lines.push(expectOne(i, op, 'option'));
        break;
      case 'add_text':
        if (op.copy_from) {
          lines.push(
            `  INSERT INTO public.qb_texts (version_id, key, module_code, band, text_en, text_hi)`,
            `  SELECT ${v}, ${lit(op.key ?? op.copy_from.key)}, NULL, NULL, t.text_en, t.text_hi`,
            `  FROM public.qb_texts t JOIN public.qb_versions x ON x.id = t.version_id`,
            `  WHERE x.test_code = ${lit(op.copy_from.test_code)} AND x.status = 'live' AND t.key = ${lit(op.copy_from.key)};`
          );
        } else if (op.text) {
          const t = op.text;
          lines.push(
            `  INSERT INTO public.qb_texts (version_id, key, module_code, band, text_en, text_hi)`,
            `  VALUES (${v}, ${lit(t.key)}, ${lit(t.module_code)}, ${lit(t.band)}, ${lit(t.text_en)}, ${lit(t.text_hi)});`
          );
        }
        lines.push(expectOne(i, op, 'text'));
        break;
      case 'add_flag': {
        const f = op.flag;
        const values = `${lit(f.key)}, ${jsonLit(f.condition)}, ${jsonLit(f.effects)}, ${lit(f.is_protected)}`;
        if (op.after) {
          lines.push(
            `  UPDATE public.qb_flags SET sort = sort + 1 WHERE version_id = ${v}`,
            `    AND sort > (SELECT sort FROM public.qb_flags WHERE version_id = ${v} AND key = ${lit(op.after)});`,
            `  INSERT INTO public.qb_flags (version_id, key, condition, effects, is_protected, sort)`,
            `  SELECT ${v}, ${values}, sort + 1 FROM public.qb_flags WHERE version_id = ${v} AND key = ${lit(op.after)};`
          );
        } else {
          lines.push(
            `  INSERT INTO public.qb_flags (version_id, key, condition, effects, is_protected, sort)`,
            `  SELECT ${v}, ${values}, coalesce(max(sort), 0) + 1 FROM public.qb_flags WHERE version_id = ${v};`
          );
        }
        lines.push(expectOne(i, op, 'flag'));
        break;
      }
      case 'set_flag': {
        const parts: string[] = [];
        if (op.set) parts.push(setList(op.set, ['condition', 'effects']));
        if (op.merge_effects) parts.push(`effects = effects || ${jsonLit(op.merge_effects)}`);
        lines.push(`  UPDATE public.qb_flags SET ${parts.join(', ')} WHERE version_id = ${v} AND key = ${lit(op.key)};`);
        lines.push(expectOne(i, op, 'flag'));
        break;
      }
      case 'set_format_rules':
        lines.push(`  DELETE FROM public.qb_format_rules WHERE version_id = ${v};`);
        for (const r of op.rules) {
          lines.push(
            `  INSERT INTO public.qb_format_rules (version_id, key, condition, format, split, add_text_key, sort) VALUES (` +
              `${v}, ${lit(r.key)}, ${jsonLit(r.condition)}, ${lit(r.format)}, ${r.split ? jsonLit(r.split) : 'NULL'}, ${lit(r.add_text_key)}, ${r.sort});`
          );
        }
        break;
      case 'set_scoring':
      case 'set_report_rules': {
        const table = op.op === 'set_scoring' ? 'qb_scoring' : 'qb_report_rules';
        const col = op.field === 'primary' ? '"primary"' : op.field;
        const expr = op.merge ? `${col} || ${jsonLit(op.merge)}` : jsonLit(op.value);
        lines.push(`  UPDATE public.${table} SET ${col} = ${expr} WHERE version_id = ${v};`);
        lines.push(expectOne(i, op, `${table} row`));
        break;
      }
      case 'add_test_case': {
        const t = op.test_case;
        lines.push(
          `  INSERT INTO public.qb_test_cases (version_id, name, source, context, answers, expected, verified, notes) VALUES (` +
            `${v}, ${lit(t.name)}, ${lit(t.source)}, ${jsonLit(t.context)}, ${jsonLit(t.answers)}, ${jsonLit(t.expected)}, ${lit(t.verified)}, ${lit(t.notes)});`
        );
        break;
      }
      case 'set_test_case': {
        const parts: string[] = [];
        if (op.merge_answers) parts.push(`answers = answers || ${jsonLit(op.merge_answers)}`);
        if (op.set?.notes !== undefined) parts.push(`notes = ${lit(op.set.notes)}`);
        if (op.set?.expected !== undefined) parts.push(`expected = ${jsonLit(op.set.expected)}`);
        lines.push(`  UPDATE public.qb_test_cases SET ${parts.join(', ')} WHERE version_id = ${v} AND name = ${lit(op.name)};`);
        lines.push(expectOne(i, op, 'test case'));
        break;
      }
    }
    lines.push('');
  });

  lines.push(
    '  -- Zero validation errors, or nothing is saved.',
    `  PERFORM public.qb_raise_if_invalid(${v});`
  );
  if (options.publishNote) {
    lines.push(
      `  PERFORM public.qb_submit_for_review(${v});`,
      `  PERFORM public.qb_publish(${v}, ${lit(options.publishNote)});`,
      `  RAISE NOTICE '${patch.test_code} ${patch.version_label} is live (%).', ${v};`
    );
  } else {
    lines.push(`  RAISE NOTICE '${patch.test_code} ${patch.version_label} created as a draft (%).', ${v};`);
  }
  lines.push('END', '$qbpatch$;', '');
  return lines.join('\n');
}
