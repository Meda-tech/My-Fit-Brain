// The questionnaire JSON (the only format) and the shapes the engine produces from it.
// Spec: docs/questionnaires/README.md. Nothing here is specific to one questionnaire.

export type Lang = 'en' | 'hi';

/** A sentence in English with an optional Hindi version (English is used when Hindi is missing). */
export interface Text {
  en: string;
  hi?: string | null;
}

/** The complete list of rules. An unanswered question or a hidden section always counts as false. */
export type Rule =
  | { question: string; is: string[] }
  | { question: string; is_not: string[] }
  | { question: string; includes: string[] }
  | { section: string; score_at_least: number }
  | { section: string; score_at_most: number }
  | { all: Rule[] }
  | { any: Rule[] };

export interface Option {
  id: string;
  text: Text;
  /** null = this answer is skipped in scores ("Not applicable", "Unsure"). */
  value: number | null;
  /** Counsellor view only; never shown to the client or printed. */
  note?: string | null;
}

export interface Question {
  id: string;
  text: Text;
  multiple: boolean;
  max_choices: number | null;
  show_when: Rule | null;
  options: Option[];
}

export interface SectionReport {
  /** One line per range, in range order (missing lines are simply not printed). */
  meaning: Text[];
  /** "What sessions will work on" lines, printed when this is the main area. */
  focus: Text[];
}

export interface Section {
  id: string;
  title: Text;
  scored: boolean;
  show_when: Rule | null;
  report: SectionReport | null;
  questions: Question[];
  /** The safety section added by the engine (never part of the JSON). */
  builtin?: boolean;
}

export interface Range {
  up_to: number;
  en: string;
  hi?: string | null;
}

export interface PlanRow {
  /** 1-based range index of the main area that selects this row. */
  range: number;
  name: Text;
  sessions: number;
  pace: Text;
}

/**
 * A client-details question, asked after the safety questions. The client types the answer. No value,
 * no rules, not scored and never in the report: the care team reads it in the counsellor view.
 */
export interface ClientDetail {
  id: string;
  text: Text;
}

/** A questionnaire after parsing: defaults filled, safety section not yet added (see withSafety). */
export interface Definition {
  title: Text;
  subtitle: Text | null;
  closing: Text | null;
  disclaimer: Text;
  ranges: Range[];
  plan: PlanRow[];
  sections: Section[];
  /**
   * The JSON's client-details list, or null when the JSON has none. Publishing a version that has one
   * replaces the questionnaire's list; after that the admin edits the list directly (it is not versioned).
   */
  client_details: ClientDetail[] | null;
}

/** Chosen option ids per question id (a single-choice answer is a one-item list). */
export type Answers = Record<string, string[]>;

export interface Issue {
  /** Where, in plain words: "Section 2, question 3, option 1". */
  where: string;
  message: string;
}

export interface SectionResult {
  id: string;
  title: Text;
  scored: boolean;
  shown: boolean;
  /** 0–100, or null (not shown, not scored, or not enough answers). */
  score: number | null;
  range: { index: number; label: Text } | null;
  /** Questions shown, answered, and answered with a value. */
  shownQuestions: number;
  answered: number;
  withValue: number;
}

export interface ValuedAnswer {
  questionId: string;
  optionId: string;
  value: number;
  /** The answer as a % of its own question's value range. */
  percent: number;
}

export interface Note {
  questionId: string;
  optionId: string;
  note: string;
}

export interface Result {
  engineVersion: string;
  sections: SectionResult[];
  /** The scored section with the highest score, or null. */
  main: string | null;
  plan: PlanRow | null;
  crisis: boolean;
  homeSafety: boolean;
  notes: Note[];
  /** The highest-value answer of every question that got one, highest percent first. */
  valued: ValuedAnswer[];
}

/** The stored report, in the client's language. Five parts; empty parts are left out when printed. */
export interface Report {
  lang: Lang;
  title: string;
  subtitle: string | null;
  designedBy: string;
  clientName: string;
  date: string;
  reportId: string;
  disclaimer: string;
  crisis: boolean;
  /** Printed first on a crisis report, instead of the plan. */
  support: string | null;
  snapshot: { heading: string; areas: { title: string; percent: number | null; range: string | null; meaning: string | null }[] };
  plan: { heading: string; name: string; sessions: number; pace: string; note: string } | null;
  focus: { heading: string; title: string; lines: string[] } | null;
  closing: { heading: string; text: string } | null;
}
