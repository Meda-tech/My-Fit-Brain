import type { BandName, VersionConfig } from '@mfb/questionbank';
import { evaluateCondition } from './conditions';
import { ConfigError } from './errors';
import type { Facts } from './facts';
import type { FiredFlag, FlowItem, FormatResult, ReportKeys, TraceStep, Warning } from './types';

// Report content as text keys and item ids only (language-independent), per qb_report_rules.

interface Ctx {
  flags: FiredFlag[];
  layout: 'standard' | 'crisis';
  tier: number | null;
  format: FormatResult | null;
  warnings: Warning[];
  trace: TraceStep[];
}

export function buildReportKeys(config: VersionConfig, facts: Facts, flow: FlowItem[], ctx: Ctx): ReportKeys {
  const rr = config.report_rules;
  const index = facts.index;
  const shown = new Map(flow.map((f) => [f.qid, f]));
  const bandOf = (m: string | null) => (m ? ((facts.bands.get(m) as BandName | null | undefined) ?? null) : null);
  const rank = (b: BandName | null) => (b === null ? -1 : index.bandRank(b));

  // Interpretation: primary, second (if at least the minimum band), core. A module without a text for
  // its band uses the core's text for the core's band when fallback = core. No key twice.
  const roles: Record<'primary' | 'second' | 'core', string | null> = {
    primary: facts.primary ?? null,
    second: facts.second ?? null,
    core: facts.coreModule ?? null,
  };
  const interpretationKey = (module: string | null): string | null => {
    const band = bandOf(module);
    if (!module || !band) return null;
    return config.texts.find((t) => t.module_code === module && t.band === band)?.key ?? null;
  };
  const interpretation: string[] = [];
  for (const role of rr.interpretation.order) {
    const module = roles[role];
    if (!module) continue;
    if (role === 'second' && rank(bandOf(module)) < index.bandRank(rr.interpretation.second_min_band)) continue;
    let key = interpretationKey(module);
    if (!key && rr.interpretation.fallback === 'core' && role !== 'core') {
      key = interpretationKey(roles.core);
      if (key) ctx.trace.push({ step: 'report', detail: `No interpretation text for ${module} (${bandOf(module)}); using the core's ${key}.` });
    }
    if (!key) {
      ctx.warnings.push({ code: 'NO_INTERPRETATION_TEXT', message: `No interpretation text for ${module} (${bandOf(module)}).` });
      continue;
    }
    if (!interpretation.includes(key)) interpretation.push(key);
  }

  // Strengths: priority order, answered with the configured answer, with a STRENGTH text.
  const strengths: string[] = [];
  for (const qid of rr.strengths.priority) {
    if (strengths.length >= rr.strengths.count) break;
    if (!shown.has(qid)) continue;
    if (facts.answers[qid] !== rr.strengths.answer) continue;
    if (!config.item_texts.some((t) => t.qid === qid && t.kind === 'strength')) continue;
    strengths.push(qid);
  }

  // Stuck: non-reverse items with a STUCK text; answer order first, then module order, then sort.
  const stuck: string[] = [];
  const moduleOrder = [...new Set(rr.stuck.module_order.map((r) => roles[r]).filter((m): m is string => !!m))];
  outer: for (const bucket of rr.stuck.answer_order) {
    const bucketValue = config.scoring.scale.likert[bucket];
    if (bucketValue === undefined) throw new ConfigError(`stuck answer_order uses ${bucket}, which is not on the likert scale`);
    for (const module of moduleOrder) {
      for (const item of flow.filter((f) => f.module === module && !f.reverse)) {
        if (stuck.length >= rr.stuck.count) break outer;
        const text = config.item_texts.find((t) => t.qid === item.qid && t.kind === 'stuck');
        if (!text) continue;
        const code = facts.answers[item.qid];
        if (typeof code !== 'string') continue;
        // The trigger names the answers it accepts, e.g. often_sometimes_or_yes.
        const accepted = text.trigger.split('_').filter((w) => w !== 'or');
        const value = item.options.find((o) => o.code === code)?.value;
        if (accepted.includes(code) && value === bucketValue && !stuck.includes(item.qid)) stuck.push(item.qid);
      }
    }
  }

  // Focus: lines of the primary module's focus text; when the second module reaches the minimum band,
  // the configured split between primary and second.
  const focusText = (module: string | null) => (module ? config.texts.find((t) => t.module_code === module && t.band === null) : undefined);
  const linesOf = (key: string) => config.texts.find((t) => t.key === key)!.text_en.split(rr.focus.separator).length;
  const focus: { key: string; line: number }[] = [];
  const primaryFocus = focusText(roles.primary);
  const secondFocus =
    roles.second && rank(bandOf(roles.second)) >= index.bandRank(rr.focus.second_module_min_band) ? focusText(roles.second) : undefined;
  const take = (key: string, n: number) => {
    const available = linesOf(key);
    if (available < n) ctx.warnings.push({ code: 'FOCUS_LINES_SHORT', message: `${key} has ${available} lines; ${n} wanted.` });
    for (let i = 0; i < Math.min(n, available); i++) focus.push({ key, line: i });
  };
  if (!primaryFocus) {
    ctx.warnings.push({ code: 'NO_FOCUS_TEXT', message: `No focus text for the primary module ${roles.primary}.` });
  } else if (secondFocus) {
    take(primaryFocus.key, rr.focus.split_when_second[0]);
    take(secondFocus.key, rr.focus.split_when_second[1]);
  } else {
    take(primaryFocus.key, rr.focus.lines);
  }

  // Tone and next step.
  const ready = evaluateCondition(rr.tone.condition, facts);
  if (ready === 'unknown') throw new ConfigError('the tone condition could not be decided');
  const tone = ready ? rr.tone.ready_key : rr.tone.gentle_key;
  const crisis = ctx.layout === 'crisis';

  // Blocks: printed flags with a report block, in flag order; the crisis block goes first.
  let blocks = ctx.flags
    .filter((f) => f.effects.report_block && f.effects.printed !== false)
    .map((f) => f.effects.report_block as string);
  if (crisis) {
    const top = rr.layouts.crisis.top_block;
    blocks = [top, ...blocks.filter((b) => b !== top)];
  }

  return {
    interpretation,
    strengths,
    stuck,
    focus,
    tone,
    blocks,
    nextStep: crisis ? rr.layouts.crisis.next_key : tone,
    plan:
      crisis || ctx.tier === null
        ? null
        : {
            sessions: ctx.tier,
            format: ctx.format?.type ?? null,
            ...(ctx.format?.split ? { split: ctx.format.split } : {}),
            formatTextKey: ctx.format ? (rr.format_texts[ctx.format.type] ?? null) : null,
            addTextKeys: ctx.format?.addTextKeys ?? [],
          },
    hidden: crisis ? [...rr.layouts.crisis.hide] : [],
  };
}
