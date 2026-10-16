import type { AttemptStore, NewAttempt, NewPaidAttempt, StoredResult } from '../lib/assessment/store';
import type { AnswerRow, AttemptRow, EventRow } from '../lib/assessment/types';

// In-memory AttemptStore for tests. It enforces the same rules as the database triggers that matter
// to the service: answers lock once completed, results never change, one event per (attempt, flag),
// and createPaidAttempt behaves like public.create_paid_attempt() (per-payment lock; a report number
// only for a new attempt). Each step yields like a database round trip, so concurrent calls interleave.

const roundTrip = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class MemoryStore implements AttemptStore {
  attempts = new Map<string, AttemptRow>();
  answers = new Map<string, Map<string, AnswerRow>>();
  events: EventRow[] = [];
  results = new Map<string, StoredResult>();
  live: Record<string, string> = {};
  /** Report numbers issued (report_counters.last_number). */
  counter = 0;
  private ids = 0;
  private locks = new Map<string, Promise<void>>();

  async liveVersionId(testCode: string) {
    return this.live[testCode] ?? null;
  }
  async createPaidAttempt(row: NewPaidAttempt) {
    // pg_advisory_xact_lock on the payment reference: callers for one payment run one after another.
    const previous = this.locks.get(row.payment_ref) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    this.locks.set(row.payment_ref, previous.then(() => held));
    await previous;
    try {
      await roundTrip();
      const existing = [...this.attempts.values()].find((a) => a.payment_mode === 'live' && a.payment_ref === row.payment_ref);
      if (existing) return { attempt: { ...existing }, created: false };
      await roundTrip();
      // next_report_id() and the insert, in one transaction.
      this.counter += 1;
      const attempt: AttemptRow = {
        id: `attempt-${++this.ids}`,
        report_id: `MFB-${row.test_code}-2026-${String(this.counter).padStart(5, '0')}`,
        client_id: row.client_id,
        test_code: row.test_code,
        version_id: row.version_id,
        kind: 'initial',
        status: 'paid',
        report_language: null,
        consent_at: null,
        payment_mode: 'live',
        payment_ref: row.payment_ref,
        paid_at: row.paid_at,
        started_at: null,
        completed_at: null,
        engine_version: null,
        created_at: '2026-10-18T00:00:00.000Z',
      };
      this.attempts.set(attempt.id, attempt);
      this.answers.set(attempt.id, new Map());
      return { attempt: { ...attempt }, created: true };
    } finally {
      release();
    }
  }
  async getAttempt(id: string) {
    const a = this.attempts.get(id);
    return a ? { ...a } : null;
  }
  async findAttemptByPaymentRef(paymentRef: string) {
    const a = [...this.attempts.values()].find((x) => x.payment_mode === 'live' && x.payment_ref === paymentRef);
    return a ? { ...a } : null;
  }
  async findOpenAttempt(clientId: string, testCode: string) {
    const open = [...this.attempts.values()].filter(
      (a) => a.client_id === clientId && a.test_code === testCode && (a.status === 'paid' || a.status === 'in_progress')
    );
    return open.at(-1) ? { ...open.at(-1)! } : null;
  }
  async listAttempts(clientId: string) {
    return [...this.attempts.values()].filter((a) => a.client_id === clientId).reverse();
  }
  async updateAttempt(id: string, patch: Partial<NewAttempt>) {
    const a = this.attempts.get(id)!;
    if (a.status === 'completed' || a.status === 'stopped') throw new Error(`attempt is ${a.status}`);
    const next = { ...a, ...patch };
    this.attempts.set(id, next);
    return { ...next };
  }
  private locked(attemptId: string) {
    if (this.attempts.get(attemptId)?.status === 'completed') throw new Error('answers are locked');
  }
  async getAnswers(attemptId: string) {
    return [...(this.answers.get(attemptId)?.values() ?? [])].map((r) => ({ ...r }));
  }
  async upsertAnswers(attemptId: string, rows: AnswerRow[]) {
    this.locked(attemptId);
    for (const r of rows) this.answers.get(attemptId)!.set(r.qid, { ...r });
  }
  async replaceAnswers(attemptId: string, rows: AnswerRow[]) {
    this.locked(attemptId);
    if (this.attempts.get(attemptId)?.status === 'stopped') throw new Error('attempt is stopped');
    const m = this.answers.get(attemptId)!;
    m.clear();
    for (const r of rows) m.set(r.qid, { ...r });
  }
  async deleteAnswers(attemptId: string, qids: string[] | 'all') {
    this.locked(attemptId);
    const m = this.answers.get(attemptId)!;
    if (qids === 'all') m.clear();
    else for (const q of qids) m.delete(q);
  }
  async insertEvent(event: EventRow) {
    if (this.events.some((e) => e.attempt_id === event.attempt_id && e.flag_key === event.flag_key)) return false;
    this.events.push({ ...event });
    return true;
  }
  async getResult(attemptId: string) {
    return this.results.get(attemptId) ?? null;
  }
  async insertResult(attemptId: string, result: unknown, report: unknown) {
    if (!this.results.has(attemptId)) this.results.set(attemptId, structuredClone({ result, report }));
  }
}
