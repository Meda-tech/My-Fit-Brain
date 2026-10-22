import { DESIGNED_BY, REPORT_WORDS, SUPPORT_REPORT, pick } from './defaults';
import type { Definition, Lang, Report, Result } from './types';

// The report, built once when the client submits and stored. Five parts, the same for every
// questionnaire: cover · snapshot · plan · what sessions will work on · next step. Parts with no content
// are left out. On a crisis report the plan and focus are hidden and a support message comes first.

export interface ReportInput {
  lang: Lang;
  clientName: string;
  reportId: string;
  /** ISO timestamp of completion. */
  completedAt: string;
}

export function buildReport(def: Definition, result: Result, input: ReportInput): Report {
  const { lang } = input;
  const t = (x: Parameters<typeof pick>[0]) => pick(x, lang);

  const areas = result.sections
    .filter((s) => s.shown && s.scored)
    .map((s) => {
      const section = def.sections.find((d) => d.id === s.id);
      const meaning = s.range && section?.report ? section.report.meaning[s.range.index - 1] : null;
      return {
        title: t(s.title),
        percent: s.score,
        range: s.range ? t(s.range.label) : t(REPORT_WORDS.notEnough),
        meaning: meaning ? t(meaning) : null,
      };
    });

  const mainSection = result.main ? def.sections.find((d) => d.id === result.main) : null;
  const focusLines = (mainSection?.report?.focus ?? []).map(t).filter(Boolean);

  return {
    lang,
    title: t(def.title),
    subtitle: def.subtitle ? t(def.subtitle) : null,
    designedBy: t(DESIGNED_BY),
    clientName: input.clientName,
    date: input.completedAt,
    reportId: input.reportId,
    disclaimer: t(def.disclaimer),
    crisis: result.crisis,
    support: result.crisis ? t(SUPPORT_REPORT) : null,
    snapshot: { heading: t(REPORT_WORDS.snapshot), areas },
    plan:
      !result.crisis && result.plan
        ? {
            heading: t(REPORT_WORDS.plan),
            name: t(result.plan.name),
            sessions: result.plan.sessions,
            pace: t(result.plan.pace),
            note: t(REPORT_WORDS.planNote),
          }
        : null,
    focus: !result.crisis && mainSection && focusLines.length ? { heading: t(REPORT_WORDS.focus), title: t(mainSection.title), lines: focusLines } : null,
    closing: def.closing ? { heading: t(REPORT_WORDS.next), text: t(def.closing) } : null,
  };
}
