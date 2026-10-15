import type { BandName, FlagEffects, Format, ModuleKind, QuestionType, Scored } from '@mfb/questionbank';

// Inputs and outputs of the engine. Everything the engine decides comes from a VersionConfig.

export type Sex = 'Male' | 'Female' | 'Prefer not to say';
export type Mode = 'initial' | 'progress';
export type Path = 'partner' | 'solo';
/** qid → option code (single) or option codes (multi). */
export type Answers = Record<string, string | string[]>;

export interface EngineContext {
  /** Gender from registration. */
  sex: Sex;
  /** Exact age in years from registration. */
  age: number;
  mode: Mode;
  /** The first assessment's result; required in progress mode. */
  firstResult?: AssessmentResult;
}

export interface FlowOption {
  code: string;
  label_en: string;
  label_hi: string;
  value: number | null;
  exclusive: boolean;
}

export interface FlowItem {
  qid: string;
  module: string;
  moduleKind: ModuleKind;
  type: QuestionType;
  reverse: boolean;
  scored: Scored;
  text_en: string;
  text_hi: string;
  /** Visible options in display order. */
  options: FlowOption[];
  /** For the gate: how many options may be chosen. */
  minChoices?: number;
  maxChoices?: number;
  answered: boolean;
  /** Filled from registration (or, in progress mode, reused from the first assessment). */
  prefilled: boolean;
}

export interface ModuleResult {
  scoredItems: number;
  shownItems: number;
  sum: number;
  max: number;
  percent: number | null;
  band: BandName | null;
}

export interface FormatResult {
  type: Format;
  /** Mixed format: individual + couple sessions for the tier. */
  split?: { individual: number; couple: number };
  addTextKeys: string[];
  /** Which rule or flag decided it. */
  source: { kind: 'flag' | 'rule'; key: string };
}

export interface FiredFlag {
  key: string;
  effects: FlagEffects;
}

/** Language-independent report content: text keys and item ids only. */
export interface ReportKeys {
  /** qb_texts keys, in print order, without repeats. */
  interpretation: string[];
  /** Question ids whose STRENGTH text prints, in order. */
  strengths: string[];
  /** Question ids whose STUCK text prints, in order. */
  stuck: string[];
  /** Focus text keys and the line (0-based) of each to print. */
  focus: { key: string; line: number }[];
  tone: string | null;
  /** Report blocks (medical, safety, crisis, …) in print order. */
  blocks: string[];
  nextStep: string | null;
  /** Hidden in the crisis layout. */
  plan: {
    sessions: number;
    format: Format | null;
    split?: { individual: number; couple: number };
    formatTextKey: string | null;
    addTextKeys: string[];
  } | null;
  /** Text keys the layout hides (crisis layout). */
  hidden: string[];
}

export interface Warning {
  code: string;
  message: string;
}

export interface TraceStep {
  step: string;
  detail: string;
}

export interface AssessmentResult {
  engineVersion: string;
  versionId: string;
  testCode: string;
  mode: Mode;
  path: Path | null;
  coreModule: string;
  chosenModules: string[];
  modules: Record<string, ModuleResult>;
  primary: string;
  second: string | null;
  /** Null in progress mode. */
  points: { total: number; breakdown: { key: string; label: string; points: number }[] } | null;
  tierBeforeOverrides: number | null;
  overridesApplied: { key: string; from: number; to: number }[];
  tier: number | null;
  format: FormatResult | null;
  flags: FiredFlag[];
  layout: 'standard' | 'crisis';
  /** Who must be told, per flag (for notifications). */
  notify: { flag: string; recipients: string[] }[];
  report: ReportKeys;
  counsellor: {
    readiness: { qid: string; answer: string } | null;
    tags: string[];
    rawAnswers: Answers;
  };
  warnings: Warning[];
  trace: TraceStep[];
}

export interface ProgressComparison {
  headingKey: string;
  lineKey: string;
  areas: {
    module: string;
    before: number | null;
    now: number | null;
    change: number | null;
    classification: 'better' | 'same' | 'worse' | null;
    textKey: string | null;
  }[];
}

export interface TestCaseDiff {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface TestCaseRun {
  passed: boolean;
  actual: AssessmentResult | null;
  diffs: TestCaseDiff[];
  error: string | null;
}
