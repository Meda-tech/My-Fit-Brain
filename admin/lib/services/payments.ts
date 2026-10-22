import { createClient } from '../supabase/server';
import { requireStaff } from '../auth';

// Payments for the admin Payments page. Super admins and coordinators only: the page checks the role
// and RLS (can_view_payments()) enforces it in the database. Reads use the staff session.

export const PAYMENT_ROLES = ['super_admin', 'coordinator'] as const;

export function canViewPayments(role: string): boolean {
  return (PAYMENT_ROLES as readonly string[]).includes(role);
}

export type PaymentStatus = 'created' | 'paid' | 'failed';
export const PAYMENT_STATUSES: PaymentStatus[] = ['paid', 'created', 'failed'];

export interface PaymentClient {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  gender: string;
  age: number;
  city: string | null;
  state: string | null;
}

export interface PaymentAttempt {
  id: string;
  report_id: string | null;
  status: 'paid' | 'in_progress' | 'completed';
  version_number: number | null;
  consent_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface PaymentListRow {
  id: string;
  status: PaymentStatus;
  amount_paise: number;
  currency: string;
  method: string | null;
  provider_order_id: string;
  provider_payment_id: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  test_code: string;
  test_name: string;
  client: PaymentClient | null;
  attempt: PaymentAttempt | null;
}

export type PaymentPeriod = 'all' | 'today' | '7d' | '30d' | 'month';
export const PAYMENT_PERIODS: { id: PaymentPeriod; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
];

export interface PaymentFilters {
  status: PaymentStatus | 'all';
  period: PaymentPeriod;
  q: string;
  page: number;
}

export const PAGE_SIZE = 50;

const COLUMNS = `
  id, status, amount_paise, currency, method, provider_order_id, provider_payment_id, failure_code,
  failure_reason, paid_at, created_at, updated_at, test_code,
  questionnaires(name_en),
  clients(id, full_name, phone, email, gender, age, city, state),
  attempts(id, report_id, status, consent_at, started_at, completed_at, questionnaire_versions(number))
`;

type RawRow = Omit<PaymentListRow, 'test_name' | 'client' | 'attempt'> & {
  questionnaires: { name_en: string } | null;
  clients: PaymentClient | null;
  attempts: (Omit<PaymentAttempt, 'version_number'> & { questionnaire_versions: { number: number } | null }) | null;
};

function toRow(r: RawRow): PaymentListRow {
  const { questionnaires, clients, attempts, ...rest } = r;
  return {
    ...rest,
    test_name: questionnaires?.name_en ?? r.test_code,
    client: clients,
    attempt: attempts
      ? {
          id: attempts.id,
          report_id: attempts.report_id,
          status: attempts.status,
          version_number: attempts.questionnaire_versions?.number ?? null,
          consent_at: attempts.consent_at,
          started_at: attempts.started_at,
          completed_at: attempts.completed_at,
        }
      : null,
  };
}

/** Start of the period in India time, as an ISO timestamp (null = all time). */
function periodStart(period: PaymentPeriod, now = new Date()): string | null {
  if (period === 'all') return null;
  const ist = new Date(now.getTime() + 330 * 60_000); // UTC+5:30, read with getUTC*
  const midnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 330 * 60_000;
  if (period === 'today') return new Date(midnight(ist)).toISOString();
  if (period === 'month') return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000).toISOString();
  const days = period === '7d' ? 7 : 30;
  return new Date(midnight(ist) - (days - 1) * 86_400_000).toISOString();
}

// Characters that would change a PostgREST filter expression are removed from search text.
function clean(q: string): string {
  return q.replace(/[^\p{L}\p{N}@+._\- ]/gu, '').trim().slice(0, 80);
}

export async function listPayments(filters: PaymentFilters): Promise<{ rows: PaymentListRow[]; total: number }> {
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return { rows: [], total: 0 };
  const supabase = await createClient();

  let query = supabase.from('payments').select(COLUMNS, { count: 'exact' }).order('created_at', { ascending: false });
  if (filters.status !== 'all') query = query.eq('status', filters.status);
  const since = periodStart(filters.period);
  if (since) query = query.gte('created_at', since);

  const q = clean(filters.q);
  if (q) {
    // Match the client (name, phone, email), the report ID, or the Razorpay order / payment ID.
    const digits = q.replace(/\D/g, '');
    const [clientsRes, attemptsRes] = await Promise.all([
      supabase
        .from('clients')
        .select('id')
        .or([`full_name.ilike.%${q}%`, `email.ilike.%${q}%`, ...(digits.length >= 4 ? [`phone.ilike.%${digits}%`] : [])].join(','))
        .limit(200),
      supabase.from('attempts').select('id').ilike('report_id', `%${q}%`).limit(200),
    ]);
    const clientIds = (clientsRes.data ?? []).map((c: { id: string }) => c.id);
    const attemptIds = (attemptsRes.data ?? []).map((a: { id: string }) => a.id);
    const parts = [`provider_order_id.ilike.%${q}%`, `provider_payment_id.ilike.%${q}%`];
    if (clientIds.length) parts.push(`client_id.in.(${clientIds.join(',')})`);
    if (attemptIds.length) parts.push(`attempt_id.in.(${attemptIds.join(',')})`);
    query = query.or(parts.join(','));
  }

  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) {
    if (error.code === '42P01') return { rows: [], total: 0 }; // migration not applied yet
    throw new Error(`Could not read payments: ${error.message}`);
  }
  return { rows: ((data ?? []) as unknown as RawRow[]).map(toRow), total: count ?? 0 };
}

export interface PaymentSummary {
  receivedPaise: number;
  receivedThisMonthPaise: number;
  paidCount: number;
  failedCount: number;
  openCount: number;
}

/** Totals for the summary cards (all payments, independent of the table filters). */
export async function paymentSummary(): Promise<PaymentSummary> {
  const empty = { receivedPaise: 0, receivedThisMonthPaise: 0, paidCount: 0, failedCount: 0, openCount: 0 };
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return empty;
  const supabase = await createClient();
  const { data, error } = await supabase.from('payments').select('status, amount_paise, paid_at');
  if (error) return empty;
  const monthStart = periodStart('month')!;
  return (data as { status: PaymentStatus; amount_paise: number; paid_at: string | null }[]).reduce((s, p) => {
    if (p.status === 'paid') {
      s.paidCount += 1;
      s.receivedPaise += p.amount_paise;
      if (p.paid_at && p.paid_at >= monthStart) s.receivedThisMonthPaise += p.amount_paise;
    } else if (p.status === 'failed') s.failedCount += 1;
    else s.openCount += 1;
    return s;
  }, empty);
}
