import type { ClientProfile } from '../assessment/types';
import type { RazorpayGateway, RazorpayPayment } from '../payments/razorpay';
import { CURRENCY, PaymentError, type WebhookOutcome } from '../payments/service';
import { PackageStoreError, type PackagePaymentRow, type PackageStore, type SettleResult } from './store';

// The package payment (step 6), with the same safety rules as the assessment payment:
//   1. createPackageCheckout   a signed-in client, for their own offer: the amount comes from the database
//                              (package price − assessment amount paid), the server creates the Razorpay order
//   2. (browser)               Razorpay Checkout collects the payment
//   3. confirmPackageCheckout  the server checks the checkout signature, fetches the payment from Razorpay and
//                              checks order, amount, currency and status (captures it if only authorized)
//   4. settle                  the database marks it paid and makes the Package purchase; a second paid payment
//                              for the same assessment purchase makes no package ("duplicate": refund needed)
//   webhook                    the same for payment.captured / order.paid when the browser never came back, and
//                              payment.failed marks the try failed (the Package call gets a history line)
// The browser never decides the amount or whether a payment succeeded.

/** Razorpay orders a client may create for one offer per hour. */
export const PACKAGE_ORDER_LIMIT = 5;
const LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface PackageDeps {
  packages: PackageStore;
  /** Null when the Razorpay keys are not set. */
  gateway: RazorpayGateway | null;
  newId(): string;
  now(): Date;
}

function gatewayOf(deps: PackageDeps): RazorpayGateway {
  if (!deps.gateway) throw new PaymentError('NOT_CONFIGURED', 'Payments are not set up.');
  return deps.gateway;
}

export interface PackageCheckout {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
}

/** Step 1. The purchase must be one of the client's own open offers. */
export async function createPackageCheckout(deps: PackageDeps, client: ClientProfile, purchaseId: string): Promise<PackageCheckout> {
  const gateway = gatewayOf(deps);
  const offer = (await deps.packages.offers(client.id)).find((o) => o.purchase_id === purchaseId);
  if (!offer) throw new PaymentError('NOT_FOUND', 'This offer is not available.');

  const recent = await deps.packages.countRecent(purchaseId, new Date(deps.now().getTime() - LIMIT_WINDOW_MS).toISOString());
  if (recent >= PACKAGE_ORDER_LIMIT) throw new PaymentError('RATE_LIMITED', 'Too many attempts. Please try again later.');

  const id = deps.newId();
  // Shown under Notes in the Razorpay dashboard. Nothing from the assessment (discretion rule).
  const notes = { package_payment_id: id, client_id: client.id, client_name: client.full_name.slice(0, 256) };
  const order = await gateway.createOrder({ amount: offer.amount_paise, currency: CURRENCY, receipt: id, notes });
  if (order.amount !== offer.amount_paise || order.currency !== CURRENCY) {
    throw new PaymentError('INVALID', 'The order amount does not match.');
  }
  try {
    await deps.packages.start({ id, purchaseId, clientId: client.id, orderId: order.id, amount: order.amount });
  } catch (err) {
    if (err instanceof PackageStoreError) {
      if (err.reason === 'RATE_LIMITED') throw new PaymentError('RATE_LIMITED', 'Too many attempts. Please try again later.');
      throw new PaymentError(err.reason === 'AMOUNT' ? 'INVALID' : 'NOT_FOUND', 'This offer is not available.');
    }
    throw err;
  }
  return { keyId: gateway.keyId, orderId: order.id, amount: order.amount, currency: order.currency };
}

/** Step 3, from the checkout success callback. Only the client who owns the payment may confirm it. */
export async function confirmPackageCheckout(
  deps: PackageDeps,
  client: ClientProfile,
  input: { orderId: string; paymentId: string; signature: string }
): Promise<SettleResult> {
  const gateway = gatewayOf(deps);
  const payment = await deps.packages.getByOrderId(input.orderId);
  // Not found and not yours look the same.
  if (!payment || payment.client_id !== client.id) throw new PaymentError('NOT_FOUND', 'Payment not found.');
  if (!gateway.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
    throw new PaymentError('INVALID', 'The payment could not be verified.');
  }
  return settlePackage(deps, payment, input.paymentId);
}

