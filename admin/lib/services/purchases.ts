import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import {
  PURCHASE_STATUSES,
  currentStage,
  type JourneyStage,
  type PurchaseRowStatus,
  type PurchaseTab,
  type StageRow,
} from '../purchases';
import type { AssessmentProgress, CallChoice, CallEvent, CallKind, CallOutcome, CallReason } from '../calls';
import type { PaymentProvider, PaymentStatus, RefundStatus } from './payments';

// Purchases (step 1) and their calls (step 2). Reads use the staff session, so RLS decides: super admins see every
// row, a coordinator only the rows of their own clients, counsellors none. Nothing here writes: the database keeps
// the rows and calls up to date from payments and assessments.
// One table holds both: purchases (paid, refunded, cancelled) and payment attempts (not_paid: tried on the pay
// page, not paid). Shown: open attempts and attempts closed as Not interested (tab Unpaid); an attempt replaced by
// a later try or purchase of the same phone and assessment is never shown. When the phone pays, the same row
// becomes the purchase, so it moves from Unpaid to Paid by itself, with the same coordinator.

export const PURCHASE_ROLES = ['super_admin', 'coordinator'] as const;

export function canViewPurchases(role: string): boolean {
  return (PURCHASE_ROLES as readonly string[]).includes(role);
}

export const PURCHASE_PAGE_SIZE = 50;

export interface OpenCall {
  id: string;
  kind: CallKind;
  due_at: string;
}

export interface PurchaseRow {
  id: string;
  kind: string;
  test_code: string;
  test_name: string;
  phone: string;
  client_name: string | null;
  amount_paise: number;
  status: PurchaseRowStatus;
  /** An unpaid attempt closed from its Payment call as Not interested. */
  not_interested: boolean;
  source: 'pay_page' | 'manual';
  coordinator_name: string | null;
  paid_at: string | null;
  created_at: string;
  /** How many payments (tries) the row holds. */
  tries: number;
  /** The time of the latest try, and whether it failed. */
  last_tried_at: string;
  last_try_failed: boolean;
  /** The call that is open now (one at most at a time: payment while unpaid, assessment once paid). */
  open_call: OpenCall | null;
  /** How far the client got with the assessment (paid rows). */
  assessment_progress: AssessmentProgress;
  stages: StageRow[];
  current_stage: JourneyStage | null;
}

export interface PurchasePayment {
  id: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  refund_status: RefundStatus | null;
  method: string | null;
  amount_paise: number;
  currency: string;
  paid_at: string | null;
  created_at: string;
  reference: string | null;
  provider_order_id: string;
  provider_payment_id: string | null;
  proof_url: string | null;
  recorded_by_name: string | null;
  /** Manual payments only: "pending" until Accounts has checked it. */
  accounts_check: 'pending' | 'checked' | null;
}

export interface CallLogRow {
  id: string;
  at: string;
  entry: 'call' | 'event';
  choice: CallChoice | null;
  reason: CallReason | null;
  note: string | null;
  follow_up_at: string | null;
  event: CallEvent | null;
  by_name: string | null;
}

export interface CallRow {
  id: string;
  kind: CallKind;
  status: 'open' | 'closed';
  outcome: CallOutcome | null;
  created_at: string;
  due_at: string;
  closed_at: string | null;
  /** Why a rule closed the call, in words (e.g. paid more than 7 days before go-live). */
  closed_note: string | null;
  logs: CallLogRow[];
  /** Earlier "Mark as call done" entries (Not interested needs at least one). */
  prior_calls: number;
}

export interface PurchaseDetail extends PurchaseRow {
  payments: PurchasePayment[];
  calls: CallRow[];
}

type Db = Awaited<ReturnType<typeof createClient>>;

const COLUMNS =
  'id, kind, test_code, phone, client_id, amount_paise, status, closed_reason, source, coordinator_id, paid_at, created_at, ' +
  'purchase_stages(stage, position, planned_at, done_at, status), purchase_payments(payments(created_at, status, attempt_id)), ' +
  'calls(id, kind, status, due_at)';

/** Rows shown on the screen: purchases, open attempts and attempts closed as Not interested. */
const SHOWN = 'status.neq.not_paid,closed_at.is.null,closed_reason.eq.not_interested';
const UNPAID_SHOWN = 'closed_at.is.null,closed_reason.eq.not_interested';

type One<T> = T | T[] | null;
const one = <T>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

interface RawPurchase {
  id: string;
  kind: string;
  test_code: string;
  phone: string;
  client_id: string | null;
  amount_paise: number;
  status: PurchaseRowStatus;
  closed_reason: 'replaced' | 'not_interested' | null;
  source: 'pay_page' | 'manual';
  coordinator_id: string | null;
  paid_at: string | null;
  created_at: string;
  purchase_stages: StageRow[] | null;
  purchase_payments: { payments: One<{ created_at: string; status: string; attempt_id: string | null }> }[] | null;
  calls: { id: string; kind: CallKind; status: string; due_at: string }[] | null;
}

