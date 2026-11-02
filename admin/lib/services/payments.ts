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

/**
 * Where a purchase stands, in the words the calling team uses. One stage per row:
 * paid but nobody logged in with the number yet → logged in but not started → in progress → completed;
 * or the payment was never made; or the purchase is (to be) refunded.
 */
export type PaymentStage = 'not_logged_in' | 'not_started' | 'in_progress' | 'completed' | 'not_paid' | 'refund_needed' | 'refunded';
export const PAYMENT_STAGES: PaymentStage[] = ['not_logged_in', 'not_started', 'in_progress', 'completed', 'not_paid', 'refund_needed', 'refunded'];

/** The filters: every stage, plus "Paid" (all money received: paid and not refunded, any stage). */
export type PaymentList = 'paid' | PaymentStage;
export const PAYMENT_LISTS: PaymentList[] = ['paid', ...PAYMENT_STAGES];

export const STAGE_LABELS: Record<PaymentList | 'all', string> = {
  all: 'All',
  paid: 'Paid',
  not_logged_in: 'Paid, not logged in',
  not_started: 'Logged in, not started',
  in_progress: 'In progress',
  completed: 'Completed',
  not_paid: 'Payment not made',
  refund_needed: 'Refund needed',
  refunded: 'Refunded',
};

export function paymentStage(p: {
  status: PaymentStatus;
  refund_status: RefundStatus | null;
  claimed_at: string | null;
  attempt: { status: string } | null;
}): PaymentStage {
  if (p.status !== 'paid') return 'not_paid';
  if (p.refund_status === 'needed') return 'refund_needed';
  if (p.refund_status === 'refunded') return 'refunded';
  if (p.attempt) return p.attempt.status === 'completed' ? 'completed' : 'in_progress';
  return p.claimed_at ? 'not_started' : 'not_logged_in';
}

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
  /** Payment not made, but the same number paid for the same test later (no need to call). */
  paid_later: boolean;
  /**
   * The client registered with this number when the row itself is not linked to one (e.g. an unpaid
   * try: only paid purchases are linked to the account).
   */
  registered: PaymentClient | null;
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
  status: PaymentList | 'all';
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

type RawRow = Omit<PaymentListRow, 'test_name' | 'client' | 'attempt' | 'age_stop' | 'paid_later' | 'registered'> & {
  questionnaires: { name_en: string } | null;
  clients: PaymentClient | null;
  attempts: (Omit<PaymentAttempt, 'version_number'> & { questionnaire_versions: { number: number } | null }) | null;
};

