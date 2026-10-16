import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClientProfile } from '../assessment/types';

// Persistence for payments (public.payments, public.payment_events). The Supabase implementation runs
// with the service role; an in-memory one is used in tests.

export type PaymentStatus = 'created' | 'paid' | 'failed';

export interface PaymentRow {
  id: string;
  client_id: string;
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
  paid_at: string | null;
  created_at: string;
}

export interface NewPayment {
  id: string;
  client_id: string;
  test_code: string;
  amount_paise: number;
  currency: string;
  provider_order_id: string;
}

export interface PaymentStore {
  createPayment(row: NewPayment): Promise<PaymentRow>;
  getByOrderId(orderId: string): Promise<PaymentRow | null>;
  /** Marks the payment paid unless it already is; returns the row as stored. */
  markPaid(id: string, paid: { provider_payment_id: string; method: string | null; paid_at: string }): Promise<PaymentRow>;
  /** Marks a still-open payment failed (a paid one is never touched). */
  markFailed(id: string, failure: { provider_payment_id: string | null; code: string | null; reason: string | null }): Promise<void>;
  linkAttempt(id: string, attemptId: string): Promise<void>;
  hasEvent(eventId: string): Promise<boolean>;
  recordEvent(event: { provider_event_id: string; event: string; provider_order_id: string | null; provider_payment_id: string | null }): Promise<void>;
  /** The client's profile for creating the attempt (gender, age, relationship status). */
  clientProfile(clientId: string): Promise<ClientProfile | null>;
}

const COLUMNS =
  'id, client_id, test_code, amount_paise, currency, status, provider_order_id, provider_payment_id, method, failure_code, failure_reason, attempt_id, paid_at, created_at';

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
    async getByOrderId(orderId) {
      const r = await db.from('payments').select(COLUMNS).eq('provider_order_id', orderId).maybeSingle();
      return check(r, 'payment') as PaymentRow | null;
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
    async clientProfile(clientId) {
      const r = await db.from('clients').select('id, gender, age, marital_status').eq('id', clientId).maybeSingle();
      return check(r, 'client') as ClientProfile | null;
    },
  };
}
