import type { QuestionType } from '@mfb/questionbank';

// Shapes shared by the assessment server layer and the screens.

export type AttemptStatus = 'paid' | 'in_progress' | 'completed' | 'stopped';
export type ReportLanguageChoice = 'en' | 'hi' | 'both';
export type AnswerValue = string | string[];
export type AnswerSource = 'client' | 'profile';

export interface AttemptRow {
  id: string;
  report_id: string | null;
  client_id: string;
  test_code: string;
  version_id: string;
  kind: 'initial' | 'progress';
  status: AttemptStatus;
  report_language: ReportLanguageChoice | null;
  consent_at: string | null;
  payment_mode: 'stub' | 'live';
  payment_ref: string | null;
  paid_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  engine_version: string | null;
  created_at: string;
}

export interface AnswerRow {
  qid: string;
  value: AnswerValue;
  source: AnswerSource;
}

export interface EventRow {
  attempt_id: string;
  kind: 'crisis' | 'safety' | 'age_stop';
  flag_key: string;
  notify: string[];
}

/** The signed-in client, as the server layer needs it. */
export interface ClientProfile {
  id: string;
  gender: string;
  age: number;
  marital_status: string;
}

export interface QuestionView {
  qid: string;
  type: QuestionType;
  text_en: string;
  text_hi: string;
  options: { code: string; label_en: string; label_hi: string; exclusive: boolean }[];
  /** Multi-select only. */
  minChoices?: number;
  maxChoices?: number;
  saved: AnswerValue | null;
  /** 1-based position among the questions the client answers; total can change with routing. */
  position: number;
  total: number;
  canGoBack: boolean;
}

export interface LocalPair {
  en: string | null;
  hi: string | null;
}

export type Step =
  | { kind: 'consent' }
  | { kind: 'question'; question: QuestionView }
  | { kind: 'finish'; answered: number; total: number }
  | { kind: 'completed' }
  | { kind: 'stopped'; text: LocalPair | null };

export interface Interrupt {
  flag: string;
  text: LocalPair | null;
}

export class AssessmentError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'PAYMENTS_DISABLED'
      | 'NO_LIVE_VERSION'
      | 'WRONG_STATUS'
      | 'NOT_VISIBLE'
      | 'INVALID_ANSWER'
      | 'INCOMPLETE'
      | 'BAD_PROFILE',
    message: string
  ) {
    super(message);
    this.name = 'AssessmentError';
  }
}
