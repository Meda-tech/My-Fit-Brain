import type { ClientProfile } from '../lib/assessment/types';
import type { RazorpayGateway, RazorpayOrder, RazorpayPayment } from '../lib/payments/razorpay';
import type { NewPayment, PaymentRow, PaymentStore } from '../lib/payments/store';

// In-memory payment store and a fake Razorpay for tests (no network). The store keeps the same rules
// as the database: a paid payment stays paid, failures only touch open payments, attempts link once.

export class MemoryPayments implements PaymentStore {
  rows = new Map<string, PaymentRow>();
  events = new Set<string>();
  clients = new Map<string, ClientProfile>();

  async createPayment(row: NewPayment) {
    const p: PaymentRow = {
      ...row,
      status: 'created',
      provider_payment_id: null,
      method: null,
      failure_code: null,
      failure_reason: null,
      attempt_id: null,
      paid_at: null,
      created_at: '2026-10-18T09:58:00.000Z',
    };
    this.rows.set(p.id, p);
    return { ...p };
  }
  async getByOrderId(orderId: string) {
    const p = [...this.rows.values()].find((r) => r.provider_order_id === orderId);
    return p ? { ...p } : null;
  }
  async markPaid(id: string, paid: { provider_payment_id: string; method: string | null; paid_at: string }) {
    const p = this.rows.get(id)!;
    if (p.status !== 'paid') Object.assign(p, { status: 'paid', ...paid, failure_code: null, failure_reason: null });
    return { ...p };
  }
  async markFailed(id: string, f: { provider_payment_id: string | null; code: string | null; reason: string | null }) {
    const p = this.rows.get(id)!;
    if (p.status === 'created') Object.assign(p, { status: 'failed', provider_payment_id: f.provider_payment_id, failure_code: f.code, failure_reason: f.reason });
  }
  async linkAttempt(id: string, attemptId: string) {
    const p = this.rows.get(id)!;
    if (!p.attempt_id) p.attempt_id = attemptId;
  }
  async hasEvent(eventId: string) {
    return this.events.has(eventId);
  }
  async recordEvent(e: { provider_event_id: string }) {
    this.events.add(e.provider_event_id);
  }
  async clientProfile(clientId: string) {
    return this.clients.get(clientId) ?? null;
  }
}

export class FakeRazorpay implements RazorpayGateway {
  keyId = 'rzp_test_key';
  orders = new Map<string, RazorpayOrder>();
  payments = new Map<string, RazorpayPayment>();
  captures: string[] = [];
  private n = 0;

  async createOrder(input: { amount: number; currency: string; receipt: string }) {
    const order = { id: `order_${++this.n}`, amount: input.amount, currency: input.currency, receipt: input.receipt, status: 'created' };
    this.orders.set(order.id, order);
    return order;
  }
  /** What Razorpay would hold after the client pays in the checkout. */
  pay(orderId: string, overrides: Partial<RazorpayPayment> = {}): RazorpayPayment {
    const order = this.orders.get(orderId)!;
    const p: RazorpayPayment = {
      id: `pay_${++this.n}`,
      order_id: orderId,
      amount: order.amount,
      currency: order.currency,
      status: 'captured',
      method: 'upi',
      captured: true,
      error_code: null,
      error_description: null,
      ...overrides,
    };
    this.payments.set(p.id, p);
    return p;
  }
  async fetchPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error('payment not found');
    return { ...p };
  }
  async capturePayment(id: string) {
    const p = this.payments.get(id)!;
    this.captures.push(id);
    Object.assign(p, { status: 'captured', captured: true });
    return { ...p };
  }
  // The fake signs with a fixed rule; the real HMAC is tested separately.
  static sign(orderId: string, paymentId: string) {
    return `sig:${orderId}|${paymentId}`;
  }
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
    return signature === FakeRazorpay.sign(orderId, paymentId);
  }
  verifyWebhookSignature(rawBody: string, signature: string) {
    return signature === `whsig:${rawBody.length}`;
  }
}
