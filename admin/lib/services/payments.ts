import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import { normalizePhoneNumber } from '../phone';

// Payments for the admin Payments page. Super admins and coordinators only: the page checks the role
// and RLS (can_view_payments()) enforces it in the database. Reads use the staff session; the two staff
// actions (move to another number, mark refunded) write with the service role after the role check.
//
// A payment is a purchase owned by a phone number (pay first, log in later). It is linked to a client
// when someone logs in with that number; the assessment is created when the client presses Start.

export const PAYMENT_ROLES = ['super_admin', 'coordinator'] as const;

export function canViewPayments(role: string): boolean {
  return (PAYMENT_ROLES as readonly string[]).includes(role);
}

export type PaymentStatus = 'created' | 'paid' | 'failed';
export type RefundStatus = 'needed' | 'refunded';

/** The list filters: a payment status, or a purchase state. */
export type PaymentView = 'paid' | 'not_started' | 'refund_needed' | 'refunded' | 'created' | 'failed';
export const PAYMENT_VIEWS: PaymentView[] = ['paid', 'not_started', 'refund_needed', 'refunded', 'created', 'failed'];

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
  refund_status: RefundStatus | null;
  /** The phone the purchase belongs to (E.164). */
  phone: string;
  claimed_at: string | null;
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
  /** Stopped at registration as under 18 with this number (minimal record), or null. */
  age_stop: AgeStop | null;
}

/** Minimal under-18 record: number, name typed, age entered, when. */
export interface AgeStop {
  phone: string;
  full_name: string | null;
  age: number;
  first_at: string;
  last_at: string;
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
  status: PaymentView | 'all';
  period: PaymentPeriod;
  q: string;
  page: number;
}

export const PAGE_SIZE = 50;

const COLUMNS = `
  id, status, refund_status, phone, claimed_at, amount_paise, currency, method, provider_order_id, provider_payment_id, failure_code,
  failure_reason, paid_at, created_at, updated_at, test_code,
  questionnaires(name_en),
  clients(id, full_name, phone, email, gender, age, city, state),
  attempts(id, report_id, status, consent_at, started_at, completed_at, questionnaire_versions(number))
`;

type RawRow = Omit<PaymentListRow, 'test_name' | 'client' | 'attempt' | 'age_stop'> & {
  questionnaires: { name_en: string } | null;
  clients: PaymentClient | null;
  attempts: (Omit<PaymentAttempt, 'version_number'> & { questionnaire_versions: { number: number } | null }) | null;
};

