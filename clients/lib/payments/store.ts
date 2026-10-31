import type { SupabaseClient } from '@supabase/supabase-js';

// Persistence for payments (public.payments, public.payment_events). A payment is a purchase owned by a
// phone number; client_id is filled when a client logs in with that phone (claim). The Supabase
// implementation runs with the service role; an in-memory one is used in tests.

export type PaymentStatus = 'created' | 'paid' | 'failed';
export type RefundStatus = 'needed' | 'refunded';

export interface PaymentRow {
  id: string;
  phone: string;
  client_id: string | null;
  test_code: string;
  amount_paise: number;
  currency: string;
  status: PaymentStatus;
  provider_order_id: string;
  provider_payment_id: string | null;
  method: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  attempt_id: string | null;
  refund_status: RefundStatus | null;
  paid_at: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface NewPayment {
  id: string;
  phone: string;
  /** Set (with claimed_at) when a signed-in client buys for their own number. */
  client_id: string | null;
  claimed_at: string | null;
  test_code: string;
  amount_paise: number;
  currency: string;
  provider_order_id: string;
  ip_hash: string | null;
}

export interface PaymentStore {
  createPayment(row: NewPayment): Promise<PaymentRow>;
  getById(id: string): Promise<PaymentRow | null>;
  getByOrderId(orderId: string): Promise<PaymentRow | null>;
  /** Orders created since `since` for this phone and for this IP hash (rate limit). */
  countRecent(phone: string, ipHash: string | null, since: string): Promise<{ phone: number; ip: number }>;
  /** Marks the payment paid unless it already is; returns the row as stored. */
  markPaid(id: string, paid: { provider_payment_id: string; method: string | null; paid_at: string }): Promise<PaymentRow>;
  /** Marks a still-open payment failed (a paid one is never touched). */
  markFailed(id: string, failure: { provider_payment_id: string | null; code: string | null; reason: string | null }): Promise<void>;
  /** Links every paid, unclaimed purchase of the phone to the client; returns how many. */
  claim(phone: string, clientId: string, at: string): Promise<number>;
  /** The client's paid purchases that are not started and not marked for refund, oldest first. */
  listReady(clientId: string): Promise<PaymentRow[]>;
  /** Marks the phone's paid, unclaimed, unstarted purchases as needing a refund. */
  markRefundNeeded(phone: string): Promise<number>;
  linkAttempt(id: string, attemptId: string): Promise<void>;
  hasEvent(eventId: string): Promise<boolean>;
  recordEvent(event: { provider_event_id: string; event: string; provider_order_id: string | null; provider_payment_id: string | null }): Promise<void>;
}

const COLUMNS =
  'id, phone, client_id, test_code, amount_paise, currency, status, provider_order_id, provider_payment_id, method, failure_code, failure_reason, attempt_id, refund_status, paid_at, claimed_at, created_at';

function check<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

export function supabasePaymentStore(db: SupabaseClient): PaymentStore {
  return {
    async createPayment(row) {
      const r = await db.from('payments').insert(row).select(COLUMNS).single();
      return check(r, 'create payment') as PaymentRow;
    },
    async getById(id) {
      const r = await db.from('payments').select(COLUMNS).eq('id', id).maybeSingle();
      return check(r, 'payment') as PaymentRow | null;
    },
    async getByOrderId(orderId) {
      const r = await db.from('payments').select(COLUMNS).eq('provider_order_id', orderId).maybeSingle();
      return check(r, 'payment') as PaymentRow | null;
    },
    async countRecent(phone, ipHash, since) {
      const [byPhone, byIp] = await Promise.all([
        db.from('payments').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since),
        ipHash
          ? db.from('payments').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since)
          : Promise.resolve({ count: 0, error: null }),
      ]);
      if (byPhone.error) throw new Error(`count payments: ${byPhone.error.message}`);
      if (byIp.error) throw new Error(`count payments: ${byIp.error.message}`);
      return { phone: byPhone.count ?? 0, ip: byIp.count ?? 0 };
    },
    async markPaid(id, paid) {
      // Conditional update: only an unpaid row changes, so verify and webhook can race safely.
      const u = await db
        .from('payments')
        .update({ status: 'paid', ...paid, failure_code: null, failure_reason: null })
        .eq('id', id)
        .neq('status', 'paid')
        .select(COLUMNS)
        .maybeSingle();
      const updated = check(u, 'mark payment paid') as PaymentRow | null;
      if (updated) return updated;
      const r = await db.from('payments').select(COLUMNS).eq('id', id).single();
      return check(r, 'payment') as PaymentRow;
    },
    async markFailed(id, failure) {
      const r = await db
        .from('payments')
        .update({ status: 'failed', provider_payment_id: failure.provider_payment_id, failure_code: failure.code, failure_reason: failure.reason })
        .eq('id', id)
        .eq('status', 'created');
      check(r, 'mark payment failed');
    },
    async claim(phone, clientId, at) {
      const r = await db
        .from('payments')
        .update({ client_id: clientId, claimed_at: at })
        .eq('phone', phone)
        .eq('status', 'paid')
        .is('client_id', null)
        .select('id');
      return (check(r, 'claim purchases') ?? []).length;
    },
    async listReady(clientId) {
      const r = await db
        .from('payments')
        .select(COLUMNS)
        .eq('client_id', clientId)
        .eq('status', 'paid')
        .is('attempt_id', null)
        .is('refund_status', null)
        .order('paid_at', { ascending: true });
      return (check(r, 'ready purchases') ?? []) as PaymentRow[];
    },
    async markRefundNeeded(phone) {
      const r = await db
        .from('payments')
        .update({ refund_status: 'needed' })
        .eq('phone', phone)
        .eq('status', 'paid')
        .is('client_id', null)
        .is('attempt_id', null)
        .is('refund_status', null)
        .select('id');
      return (check(r, 'mark refund needed') ?? []).length;
    },
    async linkAttempt(id, attemptId) {
      const r = await db.from('payments').update({ attempt_id: attemptId }).eq('id', id).is('attempt_id', null);
      check(r, 'link attempt');
    },
    async hasEvent(eventId) {
      const r = await db.from('payment_events').select('id').eq('provider_event_id', eventId).maybeSingle();
      return !!check(r, 'payment event');
    },
    async recordEvent(event) {
      const r = await db.from('payment_events').upsert(event, { onConflict: 'provider_event_id', ignoreDuplicates: true });
      check(r, 'record payment event');
    },
  };
}
