import { createPaidAttempt, type ServiceDeps } from '../assessment/service';
import { AssessmentError, type ClientProfile } from '../assessment/types';
import type { RazorpayGateway, RazorpayPayment } from './razorpay';
import type { PaymentRow, PaymentStore } from './store';

// Payment flow (Razorpay Standard Checkout):
//   1. createCheckout   server creates a Razorpay order for the fixed price and a payments row
//   2. (browser)        Razorpay Checkout collects the payment
//   3. confirmCheckout  server checks the checkout signature, then fetches the payment from Razorpay
//                       and checks order, amount, currency and status (captures it if only authorized)
//   4. fulfil           payment marked paid, attempt created with its report ID, linked to the payment
//   webhook             payment.captured / order.paid run 3–4 too (client closed the browser), and
//                       payment.failed marks the payment failed. Every step is idempotent.
// The browser never decides the amount or whether a payment succeeded.

/** ₹3,500 per assessment (CLAUDE.md, Products). Shown only on the payment step. */
export const ASSESSMENT_PRICE_PAISE = 350_000;
export const CURRENCY = 'INR';

export function formatPrice(paise: number = ASSESSMENT_PRICE_PAISE): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/** Shown on the Razorpay checkout and in its emails/SMS. Never names the test (discretion rule). */
export const CHECKOUT_NAME = 'My Fit Brain';
export const CHECKOUT_DESCRIPTION = 'MFB Assessment';

export interface PaymentDeps {
  payments: PaymentStore;
  /** Null when the Razorpay keys are not set. */
  gateway: RazorpayGateway | null;
  assessment: ServiceDeps;
  newId(): string;
  now(): Date;
}

