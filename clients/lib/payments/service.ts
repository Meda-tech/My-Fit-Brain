import type { Lang } from '@mfb/questionnaire';
import { createPaidAttempt, type ServiceDeps } from '../assessment/service';
import { AssessmentError, type ClientProfile } from '../assessment/types';
import { normalizePhoneNumber } from '../phone';
import type { RazorpayGateway, RazorpayPayment } from './razorpay';
import type { PaymentRow, PaymentStore } from './store';

// Pay first, log in later (Razorpay Standard Checkout):
//   1. createCheckout   anyone with a phone number: the server creates a Razorpay order for the fixed
//                       price and a payments row owned by that phone (rate-limited per phone and IP)
//   2. (browser)        Razorpay Checkout collects the payment
//   3. confirmCheckout  server checks the checkout signature, then fetches the payment from Razorpay
//                       and checks order, amount, currency and status (captures it if only authorized)
//   4. settle           the purchase is marked paid; nothing else happens yet
//   webhook             payment.captured / order.paid run 3–4 too (the browser never came back), and
//                       payment.failed marks the payment failed. Every step is idempotent.
//   claimPurchases      after OTP login: paid, unclaimed purchases of the verified phone → the client
//   startPurchase       the client presses Start: the attempt (and its report ID) is created
// The browser never decides the amount or whether a payment succeeded.

/** ₹3,500 per assessment (CLAUDE.md, Products). Shown on the payment step and the public /pricing page. */
export const ASSESSMENT_PRICE_PAISE = 350_000;
export const CURRENCY = 'INR';

export function formatPrice(paise: number = ASSESSMENT_PRICE_PAISE): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/** Shown on the Razorpay checkout and in its emails/SMS. Never names the test (discretion rule). */
export const CHECKOUT_NAME = 'My Fit Brain';
export const CHECKOUT_DESCRIPTION = 'MFB Assessment';

/** Orders allowed per hour, per phone number and per IP address. */
export const ORDER_LIMIT_PER_PHONE = 5;
export const ORDER_LIMIT_PER_IP = 20;
const LIMIT_WINDOW_MS = 60 * 60 * 1000;

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
    public readonly code: 'NOT_CONFIGURED' | 'NOT_FOUND' | 'INVALID' | 'BAD_PHONE' | 'RATE_LIMITED' | 'PENDING' | 'FAILED',
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
  | { kind: 'owned' }
  | { kind: 'order'; keyId: string; orderId: string; amount: number; currency: string; paymentId: string; phone: string };

export interface CheckoutInput {
  /** Questionnaire code (resolved from the pay link's neutral code). */
  code: string;
  /** As typed; for a signed-in client, their verified phone. */
  phone: string;
  /** The signed-in, registered client buying for their own number, or null. */
  client: ClientProfile | null;
  ipHash: string | null;
}

/** Step 1. A signed-in client who already holds this test (paid or unfinished) is sent Home instead. */
export async function createCheckout(deps: PaymentDeps, input: CheckoutInput): Promise<Checkout> {
  const gateway = gatewayOf(deps);
  const phone = normalizePhoneNumber(input.phone);
  if (!phone.valid) throw new PaymentError('BAD_PHONE', 'The mobile number is not valid.');
  const live = await deps.assessment.store.liveVersion(input.code);
  if (!live) throw new AssessmentError('NO_LIVE_VERSION', 'This assessment is not available right now.');

  if (input.client) {
    const [open, ready] = await Promise.all([
      deps.assessment.store.findOpenAttempt(input.client.id, input.code),
      deps.payments.listReady(input.client.id),
    ]);
    if (open || ready.some((p) => p.test_code === input.code)) return { kind: 'owned' };
  }

  const now = deps.now();
  const recent = await deps.payments.countRecent(phone.normalized, input.ipHash, new Date(now.getTime() - LIMIT_WINDOW_MS).toISOString());
  if (recent.phone >= ORDER_LIMIT_PER_PHONE || recent.ip >= ORDER_LIMIT_PER_IP) {
    throw new PaymentError('RATE_LIMITED', 'Too many attempts. Please try again later.');
  }

  const id = deps.newId();
  // Shown under Notes in the Razorpay dashboard. Never the test name or anything from the assessment
  // (discretion rule).
  const notes: Record<string, string> = { payment_id: id, phone: phone.normalized };
  if (input.client) {
    notes.client_id = input.client.id;
    notes.client_name = input.client.full_name.slice(0, 256);
  }
  const order = await gateway.createOrder({ amount: ASSESSMENT_PRICE_PAISE, currency: CURRENCY, receipt: id, notes });
  if (order.amount !== ASSESSMENT_PRICE_PAISE || order.currency !== CURRENCY) {
    throw new PaymentError('INVALID', 'The order amount does not match.');
  }
  await deps.payments.createPayment({
    id,
    phone: phone.normalized,
    client_id: input.client?.id ?? null,
    claimed_at: input.client ? now.toISOString() : null,
    test_code: input.code,
    amount_paise: ASSESSMENT_PRICE_PAISE,
    currency: CURRENCY,
    provider_order_id: order.id,
    ip_hash: input.ipHash,
  });
  return {
    kind: 'order',
    keyId: gateway.keyId,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    paymentId: id,
    phone: phone.normalized,
  };
}

