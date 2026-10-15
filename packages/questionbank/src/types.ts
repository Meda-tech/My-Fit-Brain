import type {
  Flag,
  FormatRule,
  ModuleKind,
  OptionRule,
  Override,
  PointRule,
  ReportRules,
  Scoring,
  TestCase,
  VisibilityRule,
} from './rules';

// Row types for every qb_* table, the import payload and the full VersionConfig.

export type VersionStatus = 'draft' | 'in_review' | 'live' | 'retired';
export type QuestionType = 'likert' | 'yn' | 'single' | 'multi';
export type Scored = 'yes' | 'no' | 'points';
export type QuestionPath = 'all' | 'partner' | 'solo';
export type ItemTextKind = 'strength' | 'stuck';
export type ItemTextTrigger = 'often' | 'often_or_sometimes' | 'often_sometimes_or_yes';

export interface QbTest {
  code: string;
  name_en: string;
  name_hi: string | null;
  report_id_prefix: string;
  sort: number;
}

export interface QbVersion {
  id: string;
  test_code: string;
  version_label: string;
  status: VersionStatus;
  based_on_version_id: string | null;
  change_note: string | null;
  source_file_name: string | null;
  source_checksum: string | null;
  created_by: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_at: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QbModule {
  code: string;
  name_en: string;
  name_hi: string;
  kind: ModuleKind;
  sort: number;
}

export interface QbQuestion {
  qid: string;
  module_code: string;
  type: QuestionType;
  text_en: string;
  text_hi: string;
  reverse: boolean;
  scored: Scored;
  path: QuestionPath;
  sort: number;
  is_protected: boolean;
  source_note: string | null;
}

export interface QbOption {
  qid: string;
  option_code: string;
  label_en: string;
  label_hi: string;
  value: number | null;
  sort: number;
}

export interface QbText {
  key: string;
  module_code: string | null;
  band: string | null;
  text_en: string;
  text_hi: string;
}

export interface QbItemText {
  qid: string;
  kind: ItemTextKind;
  trigger: ItemTextTrigger;
  text_en: string;
  text_hi: string;
}

export interface QbTier {
  sessions: number;
  plan_en: string;
  plan_hi: string;
  pace_en: string;
  pace_hi: string;
  typical_case: string | null;
}

/** Content parsed from a workbook (no rules). Module kinds and protection come from rules. */
export interface ContentPayload {
  test_code: string;
  version_label: string;
  source_file_name: string;
  source_checksum: string;
  modules: Omit<QbModule, 'kind'>[];
  questions: QbQuestion[];
  options: QbOption[];
  texts: QbText[];
  item_texts: QbItemText[];
  tiers: QbTier[];
  /** Band rows of the Session Tiers tab, for cross-checking the scoring bands. */
  sheet_bands: { min: number; max: number; name_en: string; name_hi: string }[];
  /** Worked Examples rows (literal columns only), for cross-checking test cases. */
  sheet_worked_examples: { case: string; profile: string; expected_tier: number; format: string }[];
  /** Data rows per tab, for the import preview. */
  tab_counts: Record<string, number>;
}

export interface RulesPayload {
  scoring: Scoring;
  point_rules: PointRule[];
  overrides: Override[];
  visibility_rules: VisibilityRule[];
  option_rules: OptionRule[];
  flags: Flag[];
  format_rules: FormatRule[];
  report_rules: ReportRules;
}

/** What qb_import_version(payload) receives: content + rules + test cases. */
export interface ImportPayload extends RulesPayload {
  test_code: string;
  version_label: string;
  source_file_name: string;
  source_checksum: string;
  change_note: string | null;
  modules: QbModule[];
  questions: QbQuestion[];
  options: QbOption[];
  texts: QbText[];
  item_texts: QbItemText[];
  tiers: QbTier[];
  test_cases: TestCase[];
}

export type RulesSource =
  | { kind: 'seed'; file: string }
  | { kind: 'copied'; from_version_id: string; from_version_label: string };

/** Everything the engine and report need for one version. */
export interface VersionConfig extends RulesPayload {
  version: QbVersion;
  test: QbTest;
  modules: QbModule[];
  questions: (QbQuestion & { options: QbOption[] })[];
  texts: QbText[];
  item_texts: QbItemText[];
  tiers: QbTier[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  ref: string | null;
}
