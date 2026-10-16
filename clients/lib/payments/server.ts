import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAuthUser } from '../auth';
import { currentClient, serviceDeps } from '../assessment/server';
import type { ClientProfile } from '../assessment/types';
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

/** The signed-in, registered client for an API route, or null (the route answers 401). */
export async function apiClient(): Promise<ClientProfile | null> {
  if (!(await getAuthUser())) return null;
  try {
    return await currentClient();
  } catch {
    return null; // not registered yet (currentClient redirects)
  }
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