function toRow(r: RawRow, ageStops: Map<string, AgeStop>, paidLater: Set<string>, registered: Map<string, PaymentClient>): PaymentListRow {
  const { questionnaires, clients, attempts, ...rest } = r;
  return {
    ...rest,
    paid_later: paidLater.has(r.id),
    registered: clients ? null : (registered.get(r.phone.slice(-10)) ?? null),
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

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The payments query for a stage, period and search, newest first (no paging). */
async function filteredQuery(supabase: Supabase, filters: Omit<PaymentFilters, 'page'>, count: boolean) {
  // In progress / completed filter on the linked assessment, so that join must be an inner one.
  const byAttempt = filters.status === 'in_progress' || filters.status === 'completed';
  const columns = byAttempt ? COLUMNS.replace('attempts(', 'attempts!inner(') : COLUMNS;
  let query = supabase.from('payments').select(columns, count ? { count: 'exact' } : undefined);

  switch (filters.status) {
    case 'paid':
      // Same as the Received card: refunded money is not counted.
      query = query.eq('status', 'paid').or('refund_status.is.null,refund_status.eq.needed');
      break;
    case 'not_logged_in':
      query = query.eq('status', 'paid').is('refund_status', null).is('attempt_id', null).is('claimed_at', null);
      break;
    case 'not_started':
      query = query.eq('status', 'paid').is('refund_status', null).is('attempt_id', null).not('claimed_at', 'is', null);
      break;
    case 'in_progress':
      // An assessment with status "paid" exists once Start is pressed (consent still to give).
      query = query.eq('status', 'paid').is('refund_status', null).in('attempts.status', ['paid', 'in_progress']);
      break;
    case 'completed':
      query = query.eq('status', 'paid').is('refund_status', null).eq('attempts.status', 'completed');
      break;
    case 'not_paid':
      query = query.in('status', ['created', 'failed']);
      break;
    case 'refund_needed':
    case 'refunded':
      query = query.eq('status', 'paid').eq('refund_status', filters.status === 'refund_needed' ? 'needed' : 'refunded');
      break;
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
  // Wrapped: a query builder is thenable, so returning it bare from an async function would run it.
  return { query: query.order('created_at', { ascending: false }) };
}

/**
 * Adds the under-18 records, the registered client of unlinked numbers and the paid-later flag.
 * `strict`: a failed lookup throws instead of leaving the extra details out (the Sheets sync).
 */
async function enrich(supabase: Supabase, raw: RawRow[], strict = false): Promise<PaymentListRow[]> {
  const unlinked = [...new Set(raw.filter((r) => !r.clients).map((r) => r.phone))];
  const unpaid = raw.filter((r) => r.status !== 'paid');
  const unpaidPhones = [...new Set(unpaid.map((r) => r.phone))];
  // Client phones are stored as +91…; older rows may hold 91… or the 10 digits.
  const phoneForms = unlinked.flatMap((p) => [p, p.replace(/^\+/, ''), p.slice(-10)]);
  const [stopsRes, paidRes, clientsRes] = await Promise.all([
    unlinked.length ? supabase.from('age_stops').select(AGE_STOP_COLUMNS).in('phone', unlinked) : null,
    unpaidPhones.length ? supabase.from('payments').select('phone, test_code, created_at').eq('status', 'paid').in('phone', unpaidPhones) : null,
    unlinked.length
      ? supabase.from('clients').select('id, full_name, phone, email, gender, age, city, state').in('phone', phoneForms).not('auth_user_id', 'is', null)
      : null,
  ]);
  const lookupError = stopsRes?.error ?? paidRes?.error ?? clientsRes?.error;
  if (strict && lookupError) throw new Error(`Could not read payment details: ${lookupError.message}`);
  const ageStops = new Map<string, AgeStop>();
  for (const s of (stopsRes?.data ?? []) as AgeStop[]) ageStops.set(s.phone, s);
  const registered = new Map<string, PaymentClient>();
  for (const c of (clientsRes?.data ?? []) as PaymentClient[]) registered.set(c.phone.slice(-10), c);
  const paid = (paidRes?.data ?? []) as { phone: string; test_code: string; created_at: string }[];
  const paidLater = new Set(
    unpaid
      .filter((r) => paid.some((p) => p.phone === r.phone && p.test_code === r.test_code && p.created_at > r.created_at))
      .map((r) => r.id)
  );
  return raw.map((r) => toRow(r, ageStops, paidLater, registered));
}

export async function listPayments(filters: PaymentFilters): Promise<{ rows: PaymentListRow[]; total: number }> {
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return { rows: [], total: 0 };
  const supabase = await createClient();

  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await (await filteredQuery(supabase, filters, true)).query.range(from, from + PAGE_SIZE - 1);
  if (error) {
    if (error.code === '42P01') return { rows: [], total: 0 }; // migration not applied yet
    throw new Error(`Could not read payments: ${error.message}`);
  }
  return { rows: await enrich(supabase, (data ?? []) as unknown as RawRow[]), total: count ?? 0 };
}

export const EXPORT_LIMIT = 10_000;

/** Every payment matching the filters, for the Excel export: newest first, read 1,000 at a time. */
export async function exportPayments(filters: Omit<PaymentFilters, 'page'>): Promise<PaymentListRow[]> {
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return [];
  const supabase = await createClient();

  const raw: RawRow[] = [];
  for (let from = 0; from < EXPORT_LIMIT; from += 1000) {
    const { data, error } = await (await filteredQuery(supabase, filters, false)).query.range(from, from + 999);
    if (error) throw new Error(`Could not read payments: ${error.message}`);
    raw.push(...((data ?? []) as unknown as RawRow[]));
    if (!data || data.length < 1000) break;
  }
  // In chunks, so the phone lists stay short in the request URL.
  const rows: PaymentListRow[] = [];
  for (let i = 0; i < raw.length; i += 200) rows.push(...(await enrich(supabase, raw.slice(i, i + 200))));
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Google Sheets sync (/api/integrations/google-sheets/payments). No staff session: the route checks
// its own token first and passes the service-role client. Read only.

/** More rows than this and the sync is refused rather than cut short. */
export const SYNC_LIMIT = 20_000;

export class TooManyRowsError extends Error {}

/** Every row a paged query returns, 1,000 at a time (the API's default row cap). */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
    if (out.length > SYNC_LIMIT) throw new TooManyRowsError();
  }
}

function chunks<T>(list: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Payments for the Sheets sync, newest first. Without a range: all of them. With a range (from
 * inclusive, to exclusive; either end optional): every payment whose shown values may have changed in
 * it, i.e. the payment row changed (payments.updated_at: created, paid, failed, logged in, refund,
 * moved), its assessment changed (attempts.updated_at: started, consent, answers, completed), the
 * client for its number changed (clients.updated_at: registered, name edited), or an under-18 stop
 * was recorded for its number (age_stops.last_at).
 */
export async function readPaymentsForSync(db: Supabase, range: { from?: string; to?: string }): Promise<PaymentListRow[]> {
  const inRange = <Q extends { gte: (c: string, v: string) => Q; lt: (c: string, v: string) => Q }>(q: Q, column: string): Q => {
    let out = q;
    if (range.from) out = out.gte(column, range.from);
    if (range.to) out = out.lt(column, range.to);
    return out;
  };

  let raw: RawRow[];
  if (!range.from && !range.to) {
    raw = await readAll<RawRow>((a, b) => db.from('payments').select(COLUMNS).order('created_at').order('id').range(a, b));
  } else {
    const [changed, attempts, clients, stops] = await Promise.all([
      readAll<{ id: string }>((a, b) => inRange(db.from('payments').select('id'), 'updated_at').order('id').range(a, b)),
      readAll<{ id: string }>((a, b) => inRange(db.from('attempts').select('id'), 'updated_at').order('id').range(a, b)),
      readAll<{ id: string; phone: string }>((a, b) => inRange(db.from('clients').select('id, phone'), 'updated_at').order('id').range(a, b)),
      readAll<{ phone: string }>((a, b) => inRange(db.from('age_stops').select('phone'), 'last_at').order('phone').range(a, b)),
    ]);
    const ids = new Set(changed.map((r) => r.id));
    const byKey = async (column: string, values: string[]) => {
      for (const part of chunks([...new Set(values)])) {
        const rows = await readAll<{ id: string }>((a, b) => db.from('payments').select('id').in(column, part).order('id').range(a, b));
        for (const r of rows) ids.add(r.id);
        if (ids.size > SYNC_LIMIT) throw new TooManyRowsError();
      }
    };
    await byKey('attempt_id', attempts.map((r) => r.id));
    await byKey('client_id', clients.map((r) => r.id));
    // Unlinked rows show the client registered with the number, or the under-18 record.
    const phones = [...clients.map((r) => r.phone), ...stops.map((r) => r.phone)];
    // Payment numbers are +91…; client numbers may be stored as +91…, 91… or the 10 digits.
    await byKey('phone', phones.flatMap((p) => [p, `+91${p.slice(-10)}`]));
    if (ids.size > SYNC_LIMIT) throw new TooManyRowsError();

    raw = [];
    for (const part of chunks([...ids])) {
      const { data, error } = await db.from('payments').select(COLUMNS).in('id', part);
      if (error) throw new Error(error.message);
      raw.push(...((data ?? []) as unknown as RawRow[]));
    }
  }
  if (raw.length > SYNC_LIMIT) throw new TooManyRowsError();

  const rows: PaymentListRow[] = [];
  for (const part of chunks(raw)) rows.push(...(await enrich(db, part, true)));
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
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
  /** Payments per stage (all time). */
  stages: Record<PaymentStage, number>;
}

/** Totals for the summary cards and the stage counts (all payments, independent of the table filters). */
export async function paymentSummary(): Promise<PaymentSummary> {
  const stages = Object.fromEntries(PAYMENT_STAGES.map((s) => [s, 0])) as Record<PaymentStage, number>;
  const empty: PaymentSummary = { receivedPaise: 0, receivedThisMonthPaise: 0, paidCount: 0, stages };
  const { profile } = await requireStaff();
  if (!canViewPayments(profile.role)) return empty;
  const supabase = await createClient();
  const { data, error } = await supabase.from('payments').select('status, refund_status, claimed_at, amount_paise, paid_at, attempts(status)');
  if (error) return empty;
  const monthStart = periodStart('month')!;
  type Row = {
    status: PaymentStatus;
    refund_status: RefundStatus | null;
    claimed_at: string | null;
    amount_paise: number;
    paid_at: string | null;
    attempts: { status: string } | null;
  };
  return (data as unknown as Row[]).reduce((s, p) => {
    s.stages[paymentStage({ ...p, attempt: p.attempts })] += 1;
    // Refunded money is not counted as received.
    if (p.status !== 'paid' || p.refund_status === 'refunded') return s;
    s.paidCount += 1;
    s.receivedPaise += p.amount_paise;
    if (p.paid_at && p.paid_at >= monthStart) s.receivedThisMonthPaise += p.amount_paise;
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
