import type { AnswerRow, AttemptRow, EventRow } from './types';

// Persistence used by the assessment service. The Supabase implementation (service role) lives in
// supabase-store.ts; tests use an in-memory one. Every method is a plain read or write: ownership and
// rules are checked in service.ts.

export type NewAttempt = Omit<AttemptRow, 'id' | 'created_at'>;

export interface StoredResult {
  result: unknown;
  report: unknown;
}

export interface AttemptStore {
  /** The live version of a test, or null. */
  liveVersionId(testCode: string): Promise<string | null>;
  /** Next report ID for the test (MFB-IA-2026-00001). */
  nextReportId(testCode: string): Promise<string>;
  createAttempt(row: NewAttempt): Promise<AttemptRow>;
  getAttempt(id: string): Promise<AttemptRow | null>;
  /** An unfinished (paid or in progress) attempt of this test for this client, if any. */
  findOpenAttempt(clientId: string, testCode: string): Promise<AttemptRow | null>;
  /** The attempt created for a live payment (gateway payment ID), if any. */
  findAttemptByPaymentRef(paymentRef: string): Promise<AttemptRow | null>;
  listAttempts(clientId: string): Promise<AttemptRow[]>;
  updateAttempt(id: string, patch: Partial<NewAttempt>): Promise<AttemptRow>;
  getAnswers(attemptId: string): Promise<AnswerRow[]>;
  upsertAnswers(attemptId: string, rows: AnswerRow[]): Promise<void>;
  /**
   * Makes the stored answers exactly these rows: upserts them and deletes every other answer of the
   * attempt. Used when a batch of answers buffered in the browser is saved.
   */
  replaceAnswers(attemptId: string, rows: AnswerRow[]): Promise<void>;
  /** Deletes the given answers, or every answer of the attempt. */
  deleteAnswers(attemptId: string, qids: string[] | 'all'): Promise<void>;
  /** Inserts once per (attempt, flag); returns false when it already existed. */
  insertEvent(event: EventRow): Promise<boolean>;
  getResult(attemptId: string): Promise<StoredResult | null>;
  /** Inserts once; a second call for the same attempt does nothing. */
  insertResult(attemptId: string, result: unknown, report: unknown): Promise<void>;
}
