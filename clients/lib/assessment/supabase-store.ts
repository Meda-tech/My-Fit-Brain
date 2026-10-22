import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Answers } from '@mfb/questionnaire';
import type { AttemptStore, LiveVersion, StoredResult } from './store';
import type { AttemptRow } from './types';

// AttemptStore on Supabase with the service role. Only the assessment service calls it, after it has
// checked that the attempt belongs to the signed-in client.

const ATTEMPT_COLUMNS =
  'id, report_id, client_id, questionnaire_code, version_id, status, language, payment_ref, paid_at, consent_at, started_at, completed_at, created_at';

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

export function supabaseAttemptStore(db: SupabaseClient): AttemptStore {
  return {
    async liveVersion(code) {
      const r = await db
        .from('questionnaire_versions')
        .select('id, number, definition')
        .eq('questionnaire_code', code)
        .eq('status', 'live')
        .maybeSingle();
      return check(r, 'live version') as LiveVersion | null;
    },
    async versionDefinition(versionId) {
      const r = await db.from('questionnaire_versions').select('definition').eq('id', versionId).maybeSingle();
      return (check(r, 'version') as { definition: unknown } | null)?.definition ?? null;
    },
    async createPaidAttempt(row) {
      const r = await db.rpc('create_paid_attempt', {
        p_client_id: row.client_id,
        p_code: row.questionnaire_code,
        p_version_id: row.version_id,
        p_payment_ref: row.payment_ref,
        p_paid_at: row.paid_at,
        p_language: row.language,
      });
      const out = check(r, 'create paid attempt') as { created: boolean; attempt: AttemptRow };
      return { created: out.created, attempt: out.attempt };
    },
    async getAttempt(id) {
      const r = await db.from('attempts').select(ATTEMPT_COLUMNS).eq('id', id).maybeSingle();
      return check(r, 'attempt') as unknown as AttemptRow | null;
    },
    async findAttemptByPaymentRef(paymentRef) {
      const r = await db.from('attempts').select(ATTEMPT_COLUMNS).eq('payment_ref', paymentRef).maybeSingle();
      return check(r, 'attempt') as unknown as AttemptRow | null;
    },
    async findOpenAttempt(clientId, code) {
      const r = await db
        .from('attempts')
        .select(ATTEMPT_COLUMNS)
        .eq('client_id', clientId)
        .eq('questionnaire_code', code)
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
      const r = await db.from('attempt_answers').select('question_id, option_ids').eq('attempt_id', attemptId);
      const rows = (check(r, 'answers') ?? []) as { question_id: string; option_ids: string[] }[];
      return Object.fromEntries(rows.map((x) => [x.question_id, x.option_ids]));
    },
    async replaceAnswers(attemptId, answers: Answers) {
      const entries = Object.entries(answers);
      // answered_at is left out: a new row gets now(), an existing row keeps its time.
      const upsert = entries.length
        ? db
            .from('attempt_answers')
            .upsert(entries.map(([question_id, option_ids]) => ({ attempt_id: attemptId, question_id, option_ids })), {
              onConflict: 'attempt_id,question_id',
            })
        : null;
      let others = db.from('attempt_answers').delete().eq('attempt_id', attemptId);
      if (entries.length) others = others.not('question_id', 'in', `(${entries.map(([q]) => `"${q}"`).join(',')})`);
      const [u, d] = await Promise.all([upsert, others]);
      if (u) check(u, 'save answers');
      check(d, 'clear answers');
    },
    async insertAlert(attemptId, kind) {
      const r = await db
        .from('attempt_alerts')
        .upsert({ attempt_id: attemptId, kind }, { onConflict: 'attempt_id,kind', ignoreDuplicates: true })
        .select('id');
      return ((check(r, 'alert') as unknown[] | null) ?? []).length > 0;
    },
    async getResult(attemptId) {
      const r = await db.from('attempt_results').select('result, report').eq('attempt_id', attemptId).maybeSingle();
      return check(r, 'result') as StoredResult | null;
    },
    async insertResult(attemptId, result, report, engineVersion) {
      const r = await db
        .from('attempt_results')
        .upsert({ attempt_id: attemptId, result, report, engine_version: engineVersion }, { onConflict: 'attempt_id', ignoreDuplicates: true });
      check(r, 'save result');
    },
  };
}