export interface NameLookup {
  client: (r: { client_id: string | null; phone: string }) => string | null;
  coordinator: (id: string | null) => string | null;
  test: (code: string) => string;
}

/** Names for rows: the client (linked, else registered with the number), the coordinator, the assessment. */
export async function nameLookup(
  db: Db,
  rows: { client_id: string | null; phone: string; coordinator_id: string | null }[]
): Promise<NameLookup> {
  const clientIds = [...new Set(rows.map((r) => r.client_id).filter((v): v is string => !!v))];
  const phones = [...new Set(rows.filter((r) => !r.client_id).map((r) => r.phone))];
  // Client phones are stored as +91…; older rows may hold 91… or the 10 digits.
  const phoneForms = phones.flatMap((p) => [p, p.replace(/^\+/, ''), p.slice(-10)]);
  const coordIds = [...new Set(rows.map((r) => r.coordinator_id).filter((v): v is string => !!v))];
  const [byId, byPhone, coords, tests] = await Promise.all([
    clientIds.length ? db.from('clients').select('id, full_name').in('id', clientIds) : null,
    phoneForms.length ? db.from('clients').select('full_name, phone').in('phone', phoneForms) : null,
    // Coordinators cannot read other profiles under RLS; the role was checked by the caller.
    coordIds.length ? createAdminClient().from('profiles').select('id, full_name').in('id', coordIds) : null,
    db.from('questionnaires').select('code, name_en'),
  ]);
  const idName = new Map(((byId?.data ?? []) as { id: string; full_name: string }[]).map((c) => [c.id, c.full_name]));
  const phoneName = new Map(((byPhone?.data ?? []) as { full_name: string; phone: string }[]).map((c) => [c.phone.slice(-10), c.full_name]));
  const coordName = new Map(((coords?.data ?? []) as { id: string; full_name: string }[]).map((c) => [c.id, c.full_name]));
  const testName = new Map(((tests.data ?? []) as { code: string; name_en: string }[]).map((t) => [t.code, t.name_en]));
  return {
    client: (r) => (r.client_id ? idName.get(r.client_id) ?? null : phoneName.get(r.phone.slice(-10)) ?? null),
    coordinator: (id) => (id ? coordName.get(id) ?? null : null),
    test: (code) => testName.get(code) ?? code,
  };
}

type RawTry = { created_at: string; status: string; attempt_id: string | null };

/** How far the client got with the assessment of each paid row (only ids of rows the staff member may see). */
async function assessmentProgress(raw: RawPurchase[]): Promise<Map<string, AssessmentProgress>> {
  const tries = (r: RawPurchase) => (r.purchase_payments ?? []).map((l) => one(l.payments)).filter((p): p is RawTry => !!p);
  const ids = [...new Set(raw.flatMap((r) => tries(r).map((p) => p.attempt_id).filter((v): v is string => !!v)))];
  const { data } = ids.length ? await createAdminClient().from('attempts').select('id, status').in('id', ids) : { data: [] };
  const status = new Map(((data ?? []) as { id: string; status: string }[]).map((a) => [a.id, a.status]));
  return new Map(
    raw.map((r) => {
      const s = tries(r).map((p) => (p.attempt_id ? status.get(p.attempt_id) : undefined));
      const progress: AssessmentProgress = s.includes('completed') ? 'completed' : s.includes('in_progress') ? 'in_progress' : 'not_started';
      return [r.id, progress];
    })
  );
}

async function withNames(db: Db, raw: RawPurchase[]): Promise<PurchaseRow[]> {
  const [names, progress] = await Promise.all([nameLookup(db, raw), assessmentProgress(raw)]);
  return raw.map(({ purchase_stages, purchase_payments, calls, client_id, coordinator_id, closed_reason, ...r }) => {
    const stages = [...(purchase_stages ?? [])].sort((a, b) => a.position - b.position);
    const tries = (purchase_payments ?? [])
      .map((l) => one(l.payments))
      .filter((p): p is RawTry => !!p)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = tries.at(-1);
    const open = (calls ?? []).filter((c) => c.status === 'open').sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
    return {
      ...r,
      test_name: names.test(r.test_code),
      client_name: names.client({ client_id, phone: r.phone }),
      coordinator_name: names.coordinator(coordinator_id),
      not_interested: closed_reason === 'not_interested',
      tries: tries.length,
      last_tried_at: last?.created_at ?? r.created_at,
      last_try_failed: last?.status === 'failed',
      open_call: open ? { id: open.id, kind: open.kind, due_at: open.due_at } : null,
      assessment_progress: progress.get(r.id) ?? 'not_started',
      stages,
      current_stage: currentStage(stages),
    };
  });
}

/** Runs the database's calls_sync(): makes the Payment calls that are due by the 30-minute rule. Never throws. */
export async function syncCalls(): Promise<void> {
  const { error } = await createAdminClient().rpc('calls_sync');
  if (error && error.code !== '42883') console.error('calls_sync failed:', error.message);
}

