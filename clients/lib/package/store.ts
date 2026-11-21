import type { SupabaseClient } from '@supabase/supabase-js';

// Persistence for the package offer and package payments (public.package_payments; the ₹3,500 assessment
// payments in public.payments are a separate table and are not touched here). Every rule lives in database
// functions (migration 20261121300000_packages.sql): the amount is always package price − assessment amount
// paid, calculated there. The Supabase implementation runs with the service role; tests use an in-memory one.

export interface PackageOffer {
  /** The assessment purchase the offer is for. */
  purchase_id: string;
  package_id: string;
  name: string;
  sessions: number;
  frequency: string;
  price_paise: number;
  advance_paise: number;
  amount_paise: number;
}

export interface PackagePaymentRow {
  id: string;
  purchase_id: string;
  client_id: string | null;
  amount_paise: number;
  currency: string;
  status: 'created' | 'paid' | 'failed';
  provider_order_id: string;
  provider_payment_id: string | null;
  refund_status: 'needed' | 'refunded' | null;
  created_at: string;
}

export interface PaidPackage {
  sessions: number;
  frequency: string;
  amount_paise: number;
  paid_at: string;
}

/** What settling a paid payment gave: the package, or a second payment kept apart for a refund. */
export type SettleResult = 'paid' | 'duplicate';

/** Raised by start(): the database refused the order. */
export class PackageStoreError extends Error {
  constructor(public readonly reason: 'NOT_AVAILABLE' | 'AMOUNT' | 'RATE_LIMITED') {
    super(reason);
    this.name = 'PackageStoreError';
  }
}

export interface PackageStore {
  /** The client's open offers (report presentation done, no package paid yet). */
  offers(clientId: string): Promise<PackageOffer[]>;
  /** Razorpay orders created for this purchase since `since` (rate limit). */
  countRecent(purchaseId: string, since: string): Promise<number>;
  /** Records the order. The database checks the client, the offer and the amount again. */
  start(row: { id: string; purchaseId: string; clientId: string; orderId: string; amount: number }): Promise<void>;
  getByOrderId(orderId: string): Promise<PackagePaymentRow | null>;
  /** Marks the payment paid (once) and makes the Package purchase. */
  markPaid(id: string, paid: { provider_payment_id: string; method: string | null; paid_at: string }): Promise<SettleResult>;
  /** Marks a still-open payment failed (a paid one is never touched). */
  markFailed(id: string, failure: { provider_payment_id: string | null; code: string | null; reason: string | null }): Promise<void>;
  /** The client's payments still waiting for the checkout result, created since `since`. */
  listOpen(clientId: string, since: string): Promise<PackagePaymentRow[]>;
  /** The client's paid packages, newest first. */
  paid(clientId: string): Promise<PaidPackage[]>;
}

const COLUMNS = 'id, purchase_id, client_id, amount_paise, currency, status, provider_order_id, provider_payment_id, refund_status, created_at';

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

export function supabasePackageStore(db: SupabaseClient): PackageStore {
  return {
    async offers(clientId) {
      const r = await db.rpc('package_offers_for_client', { p_client: clientId });
      return (check(r, 'package offers') ?? []) as PackageOffer[];
    },
    async countRecent(purchaseId, since) {
      const r = await db
        .from('package_payments')
        .select('id', { count: 'exact', head: true })
        .eq('purchase_id', purchaseId)
        .eq('provider', 'razorpay')
        .gte('created_at', since);
      if (r.error) throw new Error(`count package payments: ${r.error.message}`);
      return r.count ?? 0;
    },
    async start(row) {
      const { error } = await db.rpc('package_payment_start', {
        p_id: row.id,
        p_purchase: row.purchaseId,
        p_client: row.clientId,
        p_order_id: row.orderId,
        p_amount: row.amount,
      });
      if (!error) return;
      if (error.message.includes('Too many attempts')) throw new PackageStoreError('RATE_LIMITED');
      if (error.message.includes('The amount does not match')) throw new PackageStoreError('AMOUNT');
      if (error.message.includes('This offer')) throw new PackageStoreError('NOT_AVAILABLE');
      throw new Error(`start package payment: ${error.message}`);
    },
    async getByOrderId(orderId) {
      const r = await db.from('package_payments').select(COLUMNS).eq('provider_order_id', orderId).maybeSingle();
      return check(r, 'package payment') as PackagePaymentRow | null;
    },
    async markPaid(id, paid) {
      const r = await db.rpc('package_payment_mark_paid', {
        p_id: id,
        p_provider_payment_id: paid.provider_payment_id,
        p_method: paid.method,
        p_paid_at: paid.paid_at,
      });
      return check(r, 'mark package payment paid') === 'duplicate' ? 'duplicate' : 'paid';
    },
    async markFailed(id, failure) {
      const r = await db.rpc('package_payment_mark_failed', {
        p_id: id,
        p_provider_payment_id: failure.provider_payment_id,
        p_code: failure.code,
        p_reason: failure.reason,
      });
      check(r, 'mark package payment failed');
    },
    async listOpen(clientId, since) {
      const r = await db
        .from('package_payments')
        .select(COLUMNS)
        .eq('client_id', clientId)
        .eq('status', 'created')
        .gte('created_at', since)
        .order('created_at', { ascending: true });
      return (check(r, 'open package payments') ?? []) as PackagePaymentRow[];
    },
    async paid(clientId) {
      const r = await db
        .from('package_payments')
        .select('sessions, frequency, amount_paise, paid_at')
        .eq('client_id', clientId)
        .eq('status', 'paid')
        .not('package_purchase_id', 'is', null)
        .order('paid_at', { ascending: false });
      return (check(r, 'paid packages') ?? []) as PaidPackage[];
    },
  };
}
