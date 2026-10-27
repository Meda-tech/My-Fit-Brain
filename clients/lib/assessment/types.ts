import type { Lang, Text } from '@mfb/questionnaire';

// Shapes shared by the assessment server layer and the screens.

export type AttemptStatus = 'paid' | 'in_progress' | 'completed';

export interface AttemptRow {
  id: string;
  report_id: string;
  client_id: string;
  questionnaire_code: string;
  version_id: string;
  status: AttemptStatus;
  language: Lang;
  payment_ref: string;
  paid_at: string;
  consent_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/** The signed-in client, as the server layer needs it. */
export interface ClientProfile {
  id: string;
  full_name: string;
}

export interface QuestionView {
  id: string;
  text: Text;
  sectionTitle: Text;
  multiple: boolean;
  maxChoices: number | null;
  options: { id: string; text: Text; skip: boolean }[];
  saved: string[] | null;
  /** 1-based position among the questions shown right now; the total changes with routing. */
  position: number;
  total: number;
  canGoBack: boolean;
}

/** A client-details question: the client types the answer (after the safety questions). */
export interface DetailView {
  id: string;
  text: Text;
  sectionTitle: Text;
  saved: string | null;
  maxLength: number;
  position: number;
  total: number;
  canGoBack: boolean;
}

export type Step =
  | { kind: 'consent' }
  | { kind: 'question'; question: QuestionView }
  | { kind: 'detail'; detail: DetailView }
  | { kind: 'finish'; answered: number; total: number }
  | { kind: 'completed' };

/** Where the client is: an option question or a client-details question (null = the first open one). */
export type At = { kind: 'question' | 'detail'; id: string } | null;

/** The support screen shown at once after the crisis question is answered yes. */
export interface Interrupt {
  text: Text;
}

export class AssessmentError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'NO_LIVE_VERSION' | 'WRONG_STATUS' | 'NOT_VISIBLE' | 'INVALID_ANSWER' | 'INCOMPLETE' | 'BAD_DEFINITION',
    message: string
  ) {
    super(message);
    this.name = 'AssessmentError';
  }
}
