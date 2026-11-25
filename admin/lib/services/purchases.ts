import { cache } from 'react';
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
import type { Presentation } from '../booking';
import type { PackagePayment, PackageState } from '../package';
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
  /** The booked report presentation (step 4), if any. */
  presentation: Presentation | null;
  /** Paid, assessment completed, nothing booked yet: Book presentation is possible. */
  can_book: boolean;
  /** Paid (or last tried) more than 7 days before go-live: no automatic calls (booked by hand); "Before the system". */
  before_system: boolean;
  /** An old paid purchase, assessment completed, no presentation yet: a super admin may mark the presentation done. */
  can_mark_presentation_admin: boolean;
  /** The Package call (step 5), open or closed, if there is one. */
  package_call: { status: 'open' | 'closed'; outcome: CallOutcome | null; due_at: string } | null;
  /**
   * The package of this assessment purchase: the payments this staff member sees (a coordinator: only those made up
   * to the handover to CRM), paid so far, the package amount, the start amount and whether it has started.
   */
  pkg: PackageState;
  /** Report presentation done, the package not started yet and not paid in full: Add package payment is possible. */
  can_add_package_payment: boolean;
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
  /** The assessment this payment started (paid payments only): when it was started and completed. */
  attempt: { started_at: string | null; completed_at: string | null } | null;
  /** Safety net: paid a second time while this purchase was open. Refund needed; it starts no journey. */
  extra_paid: boolean;
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
  /** Earlier "Mark as call done" entries (Not interested needs at least 2). */
  prior_calls: number;
}

export interface PurchaseDetail extends PurchaseRow {
  payments: PurchasePayment[];
  calls: CallRow[];
  /** Pay page tries refused because this purchase was open ("Tried again – blocked"; no order made). */
  blocked_tries: { at: string; signed_in: boolean }[];
}

type Db = Awaited<ReturnType<typeof createClient>>;

const COLUMNS =
  'id, kind, test_code, phone, client_id, amount_paise, status, closed_reason, source, coordinator_id, paid_at, created_at, before_system, ' +
  'purchase_stages(stage, position, planned_at, done_at, status), purchase_payments(payments(created_at, status, attempt_id)), ' +
  'calls(id, kind, status, outcome, due_at, closed_at), ' +
  'presentation_bookings(id, counsellor_id, on_date, start_time, end_time, marked_by_admin, status, booked_at, booked_by_name, done_at, done_by_name), ' +
  'package_payments!package_payments_purchase_id_fkey(id, amount_paise, paid_at, provider, method, status, refund_status, counted_at, after_handover, package_purchase_id, reference, proof_url, recorded_by_name, accounts_check, price_paise, advance_paise)';

/** Rows shown on the screen: purchases, open attempts and attempts closed as Not interested. */
const SHOWN = 'status.neq.not_paid,closed_at.is.null,closed_reason.eq.not_interested';
const UNPAID_SHOWN = 'closed_at.is.null,closed_reason.eq.not_interested';

type One<T> = T | T[] | null;
const one = <T>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

interface RawPurchase {
  id: string;
  kind: string;
  /** Computed in the database (before_system()): paid, or last tried, more than 7 days before go-live. */
  before_system: boolean;
  test_code: string;
  phone: string;
  client_id: string | null;
  amount_paise: number;
  status: PurchaseRowStatus;
  closed_reason: 'replaced' | 'not_interested' | 'not_needed' | null;
  source: 'pay_page' | 'manual';
  coordinator_id: string | null;
  paid_at: string | null;
  created_at: string;
  purchase_stages: StageRow[] | null;
  purchase_payments: { payments: One<{ created_at: string; status: string; attempt_id: string | null }> }[] | null;
  calls: { id: string; kind: CallKind; status: string; outcome: CallOutcome | null; due_at: string; closed_at: string | null }[] | null;
  presentation_bookings: (Omit<Presentation, 'counsellor_name'> & { status: string })[] | null;
  package_payments: RawPackagePayment[] | null;
}

export interface RawPackagePayment {
  id: string;
  amount_paise: number;
  paid_at: string | null;
  provider: 'razorpay' | 'offline';
  method: string | null;
  status: string;
  refund_status: string | null;
  counted_at: string | null;
  after_handover: boolean;
  package_purchase_id: string | null;
  reference: string | null;
  proof_url: string | null;
  recorded_by_name: string | null;
  accounts_check: 'pending' | 'checked' | null;
  price_paise: number;
  advance_paise: number;
}

export interface PackageAmounts {
  price_paise: number;
  first_min_paise: number;
  start_paise: number;
}

/**
 * The amounts of the active package, for the screens of staff who work with purchases (super admins and
 * coordinators; read with the service role after the role check, once per request). Null for everyone else.
 */
export const packageAmounts = cache(async (): Promise<PackageAmounts | null> => {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return null;
  const { data, error } = await createAdminClient().from('packages').select('price_paise, first_min_paise, start_paise').eq('is_active', true).maybeSingle();
  // Before the migration 20261124000000 the two new columns do not exist: no amounts.
  if (error || !data) return null;
  return data as PackageAmounts;
});

