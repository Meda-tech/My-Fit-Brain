import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VersionConfig } from '@mfb/questionbank';
import { loadOfflineBanks } from '@mfb/questionbank/offline';
import type { ServiceDeps } from '../lib/assessment/service';
import type { ClientProfile } from '../lib/assessment/types';
import { razorpayConfig, razorpayGateway, signatureMatches } from '../lib/payments/razorpay';
import {
  ASSESSMENT_PRICE_PAISE,
  confirmCheckout,
  createCheckout,
  formatPrice,
  handleWebhook,
  PaymentError,
  type PaymentDeps,
} from '../lib/payments/service';
import { FakeRazorpay, MemoryPayments } from './memory-payments';
import { MemoryStore } from './memory-store';

// The payment flow with a fake Razorpay and in-memory stores: the server decides the amount and the
// outcome, every step is idempotent, and one payment gives exactly one assessment.

let config: VersionConfig;
beforeAll(async () => {
  const banks = await loadOfflineBanks();
  config = { ...banks.IA.versions['1.2'].config, version: { ...banks.IA.versions['1.2'].config.version, id: 'version-IA-1.2' } };
});

const client: ClientProfile = { id: 'client-1', gender: 'Female', age: 30, marital_status: 'Married' };

function setup(configured = true) {
  const store = new MemoryStore();
  store.live = { IA: 'version-IA-1.2' };
  const payments = new MemoryPayments();
  payments.clients.set(client.id, client);
  const rzp = new FakeRazorpay();
  let ids = 0;
  const assessment: ServiceDeps = { store, loadConfig: async () => config, now: () => new Date('2026-10-18T10:00:00.000Z') };
  const deps: PaymentDeps = {
    payments,
    gateway: configured ? rzp : null,
    assessment,
    newId: () => `payment-${++ids}`,
    now: () => new Date('2026-10-18T10:00:00.000Z'),
  };
  return { deps, store, payments, rzp };
}

async function order(deps: PaymentDeps) {
  const c = await createCheckout(deps, client, 'IA');
  if (c.kind !== 'order') throw new Error('expected an order');
  return c;
}

async function expectPaymentError(p: Promise<unknown>, code: PaymentError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof PaymentError && e.code === code);
}

function webhook(deps: PaymentDeps, event: string, payment: { id: string; order_id: string | null }, eventId: string | null = null) {
  const raw = JSON.stringify({ event, payload: { payment: { entity: payment } } });
  return handleWebhook(deps, raw, `whsig:${raw.length}`, eventId);
}

describe('checkout', () => {
  it('creates an order for ₹3,500 decided by the server, and a payments row', async () => {
    const { deps, payments, rzp } = setup();
    const c = await order(deps);
    expect([c.amount, c.currency, c.keyId]).toEqual([350_000, 'INR', 'rzp_test_key']);
    expect(rzp.orders.get(c.orderId)?.receipt).toBe(c.paymentId);
    expect(payments.rows.get(c.paymentId)).toMatchObject({ status: 'created', amount_paise: ASSESSMENT_PRICE_PAISE, client_id: client.id });
    expect(formatPrice()).toBe('₹3,500');
  });

  it('is refused when Razorpay is not configured', async () => {
    const { deps } = setup(false);
    await expectPaymentError(createCheckout(deps, client, 'IA'), 'NOT_CONFIGURED');
  });

  it('an unfinished assessment of the same test is continued, not paid again', async () => {
    const { deps, rzp } = setup();
    const c = await order(deps);
    const p = rzp.pay(c.orderId);
    const { attemptId } = await confirmCheckout(deps, client, { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) });
    expect(await createCheckout(deps, client, 'IA')).toEqual({ kind: 'open', attemptId });
  });
});