function toRow(r: RawRow, ageStops: Map<string, AgeStop>): PaymentListRow {
  const { questionnaires, clients, attempts, ...rest } = r;
  return {
    ...rest,
    age_stop: clients ? null : (ageStops.get(r.phone) ?? null),
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
  if (filters.status === 'not_started') {
    query = query.eq('status', 'paid').is('attempt_id', null).is('refund_status', null);
  } else if (filters.status === 'refund_needed' || filters.status === 'refunded') {
    query = query.eq('refund_status', filters.status === 'refund_needed' ? 'needed' : 'refunded');
  } else if (filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
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
    if (digits.length >= 4) parts.push(`phone.ilike.%${digits}%`);
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
  const raw = (data ?? []) as unknown as RawRow[];
  const unlinked = [...new Set(raw.filter((r) => !r.clients).map((r) => r.phone))];
  const ageStops = new Map<string, AgeStop>();
  if (unlinked.length) {
    const { data: stops } = await supabase.from('age_stops').select(AGE_STOP_COLUMNS).in('phone', unlinked);
    for (const s of (stops ?? []) as AgeStop[]) ageStops.set(s.phone, s);
  }
  return { rows: raw.map((r) => toRow(r, ageStops)), total: count ?? 0 };
}

const AGE_STOP_COLUMNS = 'phone, full_name, age, first_at, last_at';

export interface AgeStopRow extends AgeStop {
  paidCount: number;
  refundNeededCount: number;
  refundedCount: number;
}

/** Everyone stopped at registration as under 18, newest first, with their purchases' refund state. */
export async function listAgeStops(): Promise<AgeStopRow[]> {
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from('age_stops').select(AGE_STOP_COLUMNS).order('last_at', { ascending: false }).limit(500);
  if (error) {
    if (error.code === '42P01') return []; // migration not applied yet
    throw new Error(`Could not read under-18 records: ${error.message}`);
  }
  const stops = (data ?? []) as AgeStop[];
  if (!stops.length) return [];
  const { data: pays } = await supabase
    .from('payments')
    .select('phone, status, refund_status')
    .in('phone', stops.map((s) => s.phone))
    .eq('status', 'paid');
  const rows = (pays ?? []) as { phone: string; refund_status: RefundStatus | null }[];
  return stops.map((s) => {
    const mine = rows.filter((p) => p.phone === s.phone);
    return {
      ...s,
      paidCount: mine.length,
      refundNeededCount: mine.filter((p) => p.refund_status === 'needed').length,
      refundedCount: mine.filter((p) => p.refund_status === 'refunded').length,
    };
  });
}

export interface PaymentSummary {
  receivedPaise: number;
  receivedThisMonthPaise: number;
  paidCount: number;
  failedCount: number;
  openCount: number;
  notStartedCount: number;
  refundNeededCount: number;
}

/** Totals for the summary cards (all payments, independent of the table filters). */
export async function paymentSummary(): Promise<PaymentSummary> {
  const empty = { receivedPaise: 0, receivedThisMonthPaise: 0, paidCount: 0, failedCount: 0, openCount: 0, notStartedCount: 0, refundNeededCount: 0 };
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return empty;
  const supabase = await createClient();
  const { data, error } = await supabase.from('payments').select('status, refund_status, attempt_id, amount_paise, paid_at');
  if (error) return empty;
  const monthStart = periodStart('month')!;
  type Row = { status: PaymentStatus; refund_status: RefundStatus | null; attempt_id: string | null; amount_paise: number; paid_at: string | null };
  return (data as Row[]).reduce((s, p) => {
    if (p.status === 'paid' && p.refund_status === 'needed') s.refundNeededCount += 1;
    else if (p.status === 'paid' && !p.refund_status && !p.attempt_id) s.notStartedCount += 1;
    // Refunded money is not counted as received.
    if (p.status === 'paid' && p.refund_status === 'refunded') return s;
    if (p.status === 'paid') {
      s.paidCount += 1;
      s.receivedPaise += p.amount_paise;
      if (p.paid_at && p.paid_at >= monthStart) s.receivedThisMonthPaise += p.amount_paise;
    } else if (p.status === 'failed') s.failedCount += 1;
    else s.openCount += 1;
    return s;
  }, empty);
}

// ---------------------------------------------------------------------------------------------
// Staff actions (super admins and coordinators)

async function paymentStaffId(): Promise<string | null> {
  const { profile } = await requireStaff();
  return canViewPayments(profile.role) ? profile.id : null;
}

interface OwnerRow {
  phone: string;
  client_id: string | null;
  status: PaymentStatus;
  refund_status: RefundStatus | null;
  attempt_id: string | null;
}

/**
 * Moves a paid purchase that is not started to another phone number (e.g. the buyer typed a wrong
 * number). The link to a client is removed; whoever logs in with the new number gets it on Home. A
 * refund flag is cleared (the purchase is in use again). Every move is logged in payment_moves.
 */
export async function movePurchase(paymentId: string, rawPhone: string): Promise<string | null> {
  const staffId = await paymentStaffId();
  if (!staffId) return 'Only super admins and coordinators can move purchases.';
  const phone = normalizePhoneNumber(rawPhone);
  if (!phone.valid) return phone.error ?? 'Enter a valid mobile number.';

  const db = createAdminClient();
  const { data, error } = await db.from('payments').select('phone, client_id, status, refund_status, attempt_id').eq('id', paymentId).maybeSingle();
  if (error || !data) return 'Purchase not found.';
  const row = data as OwnerRow;
  if (row.status !== 'paid') return 'Only paid purchases can be moved.';
  if (row.attempt_id) return 'This assessment has started; it cannot be moved.';
  if (row.refund_status === 'refunded') return 'This purchase was refunded.';
  if (row.phone === phone.normalized) return 'The purchase already belongs to this number.';

  const { data: moved, error: moveError } = await db
    .from('payments')
    .update({ phone: phone.normalized, client_id: null, claimed_at: null, refund_status: null })
    .eq('id', paymentId)
    .is('attempt_id', null)
    .select('id')
    .maybeSingle();
  if (moveError || !moved) return 'The purchase could not be moved. Please try again.';
  const { error: logError } = await db.from('payment_moves').insert({
    payment_id: paymentId,
    from_phone: row.phone,
    to_phone: phone.normalized,
    from_client_id: row.client_id,
    moved_by: staffId,
  });
  if (logError) console.error('Could not log the purchase move:', logError.message);
  return null;
}

/** After the money was returned in the Razorpay dashboard: the purchase is marked refunded (final). */
export async function markRefunded(paymentId: string): Promise<string | null> {
  const staffId = await paymentStaffId();
  if (!staffId) return 'Only super admins and coordinators can mark refunds.';
  const { data, error } = await createAdminClient()
    .from('payments')
    .update({ refund_status: 'refunded' })
    .eq('id', paymentId)
    .eq('status', 'paid')
    .is('attempt_id', null)
    .select('id')
    .maybeSingle();
  if (error || !data) return 'Only a paid purchase that is not started can be marked refunded.';
  return null;
}
