import type { Answers, Lang } from '@mfb/questionnaire';
import type { AttemptRow } from './types';

// Persistence used by the assessment service. The Supabase implementation (service role) lives in
// supabase-store.ts; tests use an in-memory one. Every method is a plain read or write: ownership and
// rules are checked in service.ts.

export interface LiveVersion {
  id: string;
  number: number;
  /** The imported JSON, as stored. */
  definition: unknown;
}

export interface NewPaidAttempt {
  client_id: string;
  questionnaire_code: string;
  version_id: string;
  payment_ref: string;
  paid_at: string;
  language: Lang;
}

export interface StoredResult {
  result: unknown;
  report: unknown;
}

export type AlertKind = 'crisis' | 'home_safety';

export interface AttemptStore {
  /** The live version of a questionnaire, or null. */
  liveVersion(code: string): Promise<LiveVersion | null>;
  /** The stored JSON of any version (the attempt's pinned one). */
  versionDefinition(versionId: string): Promise<unknown | null>;
  /**
   * Creates the attempt for a payment, or returns the one that exists (created: false). The report ID
   * is taken in the same transaction as the insert and only for a new attempt (public.create_paid_attempt).
   */
  createPaidAttempt(row: NewPaidAttempt): Promise<{ attempt: AttemptRow; created: boolean }>;
  getAttempt(id: string): Promise<AttemptRow | null>;
  /** An unfinished (paid or in progress) attempt of this questionnaire for this client, if any. */
  findOpenAttempt(clientId: string, code: string): Promise<AttemptRow | null>;
  findAttemptByPaymentRef(paymentRef: string): Promise<AttemptRow | null>;
  listAttempts(clientId: string): Promise<AttemptRow[]>;
  updateAttempt(id: string, patch: Partial<Pick<AttemptRow, 'status' | 'language' | 'consent_at' | 'started_at' | 'completed_at'>>): Promise<AttemptRow>;
  getAnswers(attemptId: string): Promise<Answers>;
  /** Makes the stored answers exactly these: upserts them and deletes every other answer of the attempt. */
  replaceAnswers(attemptId: string, answers: Answers): Promise<void>;
  /** Inserts once per (attempt, kind); returns false when it already existed. */
  insertAlert(attemptId: string, kind: AlertKind): Promise<boolean>;
  getResult(attemptId: string): Promise<StoredResult | null>;
  /** Inserts once; a second call for the same attempt does nothing. */
  insertResult(attemptId: string, result: unknown, report: unknown, engineVersion: string): Promise<void>;
}