/** Confirms a gateway payment against our order and settles it. Idempotent. */
async function settlePackage(deps: PackageDeps, payment: PackagePaymentRow, providerPaymentId: string): Promise<SettleResult> {
  if (payment.status === 'paid') return payment.refund_status ? 'duplicate' : 'paid';
  const gateway = gatewayOf(deps);
  let rp: RazorpayPayment = await gateway.fetchPayment(providerPaymentId);
  if (rp.order_id !== payment.provider_order_id || rp.amount !== payment.amount_paise || rp.currency !== payment.currency) {
    throw new PaymentError('INVALID', 'The payment does not match the order.');
  }
  if (rp.status === 'authorized') rp = await gateway.capturePayment(rp.id, payment.amount_paise, payment.currency);
  if (rp.status === 'failed') {
    await deps.packages.markFailed(payment.id, { provider_payment_id: rp.id, code: rp.error_code, reason: rp.error_description });
    throw new PaymentError('FAILED', 'The payment did not go through.');
  }
  if (rp.status !== 'captured') throw new PaymentError('PENDING', 'The payment is not complete yet.');
  return deps.packages.markPaid(payment.id, { provider_payment_id: rp.id, method: rp.method, paid_at: deps.now().toISOString() });
}

/** How far back Home looks for package payments the browser never confirmed. */
const RECOVER_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * The client's package payments still marked "not completed" are checked with Razorpay: one paid there but never
 * confirmed here is settled now. Runs on Home. A failed check is retried on the next visit.
 */
export async function recoverOpenPackagePayments(deps: PackageDeps, client: ClientProfile): Promise<number> {
  if (!deps.gateway) return 0;
  const gateway = deps.gateway;
  const open = await deps.packages.listOpen(client.id, new Date(deps.now().getTime() - RECOVER_WINDOW_MS).toISOString());
  let recovered = 0;
  for (const payment of open) {
    try {
      const tried = await gateway.fetchOrderPayments(payment.provider_order_id);
      const done = tried.find((p) => p.status === 'captured') ?? tried.find((p) => p.status === 'authorized');
      if (!done) continue;
      await settlePackage(deps, payment, done.id);
      recovered += 1;
    } catch (err) {
      console.warn(`Could not recover package payment ${payment.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return recovered;
}

/**
 * The Razorpay webhook for an order that is not an assessment payment (the payments webhook hands it over after
 * checking the signature). Returns 'ignored' when the order is not a package payment either.
 */
export async function handlePackageWebhook(
  deps: PackageDeps,
  event: string,
  entity: { id: string; order_id: string | null; error_code?: string | null; error_description?: string | null }
): Promise<WebhookOutcome> {
  if (!entity.order_id) return 'ignored';
  const payment = await deps.packages.getByOrderId(entity.order_id);
  if (!payment) return 'ignored';
  if (event === 'payment.captured' || event === 'order.paid' || event === 'payment.authorized') {
    try {
      await settlePackage(deps, payment, entity.id);
      return 'processed';
    } catch (err) {
      // Not complete yet: let Razorpay retry. A mismatch or failure will never succeed: log and acknowledge.
      if (!(err instanceof PaymentError) || err.code === 'PENDING' || err.code === 'NOT_CONFIGURED') throw err;
      console.warn(`Package webhook ${event} for order ${entity.order_id}: ${err.code}`);
      return err.code === 'FAILED' ? 'processed' : 'ignored';
    }
  }
  if (event === 'payment.failed') {
    await deps.packages.markFailed(payment.id, {
      provider_payment_id: entity.id,
      code: entity.error_code ?? null,
      reason: entity.error_description ?? null,
    });
    return 'processed';
  }
  return 'ignored';
}
