import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAuthUser } from '../auth';
import { currentClient, serviceDeps } from '../assessment/server';
import type { ClientProfile } from '../assessment/types';
import { createAdminClient } from '../supabase/admin';
import { razorpayConfig, razorpayGateway } from './razorpay';
import type { PaymentDeps } from './service';
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
