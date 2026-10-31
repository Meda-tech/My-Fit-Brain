import 'server-only';
import { createHmac, randomUUID } from 'node:crypto';
import type { Text } from '@mfb/questionnaire';
import { getAuthUser, getCurrentClient } from '../auth';
import { serviceDeps } from '../assessment/server';
import type { ClientProfile } from '../assessment/types';
import { normalizePhoneNumber } from '../phone';
import { createAdminClient } from '../supabase/admin';
import { razorpayConfig, razorpayGateway } from './razorpay';
import { formatPrice, type PaymentDeps } from './service';
import { supabasePaymentStore } from './store';

// Server wiring for payments: Razorpay keys from the environment, stores on the service role.

export function paymentDeps(): PaymentDeps {
  const config = razorpayConfig();
  return {
    payments: supabasePaymentStore(createAdminClient()),
    gateway: config ? razorpayGateway(config) : null,
    assessment: serviceDeps(),
    newId: () => randomUUID(),
    now: () => new Date(),
  };
}

export function paymentsConfigured(): boolean {
  return razorpayConfig() !== null;
}

/**
 * The signed-in, registered client and the phone verified at OTP login, or null (signed out, or not
 * registered yet). Never redirects: the pay page and payment routes work without sign-in.
 */
export async function signedInBuyer(): Promise<{ client: ClientProfile; phone: string } | null> {
  const user = await getAuthUser();
  if (!user?.phone) return null;
  const session = await getCurrentClient();
  if (!session?.client) return null;
  // Supabase Auth keeps the phone without "+" (919876543210): normalise to E.164 like the payments rows.
  const phone = normalizePhoneNumber(user.phone.startsWith('+') ? user.phone : `+${user.phone}`);
  if (!phone.valid) return null;
  return { client: { id: session.client.id, full_name: session.client.full_name }, phone: phone.normalized };
}

export interface PayQuestionnaire {
  code: string;
  name: Text;
}

/** The questionnaire behind a pay link /pay/<code> (e.g. IA; any case), only while it has a live version. */
export async function payQuestionnaire(rawCode: string): Promise<PayQuestionnaire | null> {
  const code = rawCode.toUpperCase();
  if (!/^[A-Z]{1,8}$/.test(code)) return null;
  const db = createAdminClient();
  const { data, error } = await db.from('questionnaires').select('code, name_en, name_hi').eq('code', code).maybeSingle();
  if (error || !data) return null;
  const { count } = await db
    .from('questionnaire_versions')
    .select('id', { count: 'exact', head: true })
    .eq('questionnaire_code', data.code)
    .eq('status', 'live');
  if (!count) return null;
  return { code: data.code, name: { en: data.name_en, hi: data.name_hi } };
}

/** A keyed hash of the caller's IP (rate limiting only; the IP itself is never stored). */
export function ipHash(headers: Headers): string | null {
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim();
  const key = process.env.RAZORPAY_KEY_SECRET;
  if (!ip || !key) return null;
  return createHmac('sha256', key).update(`ip:${ip}`).digest('hex').slice(0, 32);
}

export interface PaymentReceipt {
  /** Formatted, e.g. ₹3,500. */
  amount: string;
  method: string | null;
  paymentId: string;
  paidAt: string;
}

/** The client's own paid payment for an attempt (their receipt), or null (e.g. older test attempts). */
export async function paymentReceipt(client: ClientProfile, attemptId: string): Promise<PaymentReceipt | null> {
  const { data, error } = await createAdminClient()
    .from('payments')
    .select('amount_paise, currency, method, provider_payment_id, paid_at')
    .eq('attempt_id', attemptId)
    .eq('client_id', client.id)
    .eq('status', 'paid')
    .maybeSingle();
  if (error || !data?.provider_payment_id || !data.paid_at) return null;
  return {
    amount: formatPrice(data.amount_paise),
    method: data.method,
    paymentId: data.provider_payment_id,
    paidAt: data.paid_at,
  };
}