/** How many rows each tab has for this staff member. */
export async function purchaseTabCounts(): Promise<Record<PurchaseTab, number>> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return { unpaid: 0, paid: 0, all: 0 };
  const db = await createClient();
  const head = () => db.from('purchases').select('id', { count: 'exact', head: true });
  const [unpaid, paid] = await Promise.all([
    head().eq('status', 'not_paid').or(UNPAID_SHOWN),
    head().in('status', [...PURCHASE_STATUSES]),
  ]);
  if (unpaid.error?.code === '42P01' || paid.error?.code === '42P01') return { unpaid: 0, paid: 0, all: 0 };
  const u = unpaid.count ?? 0;
  const p = paid.count ?? 0;
  return { unpaid: u, paid: p, all: u + p };
}

/**
 * One page of a tab, newest first. Unpaid: payment attempts, by first try. Paid: purchases, by paid time.
 * All: both, by first try.
 */
export async function listPurchases(tab: PurchaseTab, page: number): Promise<{ rows: PurchaseRow[]; total: number }> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return { rows: [], total: 0 };
  const db = await createClient();
  const from = (page - 1) * PURCHASE_PAGE_SIZE;
  let q = db.from('purchases').select(COLUMNS, { count: 'exact' });
  if (tab === 'unpaid') {
    q = q.eq('status', 'not_paid').or(UNPAID_SHOWN).order('created_at', { ascending: false });
  } else if (tab === 'paid') {
    q = q
      .in('status', [...PURCHASE_STATUSES])
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
  } else {
    q = q.or(SHOWN).order('created_at', { ascending: false });
  }
  const { data, error, count } = await q.order('id').range(from, from + PURCHASE_PAGE_SIZE - 1);
  if (error) {
    if (error.code === '42P01') return { rows: [], total: 0 };
    throw new Error(`Could not read purchases: ${error.message}`);
  }
  return { rows: await withNames(db, (data ?? []) as unknown as RawPurchase[]), total: count ?? 0 };
}

/**
 * One row with its journey, payments (tries) and calls with their history, or null when it does not exist, is a
 * replaced attempt, or is not the staff member's.
 */
export async function getPurchase(id: string): Promise<PurchaseDetail | null> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return null;
  const db = await createClient();
  const { data } = await db.from('purchases').select(COLUMNS).eq('id', id).or(SHOWN).maybeSingle();
  if (!data) return null;
  const [row] = await withNames(db, [data as unknown as RawPurchase]);

  const [{ data: links }, { data: callData }] = await Promise.all([
    db
      .from('purchase_payments')
      .select(
        'accounts_check, payments(id, provider, status, refund_status, method, amount_paise, currency, paid_at, created_at, reference, provider_order_id, provider_payment_id, proof_url, recorded_by)'
      )
      .eq('purchase_id', id),
    db
      .from('calls')
      .select('id, kind, status, outcome, created_at, due_at, closed_at, closed_note, call_logs(id, at, entry, choice, reason, note, follow_up_at, event, by_name)')
      .eq('purchase_id', id),
  ]);
  type RawPayment = Omit<PurchasePayment, 'recorded_by_name' | 'accounts_check'> & { recorded_by: string | null };
  type RawLink = { accounts_check: PurchasePayment['accounts_check']; payments: One<RawPayment> };
  const raw = ((links ?? []) as unknown as RawLink[])
    .map((l) => ({ check: l.accounts_check, p: one(l.payments) }))
    .filter((l): l is { check: PurchasePayment['accounts_check']; p: RawPayment } => !!l.p);

  const staffIds = [...new Set(raw.map((l) => l.p.recorded_by).filter((v): v is string => !!v))];
  const { data: staff } = staffIds.length ? await createAdminClient().from('profiles').select('id, full_name').in('id', staffIds) : { data: [] };
  const staffName = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));

  const payments = raw
    .map(({ check, p: { recorded_by, ...p } }) => ({ ...p, recorded_by_name: recorded_by ? staffName.get(recorded_by) ?? null : null, accounts_check: check }))
    .sort((a, b) => (b.paid_at ?? b.created_at).localeCompare(a.paid_at ?? a.created_at));

  type RawCall = Omit<CallRow, 'logs' | 'prior_calls'> & { call_logs: CallLogRow[] | null };
  const calls = ((callData ?? []) as unknown as RawCall[])
    .map(({ call_logs, ...c }) => {
      const logs = [...(call_logs ?? [])].sort((a, b) => b.at.localeCompare(a.at));
      return { ...c, logs, prior_calls: logs.filter((l) => l.entry === 'call').length };
    })
    // Open first, then the newest.
    .sort((a, b) => (a.status === b.status ? b.created_at.localeCompare(a.created_at) : a.status === 'open' ? -1 : 1));
  return { ...row, payments, calls };
}
