import type { VersionConfig } from '@mfb/questionbank';
import type { AssessmentResult, Warning } from './types';

// Turns the report's text keys into sentences from qb_texts / qb_item_texts. A missing key or language
// gives null and a warning. Text is never generated, edited or filled in here (placeholders such as
// {PLAN_NAME} stay as they are; the report template fills them).

export type ReportLanguage = 'en' | 'hi' | 'both';
export interface LocalText {
  en?: string | null;
  hi?: string | null;
}

export interface ResolvedReport {
  language: ReportLanguage;
  interpretation: (LocalText | null)[];
  strengths: (LocalText | null)[];
  stuck: (LocalText | null)[];
  focus: (LocalText | null)[];
  tone: LocalText | null;
  blocks: (LocalText | null)[];
  nextStep: LocalText | null;
  plan: {
    name: LocalText | null;
    pace: LocalText | null;
    formatText: LocalText | null;
    addTexts: (LocalText | null)[];
  } | null;
  warnings: Warning[];
}

export function resolveReportTexts(config: VersionConfig, result: AssessmentResult, lang: ReportLanguage): ResolvedReport {
  const warnings: Warning[] = [];
  const langs: ('en' | 'hi')[] = lang === 'both' ? ['en', 'hi'] : [lang];

  const pick = (en: string | null | undefined, hi: string | null | undefined, what: string): LocalText => {
    const out: LocalText = {};
    for (const l of langs) {
      const value = l === 'en' ? en : hi;
      if (value && value.trim()) out[l] = value;
      else {
        out[l] = null;
        warnings.push({ code: 'TEXT_LANGUAGE_MISSING', message: `${what} has no ${l === 'en' ? 'English' : 'Hindi'} text.` });
      }
    }
    return out;
  };
  const text = (key: string | null): LocalText | null => {
    if (!key) return null;
    const t = config.texts.find((x) => x.key === key);
    if (!t) {
      warnings.push({ code: 'TEXT_MISSING', message: `No text with key ${key}.` });
      return null;
    }
    return pick(t.text_en, t.text_hi, `Text ${key}`);
  };
  const item = (qid: string, kind: 'strength' | 'stuck'): LocalText | null => {
    const t = config.item_texts.find((x) => x.qid === qid && x.kind === kind);
    if (!t) {
      warnings.push({ code: 'TEXT_MISSING', message: `No ${kind} text for ${qid}.` });
      return null;
    }
    return pick(t.text_en, t.text_hi, `${kind} text for ${qid}`);
  };
  const line = (key: string, n: number): LocalText | null => {
    const t = config.texts.find((x) => x.key === key);
    if (!t) {
      warnings.push({ code: 'TEXT_MISSING', message: `No text with key ${key}.` });
      return null;
    }
    const sep = config.report_rules.focus.separator;
    return pick(t.text_en.split(sep)[n]?.trim(), t.text_hi.split(sep)[n]?.trim(), `Line ${n + 1} of ${key}`);
  };

  const r = result.report;
  const tier = r.plan ? config.tiers.find((t) => t.sessions === r.plan!.sessions) : undefined;
  if (r.plan && !tier) warnings.push({ code: 'TEXT_MISSING', message: `No plan for ${r.plan.sessions} sessions.` });

  return {
    language: lang,
    interpretation: r.interpretation.map(text),
    strengths: r.strengths.map((q) => item(q, 'strength')),
    stuck: r.stuck.map((q) => item(q, 'stuck')),
    focus: r.focus.map((f) => line(f.key, f.line)),
    tone: text(r.tone),
    blocks: r.blocks.map(text),
    nextStep: text(r.nextStep),
    plan: r.plan
      ? {
          name: tier ? pick(tier.plan_en, tier.plan_hi, `Plan for ${tier.sessions} sessions`) : null,
          pace: tier ? pick(tier.pace_en, tier.pace_hi, `Pace for ${tier.sessions} sessions`) : null,
          formatText: text(r.plan.formatTextKey),
          addTexts: r.plan.addTextKeys.map(text),
        }
      : null,
    warnings,
  };
}
