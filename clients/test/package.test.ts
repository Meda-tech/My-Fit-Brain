import { describe, expect, it } from 'vitest';
import type { ClientProfile } from '../lib/assessment/types';
import { PaymentError } from '../lib/payments/service';
import {
  PACKAGE_ORDER_LIMIT,
  confirmPackageCheckout,
  createPackageCheckout,
  handlePackageWebhook,
  recoverOpenPackagePayments,
  type PackageDeps,
} from '../lib/package/service';
import { PackageStoreError, type PackageOffer, type PackagePaymentRow, type PackageStore, type SettleResult } from '../lib/package/store';
import { FakeRazorpay } from './memory-payments';

// The package payment with a fake Razorpay and an in-memory store that keeps the database's rules: the amount
// comes from the offer (never from the caller), only the owner pays and confirms, every step is idempotent, and a
// second paid payment for the same assessment purchase makes no second package ("duplicate").

const asha: ClientProfile = { id: 'client-1', full_name: 'Asha Verma' };
const other: ClientProfile = { id: 'client-2', full_name: 'Someone Else' };
const OFFER: PackageOffer = {
  purchase_id: 'purchase-1',
  package_id: 'pkg-1',
  name: 'Counselling package',
  sessions: 8,
  frequency: '1 session every week',
  price_paise: 3_500_000,
  advance_paise: 350_000,
  amount_paise: 3_150_000,
};

class MemoryPackages implements PackageStore {
  /** Offers by client id. */
  offersOf = new Map<string, PackageOffer[]>([[asha.id, [OFFER]]]);
  rows = new Map<string, PackagePaymentRow & { failed_code?: string | null }>();
  packagesPaid = new Set<string>();
  createdAt = '2026-11-21T10:00:00.000Z';

  async offers(clientId: string) {
    return (this.offersOf.get(clientId) ?? []).filter((o) => !this.packagesPaid.has(o.purchase_id));
  }
  async countRecent(purchaseId: string, since: string) {
    return [...this.rows.values()].filter((r) => r.purchase_id === purchaseId && r.created_at >= since).length;
  }
  async start(row: { id: string; purchaseId: string; clientId: string; orderId: string; amount: number }) {
    const offer = (await this.offers(row.clientId)).find((o) => o.purchase_id === row.purchaseId);
    if (!offer) throw new PackageStoreError('NOT_AVAILABLE');
    if (offer.amount_paise !== row.amount) throw new PackageStoreError('AMOUNT');
    this.rows.set(row.id, {
      id: row.id,
      purchase_id: row.purchaseId,
      client_id: row.clientId,
      amount_paise: row.amount,
      currency: 'INR',
      status: 'created',
      provider_order_id: row.orderId,
      provider_payment_id: null,
      refund_status: null,
      created_at: this.createdAt,
    });
  }
  async getByOrderId(orderId: string) {
    const r = [...this.rows.values()].find((x) => x.provider_order_id === orderId);
    return r ? { ...r } : null;
  }
  async markPaid(id: string, paid: { provider_payment_id: string }): Promise<SettleResult> {
    const r = this.rows.get(id)!;
    if (r.status !== 'paid') {
      Object.assign(r, { status: 'paid', provider_payment_id: paid.provider_payment_id });
      if (this.packagesPaid.has(r.purchase_id)) r.refund_status = 'needed';
      else this.packagesPaid.add(r.purchase_id);
    }
    return r.refund_status ? 'duplicate' : 'paid';
  }
  async markFailed(id: string, f: { provider_payment_id: string | null; code: string | null }) {
    const r = this.rows.get(id)!;
    if (r.status === 'created') Object.assign(r, { status: 'failed', provider_payment_id: f.provider_payment_id, failed_code: f.code });
  }
  async listOpen(clientId: string, since: string) {
    return [...this.rows.values()].filter((r) => r.client_id === clientId && r.status === 'created' && r.created_at >= since).map((r) => ({ ...r }));
  }
  async paid() {
    return [];
  }
}

function setup(configured = true) {
  const packages = new MemoryPackages();
  const rzp = new FakeRazorpay();
  let ids = 0;
  const deps: PackageDeps = {
    packages,
    gateway: configured ? rzp : null,
    newId: () => `pp-${++ids}`,
    now: () => new Date('2026-11-21T10:05:00.000Z'),
  };
  return { deps, packages, rzp };
}

async function expectError(p: Promise<unknown>, code: PaymentError['code']) {
  await expect(p).rejects.toMatchObject({ name: 'PaymentError', code });
}

const sign = FakeRazorpay.sign;

describe('package checkout', () => {
  it('creates the order for the offer amount (₹31,500), never an amount from the caller', async () => {
    const { deps, rzp, packages } = setup();
    const c = await createPackageCheckout(deps, asha, 'purchase-1');
    expect(c.amount).toBe(3_150_000);
    expect(rzp.orders.get(c.orderId)?.amount).toBe(3_150_000);
    expect([...packages.rows.values()][0]).toMatchObject({ status: 'created', amount_paise: 3_150_000, client_id: asha.id });
    // Notes for the Razorpay dashboard carry nothing about the assessment.
    expect(Object.keys(rzp.lastNotes).sort()).toEqual(['client_id', 'client_name', 'package_payment_id']);
  });

  it('only for the client’s own open offer; not when payments are not set up', async () => {
    const { deps } = setup();
    await expectError(createPackageCheckout(deps, other, 'purchase-1'), 'NOT_FOUND');
    await expectError(createPackageCheckout(deps, asha, 'purchase-9'), 'NOT_FOUND');
    await expectError(createPackageCheckout(setup(false).deps, asha, 'purchase-1'), 'NOT_CONFIGURED');
  });

  it(`allows ${PACKAGE_ORDER_LIMIT} orders an hour per offer`, async () => {
    const { deps } = setup();
    for (let i = 0; i < PACKAGE_ORDER_LIMIT; i++) await createPackageCheckout(deps, asha, 'purchase-1');
    await expectError(createPackageCheckout(deps, asha, 'purchase-1'), 'RATE_LIMITED');
  });
});

