import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Razorpay REST API (https://razorpay.com/docs/api/) and signature checks. Test and live mode differ
// only by the keys in the environment; the code is the same. Secrets never leave the server.

const API = 'https://api.razorpay.com/v1';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/** Keys from the environment, or null when payments are not configured (the payment page says so). */
export function razorpayConfig(env: Record<string, string | undefined> = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '';
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, webhookSecret };
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  method: string | null;
  captured: boolean;
  error_code: string | null;
  error_description: string | null;
}

/** The calls the payment service needs (a fake replaces it in tests). */
export interface RazorpayGateway {
  keyId: string;
  createOrder(input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<RazorpayOrder>;
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
  /** Every payment tried on an order (to recover one the browser never confirmed). */
  fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]>;
  capturePayment(paymentId: string, amount: number, currency: string): Promise<RazorpayPayment>;
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'RazorpayError';
  }
}

/** HMAC-SHA256 hex digest, compared in constant time. */
export function signatureMatches(payload: string, secret: string, signature: string): boolean {
  if (!secret || !signature) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'), 'utf8');
  const given = Buffer.from(signature.trim(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function razorpayGateway(config: RazorpayConfig): RazorpayGateway {
  const auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
    if (!res.ok) throw new RazorpayError(data.error?.description ?? `Razorpay request failed (${res.status})`, res.status);
    return data;
  }

  return {
    keyId: config.keyId,
    createOrder: (input) => call<RazorpayOrder>('POST', '/orders', input),
    fetchPayment: (id) => call<RazorpayPayment>('GET', `/payments/${encodeURIComponent(id)}`),
    fetchOrderPayments: async (orderId) =>
      (await call<{ items?: RazorpayPayment[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`)).items ?? [],
    capturePayment: (id, amount, currency) =>
      call<RazorpayPayment>('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount, currency }),
    // Razorpay checkout signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret).
    verifyCheckoutSignature: (orderId, paymentId, signature) =>
      signatureMatches(`${orderId}|${paymentId}`, config.keySecret, signature),
    // Webhook signature = HMAC_SHA256(raw request body, webhook secret).
    verifyWebhookSignature: (rawBody, signature) => signatureMatches(rawBody, config.webhookSecret, signature),
  };
}
