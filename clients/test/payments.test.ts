import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ServiceDeps } from '../lib/assessment/service';
import type { ClientProfile } from '../lib/assessment/types';
import { razorpayConfig, razorpayGateway, signatureMatches } from '../lib/payments/razorpay';
import {
  ASSESSMENT_PRICE_PAISE,
  ORDER_LIMIT_PER_IP,
  ORDER_LIMIT_PER_PHONE,
  claimPurchases,
  confirmCheckout,
  createCheckout,
  flagRefundForPhone,
  formatPrice,
  handleWebhook,
  PaymentError,
  recoverOpenPayments,
  startPurchase,
  type PaymentDeps,
} from '../lib/payments/service';
import { FakeRazorpay, MemoryPayments } from './memory-payments';
import { MemoryStore } from './memory-store';

// Pay first, log in later, with a fake Razorpay and in-memory stores: the server decides the amount and
// the outcome, a purchase belongs to a phone until a client with that verified phone claims it, every
// step is idempotent, and one purchase gives exactly one assessment (created on Start).

const intimacy = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/questionnaires/intimacy.json'), 'utf8'));
const client: ClientProfile = { id: 'client-1', full_name: 'Asha Verma' };
const PHONE = '+919876543210';

function setup(configured = true) {
  const store = new MemoryStore();
  store.addLiveVersion('IA', intimacy);
  const payments = new MemoryPayments();
  const rzp = new FakeRazorpay();
  let ids = 0;
  const assessment: ServiceDeps = { store, now: () => new Date('2026-10-22T10:00:00.000Z') };
  const deps: PaymentDeps = {
    payments,
    gateway: configured ? rzp : null,
    assessment,
    newId: () => `payment-${++ids}`,
    now: () => new Date('2026-10-22T10:00:00.000Z'),
  };
  return { deps, store, payments, rzp };
}

/** An order from the public pay page (not signed in). */
async function order(deps: PaymentDeps, phone = PHONE, ipHash: string | null = 'ip-1') {
  const c = await createCheckout(deps, { code: 'IA', phone, client: null, ipHash });
  if (c.kind !== 'order') throw new Error('expected an order');
  return c;
}

/** Order and pay; returns the paid purchase. */
async function paid(deps: PaymentDeps, rzp: FakeRazorpay, phone = PHONE) {
  const c = await order(deps, phone);
  const p = rzp.pay(c.orderId);
  return confirmCheckout(deps, { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) });
}

async function expectPaymentError(p: Promise<unknown>, code: PaymentError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof PaymentError && e.code === code);
}

function webhook(deps: PaymentDeps, event: string, payment: { id: string; order_id: string | null }, eventId: string | null = null) {
  const raw = JSON.stringify({ event, payload: { payment: { entity: payment } } });
  return handleWebhook(deps, raw, `whsig:${raw.length}`, eventId);
}

describe('checkout (public pay page)', () => {
  it('creates an order for ₹3,500 decided by the server, owned by the phone, not by a client', async () => {
    const { deps, payments, rzp } = setup();
    const c = await order(deps, '98765 43210');
    expect([c.amount, c.currency, c.keyId, c.phone]).toEqual([350_000, 'INR', 'rzp_test_key', PHONE]);
    expect(rzp.orders.get(c.orderId)?.receipt).toBe(c.paymentId);
    expect(payments.rows.get(c.paymentId)).toMatchObject({
      status: 'created',
      amount_paise: ASSESSMENT_PRICE_PAISE,
      phone: PHONE,
      client_id: null,
      claimed_at: null,
    });
    expect(formatPrice()).toBe('₹3,500');
  });

  it('sends the phone as an order note, never the test; a signed-in client adds id and name', async () => {
    const { deps, rzp, payments } = setup();
    const c = await order(deps);
    expect(rzp.lastNotes).toEqual({ payment_id: c.paymentId, phone: PHONE });
    const own = await createCheckout(deps, { code: 'IA', phone: PHONE, client, ipHash: null });
    if (own.kind !== 'order') throw new Error('expected an order');
    expect(rzp.lastNotes).toEqual({ payment_id: own.paymentId, phone: PHONE, client_id: client.id, client_name: client.full_name });
    expect(payments.rows.get(own.paymentId)).toMatchObject({ client_id: client.id, claimed_at: '2026-10-22T10:00:00.000Z' });
  });

  it('is refused for a bad phone, without Razorpay keys, or without a live version', async () => {
    const { deps } = setup();
    await expectPaymentError(createCheckout(deps, { code: 'IA', phone: '12345', client: null, ipHash: null }), 'BAD_PHONE');
    await expectPaymentError(order(setup(false).deps), 'NOT_CONFIGURED');
    await expect(createCheckout(deps, { code: 'XX', phone: PHONE, client: null, ipHash: null })).rejects.toMatchObject({ code: 'NO_LIVE_VERSION' });
  });

  it('limits orders per phone and per IP within an hour', async () => {
    const { deps, payments } = setup();
    for (let i = 0; i < ORDER_LIMIT_PER_PHONE; i++) await order(deps, PHONE, `ip-${i}`);
    await expectPaymentError(order(deps, PHONE, 'ip-new'), 'RATE_LIMITED');
    // Older than the window: allowed again.
    for (const p of payments.rows.values()) p.created_at = '2026-10-22T08:00:00.000Z';
    await order(deps, PHONE, 'ip-new');

    const byIp = setup();
    for (let i = 0; i < ORDER_LIMIT_PER_IP; i++) await order(byIp.deps, `+9198765${String(i).padStart(5, '0')}`, 'same-ip');
    await expectPaymentError(order(byIp.deps, '+919999999999', 'same-ip'), 'RATE_LIMITED');
  });

  it('a signed-in client who already holds the test is sent Home instead of paying again', async () => {
    const { deps, rzp } = setup();
    await paid(deps, rzp);
    await claimPurchases(deps, client, '919876543210');
    expect(await createCheckout(deps, { code: 'IA', phone: PHONE, client, ipHash: null })).toEqual({ kind: 'owned' });
  });
});

