import type { RazorpayGateway, RazorpayOrder, RazorpayPayment } from '../lib/payments/razorpay';
import type { NewPayment, PaymentRow, PaymentStore } from '../lib/payments/store';

// In-memory payment store and a fake Razorpay for tests (no network). The store keeps the same rules
// as the database: a paid payment stays paid, failures only touch open payments, attempts link once,
// claims only take paid, unclaimed purchases.

export class MemoryPayments implements PaymentStore {
  rows = new Map<string, PaymentRow & { ip_hash: string | null }>();
  events = new Set<string>();
  /** created_at for new rows (tests move it to check the rate-limit window). */
  createdAt = '2026-10-22T09:58:00.000Z';
  /** Registered clients by verified phone (clientByPhone). */
  clients = new Map<string, { id: string; full_name: string }>();

  async createPayment(row: NewPayment) {
    const p = {
      ...row,
      status: 'created' as const,
      provider_payment_id: null,
      method: null,
      failure_code: null,
      failure_reason: null,
      attempt_id: null,
      refund_status: null,
      paid_at: null,
      created_at: this.createdAt,
    };
    this.rows.set(p.id, p);
    return { ...p };
  }
  async getById(id: string) {
    const p = this.rows.get(id);
    return p ? { ...p } : null;
  }
  async getByOrderId(orderId: string) {
    const p = [...this.rows.values()].find((r) => r.provider_order_id === orderId);
    return p ? { ...p } : null;
  }
  async countRecent(phone: string, ipHash: string | null, since: string) {
    const recent = [...this.rows.values()].filter((r) => r.created_at >= since);
    return { phone: recent.filter((r) => r.phone === phone).length, ip: ipHash ? recent.filter((r) => r.ip_hash === ipHash).length : 0 };
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
  async clientByPhone(phone: string) {
    return this.clients.get(phone) ?? null;
  }
  async listOpen(phone: string, since: string) {
    return [...this.rows.values()].filter((r) => r.phone === phone && r.status === 'created' && r.created_at >= since).map((r) => ({ ...r }));
  }
  async claim(phone: string, clientId: string, at: string) {
    let n = 0;
    for (const p of this.rows.values()) {
      if (p.phone === phone && p.status === 'paid' && !p.client_id) {
        Object.assign(p, { client_id: clientId, claimed_at: at });
        n += 1;
      }
    }
    return n;
  }
  async listReady(clientId: string) {
    return [...this.rows.values()]
      .filter((p) => p.client_id === clientId && p.status === 'paid' && !p.attempt_id && !p.refund_status)
      .map((p) => ({ ...p }));
  }
  async markRefundNeeded(phone: string) {
    let n = 0;
    for (const p of this.rows.values()) {
      if (p.phone === phone && p.status === 'paid' && !p.client_id && !p.attempt_id && !p.refund_status) {
        p.refund_status = 'needed';
        n += 1;
      }
    }
    return n;
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
}

export class FakeRazorpay implements RazorpayGateway {
  keyId = 'rzp_test_key';
  orders = new Map<string, RazorpayOrder>();
  payments = new Map<string, RazorpayPayment>();
  captures: string[] = [];
  private n = 0;

  /** Notes sent with the most recent order. */
  lastNotes: Record<string, string> = {};
  async createOrder(input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }) {
    this.lastNotes = input.notes;
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
  async fetchOrderPayments(orderId: string) {
    return [...this.payments.values()].filter((p) => p.order_id === orderId).map((p) => ({ ...p }));
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