/**
 * The package of an assessment purchase from the package payments this staff member read (RLS: a coordinator reads
 * only those made up to the handover). `fullView`: super admins see every payment, so the remaining amount is known.
 */
export function packageState(
  payments: RawPackagePayment[],
  purchase: { amount_paise: number },
  packageCall: { status: string; outcome: CallOutcome | null; closed_at: string | null } | null,
  amounts: PackageAmounts | null,
  fullView: boolean
): PackageState {
  const paid = payments.filter((p): p is RawPackagePayment & { paid_at: string } => p.status === 'paid' && !!p.paid_at);
  const counted = paid.filter((p) => !p.refund_status && p.counted_at).sort((a, b) => a.counted_at!.localeCompare(b.counted_at!));
  const callStarted = packageCall?.status === 'closed' && (packageCall.outcome === 'package_started' || packageCall.outcome === 'package_paid');
  const started = callStarted || counted.some((p) => p.package_purchase_id);
  // The package amount is fixed by the first payment that counted; before that it follows the settings.
  const first = counted[0];
  const total = first
    ? first.price_paise - first.advance_paise
    : amounts && amounts.price_paise > purchase.amount_paise
      ? amounts.price_paise - purchase.amount_paise
      : null;
  return {
    payments: paid
      .sort((a, b) => a.paid_at.localeCompare(b.paid_at))
      .map((p): PackagePayment => ({
        id: p.id,
        amount_paise: p.amount_paise,
        paid_at: p.paid_at,
        provider: p.provider,
        method: p.method,
        reference: p.reference,
        proof_url: p.proof_url,
        recorded_by_name: p.recorded_by_name,
        accounts_check: p.accounts_check,
        refund_needed: !!p.refund_status,
        after_handover: p.after_handover,
      })),
    paid_paise: counted.reduce((sum, p) => sum + p.amount_paise, 0),
    total_paise: total,
    start_paise: total === null ? null : Math.min(amounts?.start_paise ?? total, total),
    started,
    started_at: started ? (callStarted ? packageCall!.closed_at : null) : null,
    complete: fullView || !started,
  };
}

export interface NameLookup {
  client: (r: { client_id: string | null; phone: string }) => string | null;
  coordinator: (id: string | null) => string | null;
  test: (code: string) => string;
}