export class PaymentError extends Error {
  constructor(
    public readonly code: 'NOT_CONFIGURED' | 'NOT_FOUND' | 'INVALID' | 'PENDING' | 'FAILED',
    message: string
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

function gatewayOf(deps: PaymentDeps): RazorpayGateway {
  if (!deps.gateway) throw new PaymentError('NOT_CONFIGURED', 'Payments are not set up.');
  return deps.gateway;
}

export type Checkout =
  | { kind: 'open'; attemptId: string }
  | { kind: 'order'; keyId: string; orderId: string; amount: number; currency: string; paymentId: string };

/** Step 1. An unfinished assessment of the same test is resumed instead of paid for again. */
export async function createCheckout(deps: PaymentDeps, client: ClientProfile, testCode: string): Promise<Checkout> {
  const gateway = gatewayOf(deps);
  const live = await deps.assessment.store.liveVersionId(testCode);
  if (!live) throw new AssessmentError('NO_LIVE_VERSION', 'This assessment is not available right now.');
  const open = await deps.assessment.store.findOpenAttempt(client.id, testCode);
  if (open) return { kind: 'open', attemptId: open.id };

  const id = deps.newId();
  const order = await gateway.createOrder({
    amount: ASSESSMENT_PRICE_PAISE,
    currency: CURRENCY,
    receipt: id,
    notes: { payment_id: id },
  });
  if (order.amount !== ASSESSMENT_PRICE_PAISE || order.currency !== CURRENCY) {
    throw new PaymentError('INVALID', 'The order amount does not match.');
  }
  await deps.payments.createPayment({
    id,
    client_id: client.id,
    test_code: testCode,
    amount_paise: ASSESSMENT_PRICE_PAISE,
    currency: CURRENCY,
    provider_order_id: order.id,
  });
  return { kind: 'order', keyId: gateway.keyId, orderId: order.id, amount: order.amount, currency: order.currency, paymentId: id };
}

/** Step 3, from the checkout success callback. Returns the new (or existing) attempt. */
export async function confirmCheckout(
  deps: PaymentDeps,
  client: ClientProfile,
  input: { orderId: string; paymentId: string; signature: string }
): Promise<{ attemptId: string }> {
  const gateway = gatewayOf(deps);
  const payment = await deps.payments.getByOrderId(input.orderId);
  if (!payment || payment.client_id !== client.id) throw new PaymentError('NOT_FOUND', 'Payment not found.');
  if (!gateway.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
    throw new PaymentError('INVALID', 'The payment could not be verified.');
  }
  return { attemptId: await settle(deps, payment, input.paymentId) };
}

/** Confirms a gateway payment against our order and fulfils it. Idempotent. */
async function settle(deps: PaymentDeps, payment: PaymentRow, providerPaymentId: string): Promise<string> {
  if (payment.attempt_id) return payment.attempt_id;
  const gateway = gatewayOf(deps);
  let rp = await gateway.fetchPayment(providerPaymentId);
  if (rp.order_id !== payment.provider_order_id || rp.amount !== payment.amount_paise || rp.currency !== payment.currency) {
    throw new PaymentError('INVALID', 'The payment does not match the order.');
  }
  if (rp.status === 'authorized') rp = await gateway.capturePayment(rp.id, payment.amount_paise, payment.currency);
  if (rp.status === 'failed') {
    await deps.payments.markFailed(payment.id, { provider_payment_id: rp.id, code: rp.error_code, reason: rp.error_description });
    throw new PaymentError('FAILED', 'The payment did not go through.');
  }
  if (rp.status !== 'captured') throw new PaymentError('PENDING', 'The payment is not complete yet.');
  return fulfil(deps, payment, rp);
}

async function fulfil(deps: PaymentDeps, payment: PaymentRow, rp: RazorpayPayment): Promise<string> {
  const paid = await deps.payments.markPaid(payment.id, {
    provider_payment_id: rp.id,
    method: rp.method,
    paid_at: deps.now().toISOString(),
  });
  if (paid.attempt_id) return paid.attempt_id;

  // Verify and webhook may arrive together: createPaidAttempt returns the same attempt to both and
  // takes one report number.
  let attempt = await deps.assessment.store.findAttemptByPaymentRef(rp.id);
  if (!attempt) {
    const client = await deps.payments.clientProfile(payment.client_id);
    if (!client) throw new PaymentError('NOT_FOUND', 'Client not found.');
    attempt = await createPaidAttempt(deps.assessment, client, payment.test_code, {
      ref: rp.id,
      paidAt: paid.paid_at ?? deps.now().toISOString(),
    });
  }
  await deps.payments.linkAttempt(payment.id, attempt.id);
  return attempt.id;
}

interface WebhookPaymentEntity {
  id: string;
  order_id: string | null;
  error_code?: string | null;
  error_description?: string | null;
}

export type WebhookOutcome = 'invalid' | 'duplicate' | 'ignored' | 'processed';

/** Razorpay webhook. Subscribe to payment.captured, order.paid and payment.failed. */
export async function handleWebhook(
  deps: PaymentDeps,
  rawBody: string,
  signature: string,
  eventId: string | null
): Promise<WebhookOutcome> {
  const gateway = gatewayOf(deps);
  if (!gateway.verifyWebhookSignature(rawBody, signature)) return 'invalid';
  if (eventId && (await deps.payments.hasEvent(eventId))) return 'duplicate';

  let body: { event?: string; payload?: { payment?: { entity?: WebhookPaymentEntity } } };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return 'invalid';
  }
  const event = body.event ?? '';
  const entity = body.payload?.payment?.entity;
  let outcome: WebhookOutcome = 'ignored';

  if (entity?.order_id) {
    const payment = await deps.payments.getByOrderId(entity.order_id);
    if (payment) {
      if (event === 'payment.captured' || event === 'order.paid' || event === 'payment.authorized') {
        try {
          await settle(deps, payment, entity.id);
          outcome = 'processed';
        } catch (err) {
          // Not complete yet: let Razorpay retry. A mismatch or failure will never succeed: log it
          // and acknowledge, so the webhook is not disabled by endless retries.
          if (!(err instanceof PaymentError) || err.code === 'PENDING' || err.code === 'NOT_CONFIGURED') throw err;
          console.warn(`Payment webhook ${event} for order ${entity.order_id}: ${err.code}`);
          outcome = err.code === 'FAILED' ? 'processed' : 'ignored';
        }
      } else if (event === 'payment.failed') {
        await deps.payments.markFailed(payment.id, {
          provider_payment_id: entity.id,
          code: entity.error_code ?? null,
          reason: entity.error_description ?? null,
        });
        outcome = 'processed';
      }
    }
  }

  // Recorded only after it worked, so a failed delivery is processed again on Razorpay's retry.
  if (eventId) {
    await deps.payments.recordEvent({
      provider_event_id: eventId,
      event,
      provider_order_id: entity?.order_id ?? null,
      provider_payment_id: entity?.id ?? null,
    });
  }
  return outcome;
}