describe('verification', () => {
  it('a verified payment creates one live attempt with a report ID, linked to the payment', async () => {
    const { deps, store, payments, rzp } = setup();
    const c = await order(deps);
    const p = rzp.pay(c.orderId);
    const input = { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) };
    const { attemptId } = await confirmCheckout(deps, client, input);
    const attempt = store.attempts.get(attemptId)!;
    expect([attempt.status, attempt.payment_mode, attempt.payment_ref, attempt.report_id]).toEqual(['paid', 'live', p.id, 'MFB-IA-2026-00001']);
    expect(payments.rows.get(c.paymentId)).toMatchObject({ status: 'paid', provider_payment_id: p.id, method: 'upi', attempt_id: attemptId });
    // Again (double tap, retry): same attempt, nothing new.
    expect((await confirmCheckout(deps, client, input)).attemptId).toBe(attemptId);
    expect(store.attempts.size).toBe(1);
  });

  it('rejects a bad signature, another client, and a payment that does not match the order', async () => {
    const { deps, store, rzp } = setup();
    const c = await order(deps);
    const p = rzp.pay(c.orderId);
    await expectPaymentError(confirmCheckout(deps, client, { orderId: c.orderId, paymentId: p.id, signature: 'forged' }), 'INVALID');
    await expectPaymentError(
      confirmCheckout(deps, { ...client, id: 'client-2' }, { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) }),
      'NOT_FOUND'
    );
    const cheap = rzp.pay(c.orderId, { amount: 100 });
    await expectPaymentError(
      confirmCheckout(deps, client, { orderId: c.orderId, paymentId: cheap.id, signature: FakeRazorpay.sign(c.orderId, cheap.id) }),
      'INVALID'
    );
    expect(store.attempts.size).toBe(0);
  });

  it('captures an authorized payment; a failed one is marked failed; a pending one waits', async () => {
    const { deps, payments, rzp } = setup();
    const c = await order(deps);
    const failed = rzp.pay(c.orderId, { status: 'failed', error_code: 'BAD_REQUEST_ERROR', error_description: 'Payment declined' });
    await expectPaymentError(
      confirmCheckout(deps, client, { orderId: c.orderId, paymentId: failed.id, signature: FakeRazorpay.sign(c.orderId, failed.id) }),
      'FAILED'
    );
    expect(payments.rows.get(c.paymentId)?.status).toBe('failed');

    const pending = rzp.pay(c.orderId, { status: 'created' });
    await expectPaymentError(
      confirmCheckout(deps, client, { orderId: c.orderId, paymentId: pending.id, signature: FakeRazorpay.sign(c.orderId, pending.id) }),
      'PENDING'
    );

    // The client retries in the same checkout and it is authorized: the server captures it.
    const ok = rzp.pay(c.orderId, { status: 'authorized', captured: false });
    await confirmCheckout(deps, client, { orderId: c.orderId, paymentId: ok.id, signature: FakeRazorpay.sign(c.orderId, ok.id) });
    expect(rzp.captures).toEqual([ok.id]);
    expect(payments.rows.get(c.paymentId)).toMatchObject({ status: 'paid', provider_payment_id: ok.id });
  });
});

describe('webhook', () => {
  it('fulfils a payment when the browser never came back, once per event', async () => {
    const { deps, store, rzp } = setup();
    const c = await order(deps);
    const p = rzp.pay(c.orderId);
    expect(await webhook(deps, 'payment.captured', p, 'evt_1')).toBe('processed');
    expect(await webhook(deps, 'payment.captured', p, 'evt_1')).toBe('duplicate');
    expect(await webhook(deps, 'order.paid', p, 'evt_2')).toBe('processed');
    expect(store.attempts.size).toBe(1);
    // The browser's verify arriving later gets the same attempt.
    const { attemptId } = await confirmCheckout(deps, client, { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) });
    expect([...store.attempts.keys()]).toEqual([attemptId]);
  });

  it('verify and webhook at the same time give one attempt and no report ID gap', async () => {
    const { deps, store, payments, rzp } = setup();
    const c = await order(deps);
    const p = rzp.pay(c.orderId);
    await Promise.all([
      confirmCheckout(deps, client, { orderId: c.orderId, paymentId: p.id, signature: FakeRazorpay.sign(c.orderId, p.id) }),
      webhook(deps, 'payment.captured', p, 'evt_9'),
    ]);
    expect(store.attempts.size).toBe(1);
    // The race used up no report number: the next payment is 00002.
    expect([...store.attempts.values()][0].report_id).toBe('MFB-IA-2026-00001');
    const other: ClientProfile = { ...client, id: 'client-2' };
    payments.clients.set(other.id, other);
    const c2 = await createCheckout(deps, other, 'IA');
    if (c2.kind !== 'order') throw new Error('expected an order');
    const p2 = rzp.pay(c2.orderId);
    await webhook(deps, 'payment.captured', p2, 'evt_10');
    expect([...store.attempts.values()].map((x) => x.report_id).sort()).toEqual(['MFB-IA-2026-00001', 'MFB-IA-2026-00002']);
    expect(store.counter).toBe(2);
  });

  it('rejects a bad signature; records failures; ignores unknown orders and mismatches', async () => {
    const { deps, payments, store, rzp } = setup();
    expect(await handleWebhook(deps, '{"event":"payment.captured"}', 'forged', 'evt_x')).toBe('invalid');
    const c = await order(deps);
    expect(await webhook(deps, 'payment.failed', { id: 'pay_f', order_id: c.orderId }, 'evt_f')).toBe('processed');
    expect(payments.rows.get(c.paymentId)?.status).toBe('failed');
    expect(await webhook(deps, 'payment.captured', { id: 'pay_x', order_id: 'order_unknown' }, 'evt_u')).toBe('ignored');
    const cheap = rzp.pay(c.orderId, { amount: 100 });
    expect(await webhook(deps, 'payment.captured', cheap, 'evt_m')).toBe('ignored');
    expect(store.attempts.size).toBe(0);
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
    expect(signatureMatches(body, '', sig)).toBe(false); // no webhook secret configured: never valid
  });

  it('keys come from the environment; missing keys mean not configured', () => {
    expect(razorpayConfig({})).toBeNull();
    expect(razorpayConfig({ RAZORPAY_KEY_ID: 'rzp_test_1', RAZORPAY_KEY_SECRET: 's' })).toEqual({ keyId: 'rzp_test_1', keySecret: 's', webhookSecret: '' });
  });
});