/** Names for rows: the client (linked, else registered with the number), the coordinator, the assessment. */
export async function nameLookup(
  db: Db,
  rows: { client_id: string | null; phone: string; coordinator_id: string | null }[],
  /** Other staff whose names are needed (e.g. counsellors). */
  extraProfileIds: string[] = []
): Promise<NameLookup> {
  const clientIds = [...new Set(rows.map((r) => r.client_id).filter((v): v is string => !!v))];
  const phones = [...new Set(rows.filter((r) => !r.client_id).map((r) => r.phone))];
  // Client phones are stored as +91…; older rows may hold 91… or the 10 digits.
  const phoneForms = phones.flatMap((p) => [p, p.replace(/^\+/, ''), p.slice(-10)]);
  const coordIds = [...new Set([...rows.map((r) => r.coordinator_id), ...extraProfileIds].filter((v): v is string => !!v))];
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

async function withNames(db: Db, raw: RawPurchase[], fullView: boolean): Promise<PurchaseRow[]> {
  const counsellorIds = raw.flatMap((r) => (r.presentation_bookings ?? []).filter((b) => b.status === 'booked').map((b) => b.counsellor_id));
  const [names, progress, amounts] = await Promise.all([nameLookup(db, raw, counsellorIds), assessmentProgress(raw), packageAmounts()]);
  return raw.map(({ purchase_stages, purchase_payments, calls, presentation_bookings, package_payments, client_id, coordinator_id, closed_reason, ...r }) => {
    const packageCall = (calls ?? []).find((c) => c.kind === 'package') ?? null;
    // The call that closed when the package started: the Pending payment call after a part payment, else the Package call.
    const startCall = (calls ?? []).find((c) => c.kind === 'pending_payment') ?? packageCall;
    const pkg = packageState(package_payments ?? [], r, startCall, amounts, fullView);
    const booked = (presentation_bookings ?? []).find((b) => b.status === 'booked');
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
      presentation: booked
        ? { id: booked.id, counsellor_id: booked.counsellor_id, counsellor_name: names.coordinator(booked.counsellor_id), on_date: booked.on_date, start_time: booked.start_time, end_time: booked.end_time, marked_by_admin: booked.marked_by_admin, booked_at: booked.booked_at, booked_by_name: booked.booked_by_name, done_at: booked.done_at, done_by_name: booked.done_by_name }
        : null,
      can_book: r.status === 'paid' && !booked && stages.some((s) => s.stage === 'assessment' && s.status === 'done'),
      can_mark_presentation_admin:
        r.status === 'paid' && r.before_system && !booked && stages.some((s) => s.stage === 'assessment' && s.status === 'done'),
      package_call: packageCall ? { status: packageCall.status as 'open' | 'closed', outcome: packageCall.outcome, due_at: packageCall.due_at } : null,
      pkg,
      can_add_package_payment:
        r.status === 'paid' && !!booked?.done_at && !pkg.started && pkg.total_paise !== null && pkg.paid_paise < pkg.total_paise,
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
    head().eq('kind', 'assessment').eq('status', 'not_paid').or(UNPAID_SHOWN),
    head().eq('kind', 'assessment').in('status', [...PURCHASE_STATUSES]),
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
  // Assessment purchases only: Package purchases are not part of these tabs (super admins: listPackagePurchases).
  let q = db.from('purchases').select(COLUMNS, { count: 'exact' }).eq('kind', 'assessment');
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
  return { rows: await withNames(db, (data ?? []) as unknown as RawPurchase[], profile.role === 'super_admin'), total: count ?? 0 };
}

/**
 * One row with its journey, payments (tries) and calls with their history, or null when it does not exist, is a
 * replaced attempt, or is not the staff member's.
 */
export async function getPurchase(id: string): Promise<PurchaseDetail | null> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return null;
  const db = await createClient();
  // The row, its payments and its calls are read at the same time (all by id; RLS decides what this staff member
  // sees, so a row they may not see returns nothing and its payments / calls are not used).
  const [{ data }, { data: links }, { data: callData }, { data: blocked }] = await Promise.all([
    db.from('purchases').select(COLUMNS).eq('id', id).eq('kind', 'assessment').or(SHOWN).maybeSingle(),
    db
      .from('purchase_payments')
      .select(
        'accounts_check, extra_paid_at, payments(id, provider, status, refund_status, method, amount_paise, currency, paid_at, created_at, reference, provider_order_id, provider_payment_id, proof_url, recorded_by, attempts(started_at, completed_at))'
      )
      .eq('purchase_id', id),
    db
      .from('calls')
      .select('id, kind, status, outcome, created_at, due_at, closed_at, closed_note, call_logs(id, at, entry, choice, reason, note, follow_up_at, event, by_name)')
      .eq('purchase_id', id),
    // Empty (an error, not thrown) before the migration 20261123000000.
    db.from('purchase_blocked_tries').select('at, signed_in').eq('purchase_id', id),
  ]);
  if (!data) return null;
  type RawPayment = Omit<PurchasePayment, 'recorded_by_name' | 'accounts_check' | 'attempt' | 'extra_paid'> & {
    recorded_by: string | null;
    attempts: One<{ started_at: string | null; completed_at: string | null }>;
  };
  type RawLink = { accounts_check: PurchasePayment['accounts_check']; extra_paid_at: string | null; payments: One<RawPayment> };
  type Link = { check: PurchasePayment['accounts_check']; extra: boolean; p: RawPayment };
  const raw = ((links ?? []) as unknown as RawLink[])
    .map((l) => ({ check: l.accounts_check, extra: !!l.extra_paid_at, p: one(l.payments) }))
    .filter((l): l is Link => !!l.p);

  // The row's names and the staff names of its payments, at the same time.
  const staffIds = [...new Set(raw.map((l) => l.p.recorded_by).filter((v): v is string => !!v))];
  const [[row], { data: staff }] = await Promise.all([
    withNames(db, [data as unknown as RawPurchase], profile.role === 'super_admin'),
    staffIds.length ? createAdminClient().from('profiles').select('id, full_name').in('id', staffIds) : Promise.resolve({ data: [] }),
  ]);
  const staffName = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));

  const payments = raw
    .map(({ check, extra, p: { recorded_by, attempts, ...p } }) => ({
      ...p,
      recorded_by_name: recorded_by ? staffName.get(recorded_by) ?? null : null,
      accounts_check: check,
      attempt: one(attempts),
      extra_paid: extra,
    }))
    .sort((a, b) => (b.paid_at ?? b.created_at).localeCompare(a.paid_at ?? a.created_at));

  type RawCall = Omit<CallRow, 'logs' | 'prior_calls'> & { call_logs: CallLogRow[] | null };
  const calls = ((callData ?? []) as unknown as RawCall[])
    .map(({ call_logs, ...c }) => {
      const logs = [...(call_logs ?? [])].sort((a, b) => b.at.localeCompare(a.at));
      return { ...c, logs, prior_calls: logs.filter((l) => l.entry === 'call').length };
    })
    // Open first, then the newest.
    .sort((a, b) => (a.status === b.status ? b.created_at.localeCompare(a.created_at) : a.status === 'open' ? -1 : 1));
  const blocked_tries = ((blocked ?? []) as { at: string; signed_in: boolean }[]).sort((a, b) => a.at.localeCompare(b.at));
  return { ...row, payments, calls, blocked_tries };
}