/** Step 3, from the checkout success callback (no sign-in needed). Returns the paid purchase. */
export async function confirmCheckout(
  deps: PaymentDeps,
  input: { orderId: string; paymentId: string; signature: string }
): Promise<PaymentRow> {
  const gateway = gatewayOf(deps);
  const payment = await deps.payments.getByOrderId(input.orderId);
  if (!payment) throw new PaymentError('NOT_FOUND', 'Payment not found.');
  if (!gateway.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
    throw new PaymentError('INVALID', 'The payment could not be verified.');
  }
  return settle(deps, payment, input.paymentId);
}

/** Confirms a gateway payment against our order and marks it paid. Idempotent. */
async function settle(deps: PaymentDeps, payment: PaymentRow, providerPaymentId: string): Promise<PaymentRow> {
  if (payment.status === 'paid') return payment;
  const gateway = gatewayOf(deps);
  let rp: RazorpayPayment = await gateway.fetchPayment(providerPaymentId);
  if (rp.order_id !== payment.provider_order_id || rp.amount !== payment.amount_paise || rp.currency !== payment.currency) {
    throw new PaymentError('INVALID', 'The payment does not match the order.');
  }
  if (rp.status === 'authorized') rp = await gateway.capturePayment(rp.id, payment.amount_paise, payment.currency);
  if (rp.status === 'failed') {
    await deps.payments.markFailed(payment.id, { provider_payment_id: rp.id, code: rp.error_code, reason: rp.error_description });
    throw new PaymentError('FAILED', 'The payment did not go through.');
  }
  if (rp.status !== 'captured') throw new PaymentError('PENDING', 'The payment is not complete yet.');
  return deps.payments.markPaid(payment.id, { provider_payment_id: rp.id, method: rp.method, paid_at: deps.now().toISOString() });
}

/**
 * Links every paid, unclaimed purchase of the client's verified phone to the client. Runs on Home, so
 * a purchase paid before login, or confirmed later by the webhook, shows up on the next visit.
 */
export async function claimPurchases(deps: PaymentDeps, client: ClientProfile, verifiedPhone: string): Promise<number> {
  const phone = normalizePhoneNumber(verifiedPhone);
  if (!phone.valid) return 0;
  return deps.payments.claim(phone.normalized, client.id, deps.now().toISOString());
}

/** Under 18 at registration: the phone's paid purchases are flagged for a refund (nothing else is saved). */
export async function flagRefundForPhone(deps: PaymentDeps, verifiedPhone: string): Promise<number> {
  const phone = normalizePhoneNumber(verifiedPhone);
  if (!phone.valid) return 0;
  return deps.payments.markRefundNeeded(phone.normalized);
}

/**
 * The client presses Start on a purchase: the attempt is created, pinned to the live version, with its
 * report ID, and linked to the purchase. Pressing again returns the same attempt.
 */
export async function startPurchase(deps: PaymentDeps, client: ClientProfile, paymentId: string, language: Lang): Promise<string> {
  const payment = await deps.payments.getById(paymentId);
  // Not found and not yours look the same.
  if (!payment || payment.client_id !== client.id) throw new PaymentError('NOT_FOUND', 'Purchase not found.');
  if (payment.attempt_id) return payment.attempt_id;
  if (payment.status !== 'paid' || !payment.provider_payment_id || !payment.paid_at || payment.refund_status) {
    throw new PaymentError('INVALID', 'This purchase cannot be started.');
  }
  const attempt = await createPaidAttempt(
    deps.assessment,
    client,
    payment.test_code,
    { ref: payment.provider_payment_id, paidAt: payment.paid_at },
    language
  );
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
