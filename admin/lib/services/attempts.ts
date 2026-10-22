import { parseDefinition, withSafety, type Answers, type Definition, type Report, type Result } from '@mfb/questionnaire';
import { createClient } from '../supabase/server';
import { requireStaff } from '../auth';

// Read-only attempt data for staff. Reads go through the staff session, so RLS decides access: every
// active staff member sees attempts and alerts; only super admins and counsellors see answers and
// results (can_view_reports()). Coordinators never see the counsellor view or the PDF.

export const REPORT_ROLES = ['super_admin', 'counsellor'] as const;

export function canViewReports(role: string): boolean {
  return (REPORT_ROLES as readonly string[]).includes(role);
}

export type AttemptStatus = 'paid' | 'in_progress' | 'completed';

export interface AttemptListRow {
  id: string;
  report_id: string;
  client_id: string;
  questionnaire_code: string;
  questionnaire_name: string;
  version_id: string;
  version_number: number | null;
  status: AttemptStatus;
  language: 'en' | 'hi';
  payment_ref: string;
  paid_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AttemptAlert {
  id: string;
  kind: 'crisis' | 'home_safety';
  created_at: string;
  handled_at: string | null;
}

export interface AttemptDetail {
  attempt: AttemptListRow;
  clientName: string | null;
  alerts: AttemptAlert[];
  /** Report roles only; null for coordinators. */
  answers: Answers | null;
  result: Result | null;
  report: Report | null;
  /** The pinned version, parsed (with the safety section); null when not readable. */
  definition: Definition | null;
}

const ATTEMPT_COLUMNS =
  'id, report_id, client_id, questionnaire_code, version_id, status, language, payment_ref, paid_at, started_at, completed_at, created_at, questionnaires(name_en), questionnaire_versions(number)';

type RawAttempt = Omit<AttemptListRow, 'questionnaire_name' | 'version_number'> & {
  questionnaires?: { name_en?: string | null } | null;
  questionnaire_versions?: { number?: number | null } | null;
};

function toRow(r: RawAttempt): AttemptListRow {
  const { questionnaires, questionnaire_versions, ...rest } = r;
  return { ...rest, questionnaire_name: questionnaires?.name_en ?? r.questionnaire_code, version_number: questionnaire_versions?.number ?? null };
}

export async function listClientAttempts(clientId: string): Promise<AttemptListRow[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from('attempts').select(ATTEMPT_COLUMNS).eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) {
    if (error.code === '42P01') return [];
    throw new Error(`Could not read assessments: ${error.message}`);
  }
  return ((data ?? []) as unknown as RawAttempt[]).map(toRow);
}

export async function getAttemptDetail(id: string): Promise<AttemptDetail | null> {
  const { profile } = await requireStaff();
  const withReport = canViewReports(profile.role);
  const supabase = await createClient();
  const { data, error } = await supabase.from('attempts').select(`${ATTEMPT_COLUMNS}, clients(full_name)`).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not read assessment: ${error.message}`);
  if (!data) return null;
  const raw = data as unknown as RawAttempt & { clients?: { full_name?: string | null } | null };

  const none = { data: null, error: null };
  const [answers, alerts, result, version] = await Promise.all([
    withReport ? supabase.from('attempt_answers').select('question_id, option_ids').eq('attempt_id', id) : none,
    supabase.from('attempt_alerts').select('id, kind, created_at, handled_at').eq('attempt_id', id).order('created_at'),
    withReport ? supabase.from('attempt_results').select('result, report').eq('attempt_id', id).maybeSingle() : none,
    withReport ? supabase.from('questionnaire_versions').select('definition').eq('id', raw.version_id).maybeSingle() : none,
  ]);
  for (const r of [answers, alerts, result, version]) {
    if (r.error) throw new Error(`Could not read assessment data: ${r.error.message}`);
  }

  let definition: Definition | null = null;
  const stored = (version.data as { definition?: unknown } | null)?.definition;
  if (stored !== undefined) {
    const parsed = parseDefinition(stored);
    if (parsed.ok) definition = withSafety(parsed.definition);
  }

  const { clients, ...attempt } = raw;
  return {
    attempt: toRow(attempt),
    clientName: clients?.full_name ?? null,
    alerts: (alerts.data ?? []) as AttemptAlert[],
    answers: withReport ? Object.fromEntries(((answers.data ?? []) as { question_id: string; option_ids: string[] }[]).map((a) => [a.question_id, a.option_ids])) : null,
    result: ((result.data as { result?: Result } | null)?.result as Result | undefined) ?? null,
    report: ((result.data as { report?: Report } | null)?.report as Report | undefined) ?? null,
    definition,
  };
}

/** Dashboard counts. Zero when the attempts table is not there yet. */
export async function attemptCounts(): Promise<{ completed: number; inProgress: number }> {
  await requireStaff();
  const supabase = await createClient();
  const count = async (statuses: string[]) => {
    const { count: n, error } = await supabase.from('attempts').select('id', { count: 'exact', head: true }).in('status', statuses);
    return error ? 0 : (n ?? 0);
  };
  const [completed, inProgress] = await Promise.all([count(['completed']), count(['paid', 'in_progress'])]);
  return { completed, inProgress };
}