describe('verification', () => {
  it('a verified payment marks the purchase paid and creates no assessment yet', async () => {
    const { deps, store, payments, rzp } = setup();
    const c = await order(deps);
    const p = rzp.pay(c.orderId);
    const input = { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) };
    const row = await confirmCheckout(deps, input);
    expect(row).toMatchObject({ status: 'paid', provider_payment_id: p.id, method: 'upi', phone: PHONE, attempt_id: null });
    // Again (double tap, retry): same row, nothing new.
    expect((await confirmCheckout(deps, input)).id).toBe(c.paymentId);
    expect(payments.rows.size).toBe(1);
    expect(store.attempts.size).toBe(0);
  });

  it('rejects a bad signature, an unknown order, and a payment that does not match the order', async () => {
    const { deps, payments, rzp } = setup();
    const c = await order(deps);
    const p = rzp.pay(c.orderId);
    await expectPaymentError(confirmCheckout(deps, { orderId: c.orderId, paymentId: p.id, signature: 'forged' }), 'INVALID');
    await expectPaymentError(confirmCheckout(deps, { orderId: 'order_x', paymentId: p.id, signature: FakeRazorpay.sign('order_x', p.id) }), 'NOT_FOUND');
    const cheap = rzp.pay(c.orderId, { amount: 100 });
    await expectPaymentError(confirmCheckout(deps, { orderId: c.orderId, paymentId: cheap.id, signature: FakeRazorpay.sign(c.orderId, cheap.id) }), 'INVALID');
    expect(payments.rows.get(c.paymentId)?.status).toBe('created');
  });

  it('captures an authorized payment; a failed one is marked failed; a pending one waits', async () => {
    const { deps, payments, rzp } = setup();
    const c = await order(deps);
    const failed = rzp.pay(c.orderId, { status: 'failed', error_code: 'BAD_REQUEST_ERROR', error_description: 'Payment declined' });
    await expectPaymentError(confirmCheckout(deps, { orderId: c.orderId, paymentId: failed.id, signature: FakeRazorpay.sign(c.orderId, failed.id) }), 'FAILED');
    expect(payments.rows.get(c.paymentId)?.status).toBe('failed');

    const pending = rzp.pay(c.orderId, { status: 'created' });
    await expectPaymentError(confirmCheckout(deps, { orderId: c.orderId, paymentId: pending.id, signature: FakeRazorpay.sign(c.orderId, pending.id) }), 'PENDING');

    const ok = rzp.pay(c.orderId, { status: 'authorized', captured: false });
    await confirmCheckout(deps, { orderId: c.orderId, paymentId: ok.id, signature: FakeRazorpay.sign(c.orderId, ok.id) });
    expect(rzp.captures).toEqual([ok.id]);
    expect(payments.rows.get(c.paymentId)).toMatchObject({ status: 'paid', provider_payment_id: ok.id });
  });
});

