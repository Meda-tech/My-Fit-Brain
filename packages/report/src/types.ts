// The report as stored in attempt_results.report: every sentence is already resolved from the
// question-bank version at submit time, so the report never changes and needs no config to render.

export type Lang = 'en' | 'hi';

export interface ReportArea {
  module: string;
  name: string | null;
  percent: number | null;
  /** Band code (Low, Mild, Moderate, High) — picks the band colour. */
  band: string | null;
  bandName: string | null;
}

export interface ReportSection {
  /** Crisis layout only: printed first. */
  crisis: string | null;
  title: string | null;
  subtitle: string | null;
  designedBy: string | null;
  snapshot: { heading: string | null; note: string | null; areas: ReportArea[] };
  strengths: { heading: string | null; items: string[] };
  stuck: { heading: string | null; items: string[] };
  means: { heading: string | null; items: string[] };
  /** Hidden (null) in the crisis layout. */
  plan: { heading: string | null; line: string | null; extra: string[] } | null;
  /** Hidden (null) in the crisis layout. */
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
