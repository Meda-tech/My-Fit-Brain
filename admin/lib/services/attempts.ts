import type { AssessmentResult } from '@mfb/engine';
import type { ReportDocument } from '@mfb/report';
import { createClient } from '../supabase/server';
import { requireStaff } from '../auth';

// Read-only attempt data for staff. Reads go through the staff session, so RLS decides access:
// every active staff member sees attempts and safety events; only super admins and counsellors see
// answers and results (can_view_reports()). Coordinators never see reports.

/** Roles that may see reports, answers and the counsellor view (mirrors can_view_reports()). */
export const REPORT_ROLES = ['super_admin', 'counsellor'] as const;

export function canViewReports(role: string): boolean {
  return (REPORT_ROLES as readonly string[]).includes(role);
}

export interface AttemptListRow {
  id: string;
  report_id: string;
  client_id: string;
  test_code: string;
  test_name: string;
  version_id: string;
  version_label: string;
  kind: 'initial' | 'progress';
  status: 'paid' | 'in_progress' | 'completed' | 'stopped';
  report_language: 'en' | 'hi' | 'both' | null;
  payment_mode: 'stub' | 'live';
  paid_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AttemptAnswer {
  qid: string;
  value: string | string[];
  source: 'client' | 'profile';
  answered_at: string;
}

export interface AttemptEvent {
  id: string;
  kind: 'crisis' | 'safety' | 'age_stop';
  flag_key: string;
  notify: unknown;
  created_at: string;
  handled_at: string | null;
}

export interface AttemptDetail {
  attempt: AttemptListRow;
  clientName: string | null;
  answers: AttemptAnswer[];
  events: AttemptEvent[];
  result: AssessmentResult | null;
  report: ReportDocument | null;
}

const ATTEMPT_COLUMNS =
  'id, report_id, client_id, test_code, version_id, kind, status, report_language, payment_mode, paid_at, started_at, completed_at, created_at, qb_tests(name_en), qb_versions(version_label)';

type RawAttempt = Omit<AttemptListRow, 'test_name' | 'version_label'> & {
  qb_tests?: { name_en?: string | null } | null;
  qb_versions?: { version_label?: string | null } | null;
};

function toRow(r: RawAttempt): AttemptListRow {
  const { qb_tests, qb_versions, ...rest } = r;
  return { ...rest, test_name: qb_tests?.name_en ?? r.test_code, version_label: qb_versions?.version_label ?? '' };
}

export async function listClientAttempts(clientId: string): Promise<AttemptListRow[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('attempts')
    .select(ATTEMPT_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not read assessments: ${error.message}`);
  return ((data ?? []) as unknown as RawAttempt[]).map(toRow);
}

export async function getAttemptDetail(id: string): Promise<AttemptDetail | null> {
  const { profile } = await requireStaff();
  const withReport = canViewReports(profile.role);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('attempts')
    .select(`${ATTEMPT_COLUMNS}, clients(full_name)`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not read assessment: ${error.message}`);
  if (!data) return null;
  const raw = data as unknown as RawAttempt & { clients?: { full_name?: string | null } | null };

  const none = { data: null, error: null };
  const [answers, events, result] = await Promise.all([
    withReport
      ? supabase.from('attempt_answers').select('qid, value, source, answered_at').eq('attempt_id', id).order('answered_at')
      : none,
    supabase
      .from('attempt_events')
      .select('id, kind, flag_key, notify, created_at, handled_at')
      .eq('attempt_id', id)
      .order('created_at'),
    withReport ? supabase.from('attempt_results').select('result, report').eq('attempt_id', id).maybeSingle() : none,
  ]);
  for (const r of [answers, events, result]) {
    if (r.error) throw new Error(`Could not read assessment data: ${r.error.message}`);
  }

  const { clients, ...attempt } = raw;
  return {
    attempt: toRow(attempt),
    clientName: clients?.full_name ?? null,
    answers: (answers.data ?? []) as AttemptAnswer[],
    events: (events.data ?? []) as AttemptEvent[],
    result: (result.data?.result as AssessmentResult | undefined) ?? null,
    report: (result.data?.report as ReportDocument | undefined) ?? null,
  };
}

/** Dashboard counts. Zero when the attempts table is not there yet. */
export async function attemptCounts(): Promise<{ completed: number; inProgress: number }> {
  await requireStaff();
  const supabase = await createClient();
  const count = async (statuses: string[]) => {
    const { count: n, error } = await supabase
      .from('attempts')
      .select('id', { count: 'exact', head: true })
      .in('status', statuses);
    return error ? 0 : n ?? 0;
  };
  const [completed, inProgress] = await Promise.all([count(['completed']), count(['paid', 'in_progress'])]);
  return { completed, inProgress };
}
