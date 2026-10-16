import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttemptStore, NewAttempt, StoredResult } from './store';
import type { AnswerRow, AttemptRow, EventRow } from './types';

// AttemptStore on Supabase with the service role. Only the assessment service calls it, after it has
// checked that the attempt belongs to the signed-in client.

const ATTEMPT_COLUMNS =
  'id, report_id, client_id, test_code, version_id, kind, status, report_language, consent_at, payment_mode, ' +
  'payment_ref, paid_at, started_at, completed_at, engine_version, created_at';

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

export function supabaseAttemptStore(db: SupabaseClient): AttemptStore {
  return {
    async liveVersionId(testCode) {
      const r = await db.from('qb_versions').select('id').eq('test_code', testCode).eq('status', 'live').maybeSingle();
      return (check(r, 'live version') as { id: string } | null)?.id ?? null;
    },
    async nextReportId(testCode) {
      const r = await db.rpc('next_report_id', { p_test_code: testCode });
      return check(r, 'report id') as string;
    },
    async createAttempt(row: NewAttempt) {
      const r = await db.from('attempts').insert(row).select(ATTEMPT_COLUMNS).single();
      return check(r, 'create attempt') as unknown as AttemptRow;
    },
    async getAttempt(id) {
      const r = await db.from('attempts').select(ATTEMPT_COLUMNS).eq('id', id).maybeSingle();
      return check(r, 'attempt') as unknown as AttemptRow | null;
    },
    async findAttemptByPaymentRef(paymentRef) {
      const r = await db
        .from('attempts')
        .select(ATTEMPT_COLUMNS)
        .eq('payment_mode', 'live')
        .eq('payment_ref', paymentRef)
        .maybeSingle();
      return check(r, 'attempt') as unknown as AttemptRow | null;
    },
    async findOpenAttempt(clientId, testCode) {
      const r = await db
        .from('attempts')
        .select(ATTEMPT_COLUMNS)
        .eq('client_id', clientId)
        .eq('test_code', testCode)
        .in('status', ['paid', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return check(r, 'open attempt') as unknown as AttemptRow | null;
    },
    async listAttempts(clientId) {
      const r = await db.from('attempts').select(ATTEMPT_COLUMNS).eq('client_id', clientId).order('created_at', { ascending: false });
      return (check(r, 'attempts') ?? []) as unknown as AttemptRow[];
    },
    async updateAttempt(id, patch) {
      const r = await db.from('attempts').update(patch).eq('id', id).select(ATTEMPT_COLUMNS).single();
      return check(r, 'update attempt') as unknown as AttemptRow;
    },
    async getAnswers(attemptId) {
      const r = await db.from('attempt_answers').select('qid, value, source').eq('attempt_id', attemptId);
      return (check(r, 'answers') ?? []) as AnswerRow[];
    },
    async upsertAnswers(attemptId, rows) {
      const now = new Date().toISOString();
      const r = await db
        .from('attempt_answers')
        .upsert(rows.map((x) => ({ attempt_id: attemptId, qid: x.qid, value: x.value, source: x.source, answered_at: now })), {
          onConflict: 'attempt_id,qid',
        });
      check(r, 'save answers');
    },
    async replaceAnswers(attemptId, rows) {
      // answered_at is left out: a new row gets now(), an existing row keeps its time.
      const upsert = rows.length
        ? db
            .from('attempt_answers')
            .upsert(rows.map((x) => ({ attempt_id: attemptId, qid: x.qid, value: x.value, source: x.source })), {
              onConflict: 'attempt_id,qid',
            })
        : null;
      let others = db.from('attempt_answers').delete().eq('attempt_id', attemptId);
      if (rows.length) others = others.not('qid', 'in', `(${rows.map((x) => `"${x.qid}"`).join(',')})`);
      const [u, d] = await Promise.all([upsert, others]);
      if (u) check(u, 'save answers');
      check(d, 'clear answers');
    },
    async deleteAnswers(attemptId, qids) {
      let q = db.from('attempt_answers').delete().eq('attempt_id', attemptId);
      if (qids !== 'all') q = q.in('qid', qids);
      check(await q, 'delete answers');
    },
    async insertEvent(event: EventRow) {
      const r = await db
        .from('attempt_events')
        .upsert(event, { onConflict: 'attempt_id,flag_key', ignoreDuplicates: true })
        .select('id');
      return ((check(r, 'event') as unknown[] | null) ?? []).length > 0;
    },
    async getResult(attemptId) {
      const r = await db.from('attempt_results').select('result, report').eq('attempt_id', attemptId).maybeSingle();
      return check(r, 'result') as StoredResult | null;
    },
    async insertResult(attemptId, result, report) {
      const r = await db
        .from('attempt_results')
        .upsert({ attempt_id: attemptId, result, report }, { onConflict: 'attempt_id', ignoreDuplicates: true });
      check(r, 'save result');
    },
  };
}
