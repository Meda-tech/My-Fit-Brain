import type { AttemptStore, NewAttempt, StoredResult } from '../lib/assessment/store';
import type { AnswerRow, AttemptRow, EventRow } from '../lib/assessment/types';

// In-memory AttemptStore for tests. It enforces the same rules as the database triggers that matter
// to the service: answers lock once completed, results never change, one event per (attempt, flag).

export class MemoryStore implements AttemptStore {
  attempts = new Map<string, AttemptRow>();
  answers = new Map<string, Map<string, AnswerRow>>();
  events: EventRow[] = [];
  results = new Map<string, StoredResult>();
  live: Record<string, string> = {};
  private counter = 0;
  private ids = 0;

  async liveVersionId(testCode: string) {
    return this.live[testCode] ?? null;
  }
  async nextReportId(testCode: string) {
    this.counter += 1;
    return `MFB-${testCode}-2026-${String(this.counter).padStart(5, '0')}`;
  }
  async createAttempt(row: NewAttempt) {
    const attempt: AttemptRow = { ...row, id: `attempt-${++this.ids}`, created_at: '2026-10-18T00:00:00.000Z' };
    this.attempts.set(attempt.id, attempt);
    this.answers.set(attempt.id, new Map());
    return { ...attempt };
  }
  async getAttempt(id: string) {
    const a = this.attempts.get(id);
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
