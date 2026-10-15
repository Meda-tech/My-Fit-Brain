import type { VersionConfig } from '@mfb/questionbank';
import { evaluateCondition, type TriState } from './conditions';
import { AssessmentStoppedError, ConfigError, IncompleteAssessmentError, InvalidAnswerError } from './errors';
import { analyse, type Facts } from './facts';
import { buildReportKeys } from './report';
import type { Answers, AssessmentResult, EngineContext, FiredFlag, FormatResult, TraceStep, Warning } from './types';
import { ENGINE_VERSION } from './version';

// Scores a complete assessment. Every number, rule and key comes from the VersionConfig.

function known(r: TriState, what: string): boolean {
  if (r === 'unknown') throw new ConfigError(`${what} could not be decided on a complete assessment`);
  return r;
}

export function score(config: VersionConfig, context: EngineContext, answers: Answers): AssessmentResult {
  const trace: TraceStep[] = [];
  const warnings: Warning[] = [];

  // 1. The flow as answered: invalid answers and stop flags first.
  const partial = analyse(config, context, answers);
  if (partial.issues.length) throw new InvalidAnswerError(partial.issues);
  const stop = config.flags.find((f) => f.effects.stop && partial.facts.flags.get(f.key) === true);
  if (stop) throw new AssessmentStoppedError(stop.key);
  const missing = partial.flow.filter((f) => !f.answered).map((f) => f.qid);
  if (missing.length) throw new IncompleteAssessmentError(missing);

  const shown = new Set(partial.flow.map((f) => f.qid));
  for (const qid of Object.keys(answers)) {
    if (!shown.has(qid)) warnings.push({ code: 'ANSWER_IGNORED', message: `${qid} was answered but is not shown to this client; ignored.` });
  }

  // 2. Facts of the complete assessment, on the shown questions only.
  const shownAnswers: Answers = {};
  for (const item of partial.flow) shownAnswers[item.qid] = partial.facts.answers[item.qid];
  const a = analyse(config, context, shownAnswers, { complete: true });
  const facts = a.facts;
  warnings.push(...a.warnings);
  if (facts.coreModule === undefined || facts.chosen === undefined || !facts.primary || facts.second === undefined) {
    throw new ConfigError('core module, chosen modules or primary module could not be decided');
  }
  const primary: string = facts.primary;

  trace.push({
    step: 'path',
    detail: `Core module ${facts.coreModule}${facts.path ? `, ${facts.path} path` : ''}. Chosen: ${facts.chosen.join(', ') || 'none'}.`,
  });
  const modules = Object.fromEntries(facts.modules);
  for (const [code, m] of facts.modules) {
    trace.push({ step: 'module', detail: `${code}: ${m.sum}/${m.max} = ${m.percent ?? '—'}% → ${m.band ?? 'no band'} (${m.scoredItems} scored of ${m.shownItems} shown).` });
  }
  trace.push({ step: 'primary', detail: `Primary ${facts.primary}${facts.second ? `, second ${facts.second}` : ''}.` });

  const flags = firedFlags(config, facts, trace);
  const layout = flags.some((f) => f.effects.layout === 'crisis') ? 'crisis' : 'standard';
  if (layout === 'crisis') trace.push({ step: 'layout', detail: 'Crisis layout (a flag set it); the tier is still calculated and stored.' });

  let points: AssessmentResult['points'] = null;
  let tierBeforeOverrides: number | null = null;
  let tier: number | null = null;
  const overridesApplied: AssessmentResult['overridesApplied'] = [];
  let format: FormatResult | null = null;

  if (context.mode === 'initial') {
    // 3. Points in sort order.
    const breakdown: { key: string; label: string; points: number }[] = [];
    for (const rule of config.point_rules) {
      const applies = rule.condition ? known(evaluateCondition(rule.condition, facts), `point rule ${rule.key}`) : true;
      let p = 0;
      if (applies) {
        if (rule.source === 'primary_band_severity') {
          const band = facts.bands.get(primary);
          const severity = config.scoring.bands.find((b) => b.code === band)?.severity_points;
          if (severity === undefined) throw new ConfigError(`no severity points for the primary band ${String(band)}`);
          p = severity;
        } else if (rule.source === 'answer_value') {
          if (!rule.qid) throw new ConfigError(`point rule ${rule.key} needs a qid`);
          const q = facts.index.question(rule.qid);
          const code = facts.answers[rule.qid];
          const value = q.options.find((o) => o.option_code === (Array.isArray(code) ? code[0] : code))?.value;
          if (value === undefined || value === null) {
            warnings.push({ code: 'POINT_SOURCE_MISSING', message: `Point rule ${rule.key}: ${rule.qid} has no answer value; 0 points.` });
          } else {
            p = value;
          }
        } else {
          if (rule.points === null) throw new ConfigError(`point rule ${rule.key} needs points`);
          p = rule.points;
        }
      }
      breakdown.push({ key: rule.key, label: rule.label, points: p });
      trace.push({ step: 'points', detail: `${rule.key}: ${p}${applies ? '' : ' (condition not met)'}.` });
    }
    const total = breakdown.reduce((s, b) => s + b.points, 0);
    points = { total, breakdown };

    // 4. Tier, then overrides in sort order.
    const threshold = config.scoring.tier_thresholds.find((t) => t.max_points === null || total <= t.max_points);
    if (!threshold) throw new ConfigError(`no tier threshold for ${total} points`);
    tierBeforeOverrides = threshold.sessions;
    let current: number = threshold.sessions;
    trace.push({ step: 'tier', detail: `${total} points → ${current} sessions.` });
    for (const o of config.overrides) {
      if (!known(evaluateCondition(o.condition, facts), `override ${o.key}`)) continue;
      const to = o.action === 'cap' ? Math.min(current, o.sessions) : Math.max(current, o.sessions);
      overridesApplied.push({ key: o.key, from: current, to });
      trace.push({ step: 'override', detail: `${o.key}: ${o.action} ${o.sessions} → ${current === to ? `no change (${to})` : `${current} → ${to}`}.` });
      current = to;
    }
    tier = current;

    // 5. Format: a flag's force_format (first in sort order) wins over the format rules.
    format = decideFormat(config, facts, flags, current, trace, warnings);
  }

  const report = buildReportKeys(config, facts, partial.flow, { flags, layout, tier, format, warnings, trace });

  const readinessItem = partial.flow.find((f) => f.moduleKind === 'dose' && f.scored === 'no');
  const readinessAnswer = readinessItem ? facts.answers[readinessItem.qid] : undefined;

  return {
    engineVersion: ENGINE_VERSION,
    versionId: config.version.id,
    testCode: config.version.test_code,
    mode: context.mode,
    path: facts.path ?? null,
    coreModule: facts.coreModule,
    chosenModules: facts.chosen,
    modules,
    primary,
    second: facts.second,
    points,
    tierBeforeOverrides,
    overridesApplied,
    tier,
    format,
    flags,
    layout,
    notify: flags.filter((f) => f.effects.notify?.length).map((f) => ({ flag: f.key, recipients: [...(f.effects.notify ?? [])] })),
    report,
    counsellor: {
      readiness: readinessItem && typeof readinessAnswer === 'string' ? { qid: readinessItem.qid, answer: readinessAnswer } : null,
      tags: [...new Set(flags.map((f) => f.effects.dashboard_tag).filter((t): t is string => !!t))],
      rawAnswers: shownAnswers,
    },
    warnings,
    trace,
  };
}

