import type { Answers } from '@mfb/questionnaire';
import type { AlertKind, AttemptStore, LiveVersion, NewPaidAttempt, StoredResult } from '../lib/assessment/store';
import type { AttemptRow } from '../lib/assessment/types';

// In-memory AttemptStore for tests. It enforces the same rules as the database triggers that matter to
// the service: answers lock once completed, results never change, one alert per (attempt, kind), and
// createPaidAttempt behaves like public.create_paid_attempt() (per-payment lock; a report number only for
// a new attempt). Each step yields like a database round trip, so concurrent calls interleave.

const roundTrip = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class MemoryStore implements AttemptStore {
  attempts = new Map<string, AttemptRow>();
  answers = new Map<string, Answers>();
  alerts: { attemptId: string; kind: AlertKind }[] = [];
  results = new Map<string, StoredResult & { engineVersion: string }>();
  versions = new Map<string, { code: string; number: number; definition: unknown; live: boolean }>();
  /** Report numbers issued (report_counters.last_number). */
  counter = 0;
  private ids = 0;
  private locks = new Map<string, Promise<void>>();

  addLiveVersion(code: string, definition: unknown): string {
    const id = `version-${this.versions.size + 1}`;
    this.versions.set(id, { code, number: this.versions.size + 1, definition, live: true });
    return id;
  }

  async liveVersion(code: string): Promise<LiveVersion | null> {
    const hit = [...this.versions.entries()].find(([, v]) => v.code === code && v.live);
    return hit ? { id: hit[0], number: hit[1].number, definition: hit[1].definition } : null;
  }
  async versionDefinition(versionId: string) {
    return this.versions.get(versionId)?.definition ?? null;
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
      const existing = [...this.attempts.values()].find((a) => a.payment_ref === row.payment_ref);
      if (existing) return { attempt: { ...existing }, created: false };
      await roundTrip();
      this.counter += 1;
      const attempt: AttemptRow = {
        id: `attempt-${++this.ids}`,
        report_id: `MFB-${row.questionnaire_code}-2026-${String(this.counter).padStart(5, '0')}`,
        client_id: row.client_id,
        questionnaire_code: row.questionnaire_code,
        version_id: row.version_id,
        status: 'paid',
        language: row.language,
        payment_ref: row.payment_ref,
        paid_at: row.paid_at,
        consent_at: null,
        started_at: null,
        completed_at: null,
        created_at: '2026-10-22T00:00:00.000Z',
      };
      this.attempts.set(attempt.id, attempt);
      this.answers.set(attempt.id, {});
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
    const a = [...this.attempts.values()].find((x) => x.payment_ref === paymentRef);
    return a ? { ...a } : null;
  }
  async findOpenAttempt(clientId: string, code: string) {
    const open = [...this.attempts.values()].filter(
      (a) => a.client_id === clientId && a.questionnaire_code === code && (a.status === 'paid' || a.status === 'in_progress')
    );
    return open.at(-1) ? { ...open.at(-1)! } : null;
  }
  async listAttempts(clientId: string) {
    return [...this.attempts.values()].filter((a) => a.client_id === clientId).reverse();
  }
  async updateAttempt(id: string, patch: Partial<AttemptRow>) {
    const a = this.attempts.get(id)!;
    if (a.status === 'completed') throw new Error('attempt is completed');
    const next = { ...a, ...patch };
    this.attempts.set(id, next);
    return { ...next };
  }
  private locked(attemptId: string) {
    if (this.attempts.get(attemptId)?.status === 'completed') throw new Error('answers are locked');
  }
  async getAnswers(attemptId: string) {
    return structuredClone(this.answers.get(attemptId) ?? {});
  }
  async replaceAnswers(attemptId: string, answers: Answers) {
    this.locked(attemptId);
    this.answers.set(attemptId, structuredClone(answers));
  }
  async insertAlert(attemptId: string, kind: AlertKind) {
    if (this.alerts.some((a) => a.attemptId === attemptId && a.kind === kind)) return false;
    this.alerts.push({ attemptId, kind });
    return true;
  }
  async getResult(attemptId: string) {
    return this.results.get(attemptId) ?? null;
  }
  async insertResult(attemptId: string, result: unknown, report: unknown, engineVersion: string) {
    if (!this.results.has(attemptId)) this.results.set(attemptId, structuredClone({ result, report, engineVersion }));
  }
}
