import type { AssessmentResult } from '@mfb/engine';
import type { VersionConfig } from '@mfb/questionbank';
import type { ReportLanguageChoice } from './types';

// Builds the stored report (attempt_results.report) from the engine result: every sentence comes from the
// version's texts. The only thing done to text is filling PLAN_LINE's placeholders with other texts and
// numbers. This is the report template: the slot names below are the report sections of the developer
// spec (section 7), not content.

const SLOTS = {
  title: 'TITLE',
  subtitle: 'SUBTITLE',
  designedBy: 'DESIGNED_BY',
  snapshotHeading: 'H_SNAPSHOT',
  snapshotNote: 'SNAPSHOT_NOTE',
  strengthsHeading: 'H_STRENGTHS',
  stuckHeading: 'H_STUCK',
  meansHeading: 'H_MEANS',
  planHeading: 'H_PLAN',
  planLine: 'PLAN_LINE',
  focusHeading: 'H_FOCUS',
  medicalHeading: 'H_MEDICAL',
  nextHeading: 'H_NEXT',
  nriLine: 'NRI_LINE',
  disclaimer: 'DISCLAIMER',
} as const;
/** Medical flags are named MED_* in every question bank (Flags & Safety tab). */
const MEDICAL_FLAG_PREFIX = 'MED_';

export type Lang = 'en' | 'hi';

export interface ReportArea {
  module: string;
  name: string | null;
  percent: number | null;
  band: string | null;
  bandName: string | null;
}

export interface ReportSection {
  crisis: string | null;
  title: string | null;
  subtitle: string | null;
  designedBy: string | null;
  snapshot: { heading: string | null; note: string | null; areas: ReportArea[] };
  strengths: { heading: string | null; items: string[] };
  stuck: { heading: string | null; items: string[] };
  means: { heading: string | null; items: string[] };
  plan: { heading: string | null; line: string | null; extra: string[] } | null;
  focus: { heading: string | null; items: string[] } | null;
  medicalHeading: string | null;
  /** Medical and safety blocks in flag order. */
  blocks: { kind: 'medical' | 'other'; text: string }[];
  next: { heading: string | null; text: string | null };
  nri: string | null;
  disclaimer: string | null;
}

export interface ReportDocument {
  schema: 1;
  reportId: string | null;
  testCode: string;
  versionId: string;
  completedAt: string;
  layout: 'standard' | 'crisis';
  languages: Lang[];
  sections: Partial<Record<Lang, ReportSection>>;
  warnings: string[];
}

export function languagesFor(choice: ReportLanguageChoice): Lang[] {
  return choice === 'both' ? ['en', 'hi'] : [choice];
}

export function buildReportDocument(
  config: VersionConfig,
  result: AssessmentResult,
  meta: { reportId: string | null; completedAt: string; language: ReportLanguageChoice }
): ReportDocument {
  const warnings: string[] = [];
  const languages = languagesFor(meta.language);
  const sections: Partial<Record<Lang, ReportSection>> = {};
  for (const lang of languages) sections[lang] = section(config, result, lang, warnings);
  return {
    schema: 1,
    reportId: meta.reportId,
    testCode: result.testCode,
    versionId: result.versionId,
    completedAt: meta.completedAt,
    layout: result.layout,
    languages,
    sections,
    warnings: [...new Set(warnings)],
  };
}