describe('package payment confirmation', () => {
  it('paid: signature checked, payment fetched and matched, then settled once', async () => {
    const { deps, rzp, packages } = setup();
    const c = await createPackageCheckout(deps, asha, 'purchase-1');
    const p = rzp.pay(c.orderId);
    const input = { orderId: c.orderId, paymentId: p.id, signature: sign(c.orderId, p.id) };
    expect(await confirmPackageCheckout(deps, asha, input)).toBe('paid');
    expect(await confirmPackageCheckout(deps, asha, input)).toBe('paid');
    expect(packages.packagesPaid.has('purchase-1')).toBe(true);
    // The offer is gone once paid.
    await expectError(createPackageCheckout(deps, asha, 'purchase-1'), 'NOT_FOUND');
  });

  it('rejects a forged signature, someone else’s payment, and a payment that does not match the order', async () => {
    const { deps, rzp } = setup();
    const c = await createPackageCheckout(deps, asha, 'purchase-1');
    const p = rzp.pay(c.orderId);
    await expectError(confirmPackageCheckout(deps, asha, { orderId: c.orderId, paymentId: p.id, signature: 'forged' }), 'INVALID');
    await expectError(confirmPackageCheckout(deps, other, { orderId: c.orderId, paymentId: p.id, signature: sign(c.orderId, p.id) }), 'NOT_FOUND');
    const cheap = rzp.pay(c.orderId, { amount: 100 });
    await expectError(confirmPackageCheckout(deps, asha, { orderId: c.orderId, paymentId: cheap.id, signature: sign(c.orderId, cheap.id) }), 'INVALID');
  });

  it('a failed payment marks the try failed; an authorized one is captured; a pending one waits', async () => {
    const { deps, rzp, packages } = setup();
    const c1 = await createPackageCheckout(deps, asha, 'purchase-1');
    const failed = rzp.pay(c1.orderId, { status: 'failed', captured: false, error_code: 'BAD_REQUEST_ERROR' });
    await expectError(confirmPackageCheckout(deps, asha, { orderId: c1.orderId, paymentId: failed.id, signature: sign(c1.orderId, failed.id) }), 'FAILED');
    expect([...packages.rows.values()][0].status).toBe('failed');

    const c2 = await createPackageCheckout(deps, asha, 'purchase-1');
    const pending = rzp.pay(c2.orderId, { status: 'created', captured: false });
    await expectError(confirmPackageCheckout(deps, asha, { orderId: c2.orderId, paymentId: pending.id, signature: sign(c2.orderId, pending.id) }), 'PENDING');
    const authorized = rzp.pay(c2.orderId, { status: 'authorized', captured: false });
    expect(await confirmPackageCheckout(deps, asha, { orderId: c2.orderId, paymentId: authorized.id, signature: sign(c2.orderId, authorized.id) })).toBe('paid');
    expect(rzp.captures).toContain(authorized.id);
  });

  it('paid twice (two orders of the same offer): the second makes no package and is "duplicate"', async () => {
    const { deps, rzp, packages } = setup();
    const c1 = await createPackageCheckout(deps, asha, 'purchase-1');
    const c2 = await createPackageCheckout(deps, asha, 'purchase-1');
    const p1 = rzp.pay(c1.orderId);
    const p2 = rzp.pay(c2.orderId);
    expect(await confirmPackageCheckout(deps, asha, { orderId: c1.orderId, paymentId: p1.id, signature: sign(c1.orderId, p1.id) })).toBe('paid');
    expect(await confirmPackageCheckout(deps, asha, { orderId: c2.orderId, paymentId: p2.id, signature: sign(c2.orderId, p2.id) })).toBe('duplicate');
    expect([...packages.rows.values()].map((r) => r.refund_status)).toEqual([null, 'needed']);
  });
});

describe('package webhook and recovery', () => {
  it('payment.captured settles; payment.failed marks failed; other orders are ignored', async () => {
    const { deps, rzp, packages } = setup();
    const c1 = await createPackageCheckout(deps, asha, 'purchase-1');
    const bad = rzp.pay(c1.orderId, { status: 'failed', captured: false });
    expect(await handlePackageWebhook(deps, 'payment.failed', { id: bad.id, order_id: c1.orderId, error_code: 'X' })).toBe('processed');
    expect([...packages.rows.values()][0].status).toBe('failed');

    const c2 = await createPackageCheckout(deps, asha, 'purchase-1');
    const ok = rzp.pay(c2.orderId);
    expect(await handlePackageWebhook(deps, 'payment.captured', { id: ok.id, order_id: c2.orderId })).toBe('processed');
    expect(packages.packagesPaid.has('purchase-1')).toBe(true);
    expect(await handlePackageWebhook(deps, 'payment.captured', { id: 'pay_x', order_id: 'order_unknown' })).toBe('ignored');
  });

  it('Home recovers a payment made at Razorpay that the browser never confirmed', async () => {
    const { deps, rzp, packages } = setup();
    const c = await createPackageCheckout(deps, asha, 'purchase-1');
    rzp.pay(c.orderId);
    expect(await recoverOpenPackagePayments(deps, asha)).toBe(1);
    expect(packages.packagesPaid.has('purchase-1')).toBe(true);
    expect(await recoverOpenPackagePayments(deps, asha)).toBe(0);
  });
});