describe('claim and start', () => {
  it('after login, paid purchases of the verified phone become the client’s; Start creates one attempt', async () => {
    const { deps, store, payments, rzp } = setup();
    const row = await paid(deps, rzp);
    // Supabase Auth gives the phone without "+".
    expect(await claimPurchases(deps, client, '919876543210')).toBe(1);
    expect(await claimPurchases(deps, client, '919876543210')).toBe(0);
    expect(payments.rows.get(row.id)).toMatchObject({ client_id: client.id, claimed_at: '2026-10-22T10:00:00.000Z' });

    const attemptId = await startPurchase(deps, client, row.id, 'hi');
    const attempt = store.attempts.get(attemptId)!;
    expect([attempt.status, attempt.payment_ref, attempt.report_id, attempt.language]).toEqual(['paid', row.provider_payment_id, 'MFB-IA-2026-00001', 'hi']);
    expect(payments.rows.get(row.id)?.attempt_id).toBe(attemptId);
    // Start again (double tap): same attempt, no new report number.
    expect(await startPurchase(deps, client, row.id, 'en')).toBe(attemptId);
    expect(store.counter).toBe(1);
  });

  it('another number, another client, or an unpaid purchase cannot be claimed or started', async () => {
    const { deps, payments, rzp } = setup();
    const row = await paid(deps, rzp);
    expect(await claimPurchases(deps, client, '+919000000000')).toBe(0);
    await expectPaymentError(startPurchase(deps, client, row.id, 'en'), 'NOT_FOUND');
    await claimPurchases(deps, client, PHONE);
    await expectPaymentError(startPurchase(deps, { id: 'client-2', full_name: 'Someone' }, row.id, 'en'), 'NOT_FOUND');
    const open = await order(deps);
    await claimPurchases(deps, client, PHONE);
    expect(payments.rows.get(open.paymentId)?.client_id).toBeNull();
  });

  it('under 18 at registration flags the phone’s unclaimed purchases; they cannot be started', async () => {
    const { deps, payments, rzp } = setup();
    const row = await paid(deps, rzp);
    expect(await flagRefundForPhone(deps, '919876543210')).toBe(1);
    expect(payments.rows.get(row.id)?.refund_status).toBe('needed');
    // Even if the purchase later reaches a client (e.g. moved), it is not offered for Start.
    await claimPurchases(deps, client, PHONE);
    expect(await payments.listReady(client.id)).toEqual([]);
    await expectPaymentError(startPurchase(deps, client, row.id, 'en'), 'INVALID');
  });
});

describe('webhook', () => {
  it('marks a payment paid when the browser never came back, once per event', async () => {
    const { deps, payments, rzp } = setup();
    const c = await order(deps);
    const p = rzp.pay(c.orderId);
    expect(await webhook(deps, 'payment.captured', p, 'evt_1')).toBe('processed');
    expect(await webhook(deps, 'payment.captured', p, 'evt_1')).toBe('duplicate');
    expect(await webhook(deps, 'order.paid', p, 'evt_2')).toBe('processed');
    expect(payments.rows.get(c.paymentId)).toMatchObject({ status: 'paid', provider_payment_id: p.id });
    // The checkout callback arriving later changes nothing.
    expect((await confirmCheckout(deps, { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) })).status).toBe('paid');
  });

  it('verify and webhook at the same time give one paid purchase; two Starts give gap-free report IDs', async () => {
    const { deps, store, payments, rzp } = setup();
    const c = await order(deps);
    const p = rzp.pay(c.orderId);
    await Promise.all([
      confirmCheckout(deps, { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) }),
      webhook(deps, 'payment.captured', p, 'evt_9'),
    ]);
    const c2 = await order(deps);
    const p2 = rzp.pay(c2.orderId);
    await webhook(deps, 'payment.captured', p2, 'evt_10');
    await claimPurchases(deps, client, PHONE);
    await Promise.all([startPurchase(deps, client, c.paymentId, 'en'), startPurchase(deps, client, c.paymentId, 'en')]);
    await startPurchase(deps, client, c2.paymentId, 'en');
    expect([...store.attempts.values()].map((x) => x.report_id).sort()).toEqual(['MFB-IA-2026-00001', 'MFB-IA-2026-00002']);
    expect(store.counter).toBe(2);
    expect([...payments.rows.values()].every((r) => r.attempt_id)).toBe(true);
  });

  it('rejects a bad signature; records failures; ignores unknown orders and mismatches', async () => {
    const { deps, payments, rzp } = setup();
    expect(await handleWebhook(deps, '{"event":"payment.captured"}', 'forged', 'evt_x')).toBe('invalid');
    const c = await order(deps);
    expect(await webhook(deps, 'payment.failed', { id: 'pay_f', order_id: c.orderId }, 'evt_f')).toBe('processed');
    expect(payments.rows.get(c.paymentId)?.status).toBe('failed');
    expect(await webhook(deps, 'payment.captured', { id: 'pay_x', order_id: 'order_unknown' }, 'evt_u')).toBe('ignored');
    const c2 = await order(deps);
    const cheap = rzp.pay(c2.orderId, { amount: 100 });
    expect(await webhook(deps, 'payment.captured', cheap, 'evt_m')).toBe('ignored');
    expect(payments.rows.get(c2.paymentId)?.status).toBe('created');
  });
});