function section(config: VersionConfig, result: AssessmentResult, lang: Lang, warnings: string[]): ReportSection {
  const pick = (en: string | undefined | null, hi: string | undefined | null, what: string): string | null => {
    const v = lang === 'en' ? en : hi;
    if (v && v.trim()) return v;
    warnings.push(`${what} has no ${lang === 'en' ? 'English' : 'Hindi'} text.`);
    return null;
  };
  const text = (key: string | null | undefined): string | null => {
    if (!key) return null;
    const t = config.texts.find((x) => x.key === key);
    if (!t) {
      warnings.push(`No text with key ${key}.`);
      return null;
    }
    return pick(t.text_en, t.text_hi, `Text ${key}`);
  };
  const item = (qid: string, kind: 'strength' | 'stuck') => {
    const t = config.item_texts.find((x) => x.qid === qid && x.kind === kind);
    if (!t) warnings.push(`No ${kind} text for ${qid}.`);
    return t ? pick(t.text_en, t.text_hi, `${kind} text for ${qid}`) : null;
  };
  const r = result.report;
  const crisis = result.layout === 'crisis';
  const top = config.report_rules.layouts.crisis.top_block;

  // Snapshot: the core, then the chosen modules.
  const areas: ReportArea[] = [result.coreModule, ...result.chosenModules].map((code) => {
    const m = result.modules[code];
    const mod = config.modules.find((x) => x.code === code);
    const band = config.scoring.bands.find((b) => b.code === m?.band);
    return {
      module: code,
      name: mod ? pick(mod.name_en, mod.name_hi, `Module ${code}`) : null,
      percent: m?.percent ?? null,
      band: m?.band ?? null,
      bandName: band ? pick(band.name_en, band.name_hi, `Band ${band.code}`) : null,
    };
  });

  // Focus lines: split the focus text by the configured separator.
  const sep = config.report_rules.focus.separator;
  const focusItems = r.focus
    .map((f) => {
      const t = config.texts.find((x) => x.key === f.key);
      const full = t ? pick(t.text_en, t.text_hi, `Text ${f.key}`) : null;
      return full?.split(sep)[f.line]?.trim() ?? null;
    })
    .filter((x): x is string => !!x);

  // Blocks: crisis first (crisis layout), the NRI line after the next step, the rest in flag order.
  const flagOfBlock = new Map(result.flags.filter((f) => f.effects.report_block).map((f) => [f.effects.report_block as string, f.key]));
  const blocks: ReportSection['blocks'] = [];
  let nri: string | null = null;
  for (const key of r.blocks) {
    if (crisis && key === top) continue;
    const t = text(key);
    if (!t) continue;
    if (key === SLOTS.nriLine) nri = t;
    else blocks.push({ kind: (flagOfBlock.get(key) ?? '').startsWith(MEDICAL_FLAG_PREFIX) ? 'medical' : 'other', text: t });
  }

  return {
    crisis: crisis ? text(top) : null,
    title: text(SLOTS.title),
    subtitle: text(SLOTS.subtitle),
    designedBy: text(SLOTS.designedBy),
    snapshot: { heading: text(SLOTS.snapshotHeading), note: text(SLOTS.snapshotNote), areas },
    strengths: { heading: text(SLOTS.strengthsHeading), items: r.strengths.map((q) => item(q, 'strength')).filter((x): x is string => !!x) },
    stuck: { heading: text(SLOTS.stuckHeading), items: r.stuck.map((q) => item(q, 'stuck')).filter((x): x is string => !!x) },
    means: { heading: text(SLOTS.meansHeading), items: r.interpretation.map(text).filter((x): x is string => !!x) },
    plan: r.plan
      ? {
          heading: text(SLOTS.planHeading),
          line: planLine(config, result, lang, text, pick, warnings),
          extra: r.plan.addTextKeys.map(text).filter((x): x is string => !!x),
        }
      : null,
    focus: crisis ? null : { heading: text(SLOTS.focusHeading), items: focusItems },
    medicalHeading: blocks.some((b) => b.kind === 'medical') ? text(SLOTS.medicalHeading) : null,
    blocks,
    next: { heading: text(SLOTS.nextHeading), text: text(r.nextStep) },
    nri,
    disclaimer: text(SLOTS.disclaimer),
  };
}

/**
 * PLAN_LINE with {PLAN_NAME}, {SESSIONS}, {FORMAT} (with {MIX}) and {PACE} filled from the Session Tiers
 * and format texts. {PACE} is the tier's pace text without its leading session count ("6 sessions, weekly,
 * about 6 weeks" → "weekly, about 6 weeks"), as in the spec's sample report.
 */
function planLine(
  config: VersionConfig,
  result: AssessmentResult,
  lang: Lang,
  text: (key: string | null | undefined) => string | null,
  pick: (en: string | null | undefined, hi: string | null | undefined, what: string) => string | null,
  warnings: string[]
): string | null {
  const plan = result.report.plan!;
  const template = text(SLOTS.planLine);
  if (!template) return null;
  const tier = config.tiers.find((t) => t.sessions === plan.sessions);
  if (!tier) warnings.push(`No plan for ${plan.sessions} sessions.`);
  const name = tier ? pick(tier.plan_en, tier.plan_hi, `Plan ${plan.sessions}`) : null;
  const paceFull = tier ? pick(tier.pace_en, tier.pace_hi, `Pace ${plan.sessions}`) : null;
  const pace = paceFull ? paceFull.replace(/^\s*\d+\s+[^,]+,\s*/, '') : null;
  let format = text(plan.formatTextKey);
  if (format && plan.split) format = format.replace('{MIX}', `${plan.split.individual} + ${plan.split.couple}`);
  const values: Record<string, string | null> = {
    PLAN_NAME: name,
    SESSIONS: String(plan.sessions),
    FORMAT: format,
    PACE: pace,
  };
  const filled = template.replace(/\{([A-Z_]+)\}/g, (whole, key: string) => {
    const v = values[key];
    if (v === null || v === undefined) {
      warnings.push(`PLAN_LINE placeholder {${key}} has no value.`);
      return whole;
    }
    return v;
  });
  return filled;
}
