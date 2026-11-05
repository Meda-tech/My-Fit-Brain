import { parseDefinition, withSafety, type Answers, type Definition, type Report, type Result, type Text } from '@mfb/questionnaire';
import { createClient } from '../supabase/server';
import { requireStaff } from '../auth';
import type { Conclusion } from '../conclusion';

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
  /** Typed client-details answers with the question as it was asked. Report roles only; null for coordinators. */
  details: DetailAnswer[] | null;
  /** The counsellor's conclusion. Report roles only; null when none is written yet (and for coordinators). */
  conclusion: Conclusion | null;
}

export interface DetailAnswer {
  detail_id: string;
  question: Text;
  answer: string;
  answered_at: string;
}

const ATTEMPT_COLUMNS =
  'id, report_id, client_id, questionnaire_code, version_id, status, language, payment_ref, paid_at, started_at, completed_at, created_at, questionnaires(name_en), questionnaire_versions(number)';

export const CONCLUSION_COLUMNS = 'body, created_at, updated_at, updated_by_name';

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
  const [answers, alerts, result, version, details, conclusion] = await Promise.all([
    withReport ? supabase.from('attempt_answers').select('question_id, option_ids').eq('attempt_id', id) : none,
    supabase.from('attempt_alerts').select('id, kind, created_at, handled_at').eq('attempt_id', id).order('created_at'),
    withReport ? supabase.from('attempt_results').select('result, report').eq('attempt_id', id).maybeSingle() : none,
    withReport ? supabase.from('questionnaire_versions').select('definition').eq('id', raw.version_id).maybeSingle() : none,
    withReport
      ? supabase.from('attempt_details').select('detail_id, question, answer, answered_at').eq('attempt_id', id).order('sort').order('answered_at')
      : none,
    withReport ? supabase.from('attempt_conclusions').select(CONCLUSION_COLUMNS).eq('attempt_id', id).maybeSingle() : none,
  ]);
  for (const r of [answers, alerts, result, version, details, conclusion]) {
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
    details: withReport ? ((details.data ?? []) as DetailAnswer[]) : null,
    conclusion: (conclusion.data as Conclusion | null) ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Assessments page (/assessments): every attempt with its client, newest first. Every active staff
// member sees the list (RLS); the conclusion column and "Needs conclusion" are for report roles only.

export const ATTEMPT_LISTS = ['all', 'paid', 'in_progress', 'completed', 'needs_conclusion'] as const;
export type AttemptList = (typeof ATTEMPT_LISTS)[number];

export const ATTEMPT_LIST_LABELS: Record<AttemptList, string> = {
  all: 'All',
  paid: 'Paid, not started',
  in_progress: 'In progress',
  completed: 'Completed',
  needs_conclusion: 'Needs conclusion',
};

export const ATTEMPTS_PAGE_SIZE = 50;

export interface AttemptFilters {
  list: AttemptList;
  /** Questionnaire code, or 'all'. */
  test: string;
  q: string;
  page: number;
}

export interface AttemptOverviewRow extends AttemptListRow {
  client_name: string | null;
  client_phone: string | null;
  alerts: AttemptAlert['kind'][];
  /** Report roles only: when the conclusion was last saved; null when none is written (or not visible). */
  conclusion_updated_at: string | null;
}

type RawOverview = RawAttempt & {
  clients?: { full_name?: string | null; phone?: string | null } | null;
  attempt_alerts?: { kind: AttemptAlert['kind'] }[] | null;
  attempt_conclusions?: { updated_at: string } | { updated_at: string }[] | null;
};

/** Same characters as the Payments search: letters, digits and @ + . _ - and spaces. */
function searchTerm(q: string): string {
  return q.replace(/[^\p{L}\p{N}@+._\- ]/gu, '').trim().slice(0, 80);
}

export async function listAttempts(filters: AttemptFilters): Promise<{ rows: AttemptOverviewRow[]; total: number }> {
  const { profile } = await requireStaff();
  const withReport = canViewReports(profile.role);
  const supabase = await createClient();

  const columns = `${ATTEMPT_COLUMNS}, clients(full_name, phone), attempt_alerts(kind)${withReport ? ', attempt_conclusions(updated_at)' : ''}`;
  let query = supabase.from('attempts').select(columns, { count: 'exact' });

  if (filters.list === 'needs_conclusion') {
    query = withReport ? query.eq('status', 'completed').is('attempt_conclusions', null) : query.eq('status', 'completed');
  } else if (filters.list !== 'all') {
    query = query.eq('status', filters.list);
  }
  if (filters.test !== 'all') query = query.eq('questionnaire_code', filters.test);

  const q = searchTerm(filters.q);
  if (q) {
    const digits = q.replace(/\D/g, '');
    const { data: clients } = await supabase
      .from('clients')
      .select('id')
      .or([`full_name.ilike.%${q}%`, `email.ilike.%${q}%`, ...(digits.length >= 4 ? [`phone.ilike.%${digits}%`] : [])].join(','))
      .limit(200);
    const clientIds = (clients ?? []).map((c: { id: string }) => c.id);
    query = query.or([`report_id.ilike.%${q}%`, ...(clientIds.length ? [`client_id.in.(${clientIds.join(',')})`] : [])].join(','));
  }

  const from = (filters.page - 1) * ATTEMPTS_PAGE_SIZE;
  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, from + ATTEMPTS_PAGE_SIZE - 1);
  if (error) {
    if (error.code === '42P01') return { rows: [], total: 0 };
    throw new Error(`Could not read assessments: ${error.message}`);
  }

  const rows = ((data ?? []) as unknown as RawOverview[]).map((r) => {
    const { clients, attempt_alerts, attempt_conclusions, ...attempt } = r;
    const conclusion = Array.isArray(attempt_conclusions) ? attempt_conclusions[0] : attempt_conclusions;
    return {
      ...toRow(attempt),
      client_name: clients?.full_name ?? null,
      client_phone: clients?.phone ?? null,
      alerts: [...new Set((attempt_alerts ?? []).map((a) => a.kind))],
      conclusion_updated_at: conclusion?.updated_at ?? null,
    };
  });
  return { rows, total: count ?? 0 };
}

/** Counts per list for the filter chips ("needs_conclusion" only for report roles). */
export async function attemptListCounts(): Promise<Partial<Record<AttemptList, number>>> {
  const { profile } = await requireStaff();
  const supabase = await createClient();
  const count = async (status: AttemptStatus, withoutConclusion = false) => {
    let query = supabase.from('attempts').select(withoutConclusion ? 'id, attempt_conclusions(attempt_id)' : 'id', { count: 'exact', head: true }).eq('status', status);
    if (withoutConclusion) query = query.is('attempt_conclusions', null);
    const { count: n, error } = await query;
    return error ? 0 : (n ?? 0);
  };
  const [paid, inProgress, completed, needsConclusion] = await Promise.all([
    count('paid'),
    count('in_progress'),
    count('completed'),
    canViewReports(profile.role) ? count('completed', true) : Promise.resolve(null),
  ]);
  return {
    all: paid + inProgress + completed,
    paid,
    in_progress: inProgress,
    completed,
    ...(needsConclusion !== null ? { needs_conclusion: needsConclusion } : {}),
  };
}

/** Questionnaires for the test filter. */
export async function listQuestionnaireNames(): Promise<{ code: string; name: string }[]> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.from('questionnaires').select('code, name_en').order('code');
  if (error) return [];
  return ((data ?? []) as { code: string; name_en: string | null }[]).map((r) => ({ code: r.code, name: r.name_en ?? r.code }));
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