describe('registered number and recovery', () => {
  it('a pay-link order for an already registered number belongs to that client at once', async () => {
    const { deps, payments, rzp } = setup();
    payments.clients.set(PHONE, client);
    const c = await order(deps, '98765 43210');
    expect(payments.rows.get(c.paymentId)).toMatchObject({ client_id: client.id, claimed_at: '2026-10-22T10:00:00.000Z' });
    expect(rzp.lastNotes).toMatchObject({ client_id: client.id, client_name: client.full_name });
    // Once paid it is on Home with Start, without any claim.
    const p = rzp.pay(c.orderId);
    await confirmCheckout(deps, { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) });
    expect((await payments.listReady(client.id)).map((r) => r.id)).toEqual([c.paymentId]);
  });

  it('an unknown number stays unlinked until someone logs in with it', async () => {
    const { deps, payments } = setup();
    payments.clients.set('+919999999999', client);
    const c = await order(deps);
    expect(payments.rows.get(c.paymentId)).toMatchObject({ client_id: null, claimed_at: null });
  });

  it('recovers a payment made at Razorpay that the browser never confirmed, once', async () => {
    const { deps, payments, rzp } = setup();
    const c = await order(deps);
    rzp.pay(c.orderId, { status: 'authorized', captured: false });
    expect(await recoverOpenPayments(deps, PHONE)).toBe(1);
    expect(payments.rows.get(c.paymentId)).toMatchObject({ status: 'paid' });
    expect(rzp.captures).toHaveLength(1);
    expect(await recoverOpenPayments(deps, PHONE)).toBe(0);
    expect(await claimPurchases(deps, client, PHONE)).toBe(1);
  });

  it('leaves an order alone when nothing was paid, or only a failed try', async () => {
    const { deps, payments, rzp } = setup();
    const a = await order(deps);
    const b = await order(deps);
    rzp.pay(b.orderId, { status: 'failed', captured: false });
    expect(await recoverOpenPayments(deps, PHONE)).toBe(0);
    expect(payments.rows.get(a.paymentId)?.status).toBe('created');
    expect(payments.rows.get(b.paymentId)?.status).toBe('created');
  });

  it('does nothing without Razorpay keys or for orders older than 48 hours', async () => {
    const { deps, payments, rzp } = setup();
    const c = await order(deps);
    rzp.pay(c.orderId);
    expect(await recoverOpenPayments(setup(false).deps, PHONE)).toBe(0);
    payments.rows.get(c.paymentId)!.created_at = '2026-10-19T10:00:00.000Z';
    expect(await recoverOpenPayments(deps, PHONE)).toBe(0);
  });
});

describe('Razorpay signatures (real HMAC)', () => {
  const gateway = razorpayGateway({ keyId: 'rzp_test_x', keySecret: 'secret_123', webhookSecret: 'wh_456' });

  it('checkout: HMAC_SHA256(order_id|payment_id, key secret)', () => {
    const sig = createHmac('sha256', 'secret_123').update('order_A|pay_B').digest('hex');
    expect(gateway.verifyCheckoutSignature('order_A', 'pay_B', sig)).toBe(true);
    expect(gateway.verifyCheckoutSignature('order_A', 'pay_C', sig)).toBe(false);
    expect(gateway.verifyCheckoutSignature('order_A', 'pay_B', '')).toBe(false);
  });

  it('webhook: HMAC_SHA256(raw body, webhook secret)', () => {
    const body = '{"event":"payment.captured"}';
    const sig = createHmac('sha256', 'wh_456').update(body).digest('hex');
    expect(gateway.verifyWebhookSignature(body, sig)).toBe(true);
    expect(gateway.verifyWebhookSignature(`${body} `, sig)).toBe(false);
    expect(signatureMatches(body, '', sig)).toBe(false);
  });

  it('keys come from the environment; missing keys mean not configured', () => {
    expect(razorpayConfig({})).toBeNull();
    expect(razorpayConfig({ RAZORPAY_KEY_ID: 'rzp_test_1', RAZORPAY_KEY_SECRET: 's' })).toEqual({ keyId: 'rzp_test_1', keySecret: 's', webhookSecret: '' });
  });
});
