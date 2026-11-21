import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ClientProfile } from '../assessment/types';
import { createAdminClient } from '../supabase/admin';
import { razorpayConfig, razorpayGateway } from '../payments/razorpay';
import { formatPrice } from '../payments/service';
import { recoverOpenPackagePayments, type PackageDeps } from './service';
import { supabasePackageStore } from './store';

// Server wiring for the package offer and payment: Razorpay keys from the environment, store on the service role.

export function packageDeps(): PackageDeps {
  const config = razorpayConfig();
  return {
    packages: supabasePackageStore(createAdminClient()),
    gateway: config ? razorpayGateway(config) : null,
    newId: () => randomUUID(),
    now: () => new Date(),
  };
}

/** The offer as the Home card shows it. Amounts are formatted here; the browser never calculates them. */
export interface PackageOfferCard {
  purchaseId: string;
  sessions: number;
  frequency: string;
  price: string;
  advance: string;
  amount: string;
}

export interface PackagePaidCard {
  sessions: number;
  frequency: string;
  amount: string;
  paidAt: string;
}

/**
 * What Home shows about the package: the client's open offers (report presentation done, nothing paid yet) and
 * their paid packages. Before reading, payments made at Razorpay that this app never heard back about are settled.
 */
export async function packageHome(client: ClientProfile): Promise<{ offers: PackageOfferCard[]; paid: PackagePaidCard[]; enabled: boolean }> {
  const deps = packageDeps();
  try {
    await recoverOpenPackagePayments(deps, client);
  } catch (err) {
    console.warn('Package payment recovery failed:', err instanceof Error ? err.message : err);
  }
  const [offers, paid] = await Promise.all([deps.packages.offers(client.id), deps.packages.paid(client.id)]);
  return {
    enabled: deps.gateway !== null,
    offers: offers.map((o) => ({
      purchaseId: o.purchase_id,
      sessions: o.sessions,
      frequency: o.frequency,
      price: formatPrice(o.price_paise),
      advance: formatPrice(o.advance_paise),
      amount: formatPrice(o.amount_paise),
    })),
    paid: paid.map((p) => ({ sessions: p.sessions, frequency: p.frequency, amount: formatPrice(p.amount_paise), paidAt: p.paid_at })),
  };
}
