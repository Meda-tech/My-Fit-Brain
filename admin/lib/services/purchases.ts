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
import type { PaymentProvider, PaymentStatus, RefundStatus } from './payments';

// Purchases (step 1). Reads use the staff session, so RLS decides: super admins see every row, a coordinator
// only the rows of their own clients, counsellors none. Nothing here writes: the database keeps the rows up to
// date from payments and assessments.
// One table holds both: purchases (paid, refunded, cancelled) and payment attempts (not_paid: tried on the pay
// page, not paid). Only OPEN attempts are shown (tab Unpaid); an older attempt replaced by a later try or
// purchase of the same phone and assessment is closed and never shown. When the phone pays, the same row
// becomes the purchase, so it moves from Unpaid to Paid by itself, with the same coordinator.

export const PURCHASE_ROLES = ['super_admin', 'coordinator'] as const;

export function canViewPurchases(role: string): boolean {
  return (PURCHASE_ROLES as readonly string[]).includes(role);
}

export const PURCHASE_PAGE_SIZE = 50;

export interface PurchaseRow {
  id: string;
  kind: string;
  test_code: string;
  test_name: string;
  phone: string;
  client_name: string | null;
  amount_paise: number;
  status: PurchaseRowStatus;
  source: 'pay_page' | 'manual';
  coordinator_name: string | null;
  paid_at: string | null;
  created_at: string;
  /** How many payments (tries) the row holds. */
  tries: number;
  /** The time of the latest try. */
  last_tried_at: string;
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

export interface PurchaseDetail extends PurchaseRow {
  payments: PurchasePayment[];
}

type Db = Awaited<ReturnType<typeof createClient>>;

const COLUMNS =
  'id, kind, test_code, phone, client_id, amount_paise, status, source, coordinator_id, paid_at, created_at, ' +
  'purchase_stages(stage, position, planned_at, done_at, status), purchase_payments(payments(created_at))';

/** Rows shown on the screen: purchases plus open payment attempts (closed attempts never). */
const SHOWN = `status.neq.not_paid,closed_at.is.null`;

interface RawPurchase {
  id: string;
  kind: string;
  test_code: string;
  phone: string;
  client_id: string | null;
  amount_paise: number;
  status: PurchaseRowStatus;
  source: 'pay_page' | 'manual';
  coordinator_id: string | null;
  paid_at: string | null;
  created_at: string;
  purchase_stages: StageRow[] | null;
  purchase_payments: { payments: { created_at: string } | { created_at: string }[] | null }[] | null;
}

/** Names for the rows: the client (linked, else registered with the number), the coordinator, the assessment. */
async function withNames(db: Db, raw: RawPurchase[]): Promise<PurchaseRow[]> {
  const clientIds = [...new Set(raw.map((r) => r.client_id).filter((v): v is string => !!v))];
  const phones = [...new Set(raw.filter((r) => !r.client_id).map((r) => r.phone))];
  // Client phones are stored as +91…; older rows may hold 91… or the 10 digits.
  const phoneForms = phones.flatMap((p) => [p, p.replace(/^\+/, ''), p.slice(-10)]);
  const coordIds = [...new Set(raw.map((r) => r.coordinator_id).filter((v): v is string => !!v))];
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

  return raw.map(({ purchase_stages, purchase_payments, client_id, coordinator_id, ...r }) => {
    const stages = [...(purchase_stages ?? [])].sort((a, b) => a.position - b.position);
    const tryTimes = (purchase_payments ?? [])
      .flatMap((l) => (Array.isArray(l.payments) ? l.payments : l.payments ? [l.payments] : []))
      .map((p) => p.created_at)
      .sort();
    return {
      ...r,
      test_name: testName.get(r.test_code) ?? r.test_code,
      client_name: client_id ? idName.get(client_id) ?? null : phoneName.get(r.phone.slice(-10)) ?? null,
      coordinator_name: coordinator_id ? coordName.get(coordinator_id) ?? null : null,
      tries: tryTimes.length,
      last_tried_at: tryTimes.at(-1) ?? r.created_at,
      stages,
      current_stage: currentStage(stages),
    };
  });
}

/** How many rows each tab has for this staff member. */
export async function purchaseTabCounts(): Promise<Record<PurchaseTab, number>> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return { unpaid: 0, paid: 0, all: 0 };
  const db = await createClient();
  const head = () => db.from('purchases').select('id', { count: 'exact', head: true });
  const [unpaid, paid] = await Promise.all([
    head().eq('status', 'not_paid').is('closed_at', null),
    head().in('status', [...PURCHASE_STATUSES]),
  ]);
  if (unpaid.error?.code === '42P01' || paid.error?.code === '42P01') return { unpaid: 0, paid: 0, all: 0 };
  const u = unpaid.count ?? 0;
  const p = paid.count ?? 0;
  return { unpaid: u, paid: p, all: u + p };
}

/**
 * One page of a tab, newest first. Unpaid: open payment attempts, by first try. Paid: purchases, by paid time.
 * All: both, by first try.
 */
export async function listPurchases(tab: PurchaseTab, page: number): Promise<{ rows: PurchaseRow[]; total: number }> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return { rows: [], total: 0 };
  const db = await createClient();
  const from = (page - 1) * PURCHASE_PAGE_SIZE;
  let q = db.from('purchases').select(COLUMNS, { count: 'exact' });
  if (tab === 'unpaid') {
    q = q.eq('status', 'not_paid').is('closed_at', null).order('created_at', { ascending: false });
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
 * One row with its journey and its payments (tries), or null when it does not exist, is a closed attempt, or
 * is not the staff member's.
 */
export async function getPurchase(id: string): Promise<PurchaseDetail | null> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return null;
  const db = await createClient();
  const { data } = await db.from('purchases').select(COLUMNS).eq('id', id).or(SHOWN).maybeSingle();
  if (!data) return null;
  const [row] = await withNames(db, [data as unknown as RawPurchase]);

  const { data: links } = await db
    .from('purchase_payments')
    .select(
      'accounts_check, payments(id, provider, status, refund_status, method, amount_paise, currency, paid_at, created_at, reference, provider_order_id, provider_payment_id, proof_url, recorded_by)'
    )
    .eq('purchase_id', id);
  type RawPayment = Omit<PurchasePayment, 'recorded_by_name' | 'accounts_check'> & { recorded_by: string | null };
  type RawLink = { accounts_check: PurchasePayment['accounts_check']; payments: RawPayment | RawPayment[] | null };
  const raw = ((links ?? []) as unknown as RawLink[])
    .map((l) => ({ check: l.accounts_check, p: Array.isArray(l.payments) ? l.payments[0] : l.payments }))
    .filter((l): l is { check: PurchasePayment['accounts_check']; p: RawPayment } => !!l.p);

  const staffIds = [...new Set(raw.map((l) => l.p.recorded_by).filter((v): v is string => !!v))];
  const { data: staff } = staffIds.length ? await createAdminClient().from('profiles').select('id, full_name').in('id', staffIds) : { data: [] };
  const staffName = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));

  const payments = raw
    .map(({ check, p: { recorded_by, ...p } }) => ({ ...p, recorded_by_name: recorded_by ? staffName.get(recorded_by) ?? null : null, accounts_check: check }))
    .sort((a, b) => (b.paid_at ?? b.created_at).localeCompare(a.paid_at ?? a.created_at));
  return { ...row, payments };
}