function firedFlags(config: VersionConfig, facts: Facts, trace: TraceStep[]): FiredFlag[] {
  const fired: FiredFlag[] = [];
  for (const f of config.flags) {
    if (known(facts.flags.get(f.key) ?? 'unknown', `flag ${f.key}`)) {
      fired.push({ key: f.key, effects: f.effects });
      trace.push({ step: 'flag', detail: `${f.key} raised.` });
    }
  }
  return fired;
}

function decideFormat(
  config: VersionConfig,
  facts: Facts,
  flags: FiredFlag[],
  tier: number,
  trace: TraceStep[],
  warnings: Warning[]
): FormatResult | null {
  const forcing = flags.find((f) => f.effects.force_format);
  if (forcing?.effects.force_format) {
    trace.push({ step: 'format', detail: `${forcing.effects.force_format} (forced by flag ${forcing.key}).` });
    return { type: forcing.effects.force_format, addTextKeys: [], source: { kind: 'flag', key: forcing.key } };
  }
  for (const rule of config.format_rules) {
    if (!known(evaluateCondition(rule.condition, facts), `format rule ${rule.key}`)) continue;
    const result: FormatResult = {
      type: rule.format,
      addTextKeys: rule.add_text_key ? [rule.add_text_key] : [],
      source: { kind: 'rule', key: rule.key },
    };
    if (rule.split) {
      const split = rule.split[String(tier)];
      if (split) result.split = { individual: split[0], couple: split[1] };
      else warnings.push({ code: 'NO_SPLIT_FOR_TIER', message: `Format rule ${rule.key} has no split for ${tier} sessions.` });
    }
    trace.push({ step: 'format', detail: `${rule.format} (rule ${rule.key})${result.split ? `: ${result.split.individual} individual + ${result.split.couple} couple` : ''}.` });
    return result;
  }
  warnings.push({ code: 'NO_FORMAT_RULE', message: 'No format rule matched; the format is empty.' });
  trace.push({ step: 'format', detail: 'No format rule matched.' });
  return null;
}
