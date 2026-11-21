import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ClientProfile } from '../assessment/types';
import { createAdminClient } from '../supabase/admin';
import { razorpayConfig, razorpayGateway } from '../payments/razorpay';
import { ASSESSMENT_PRICE_PAISE, formatPrice } from '../payments/service';
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

export interface PublicPackage {
  sessions: number;
  frequency: string;
  price: string;
  advance: string;
  amount: string;
}

/**
 * The active package for the public /pricing page (the payment gateway wants every product listed), or null when
 * it cannot be read. Same numbers as the client's offer: price − the ₹3,500 assessment advance.
 */
export async function publicPackage(): Promise<PublicPackage | null> {
  const { data, error } = await createAdminClient()
    .from('packages')
    .select('sessions, frequency, price_paise')
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data || data.price_paise <= ASSESSMENT_PRICE_PAISE) return null;
  return {
    sessions: data.sessions,
    frequency: data.frequency,
    price: formatPrice(data.price_paise),
    advance: formatPrice(ASSESSMENT_PRICE_PAISE),
    amount: formatPrice(data.price_paise - ASSESSMENT_PRICE_PAISE),
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
 * Package payments made at Razorpay that this app never heard back about are settled. Home runs this before
 * packageHome(), together with the other checks (never throws).
 */
export async function recoverPackagePayments(client: ClientProfile): Promise<void> {
  try {
    await recoverOpenPackagePayments(packageDeps(), client);
  } catch (err) {
    console.warn('Package payment recovery failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * What Home shows about the package: the client's open offers (report presentation done, nothing paid yet) and
 * their paid packages. Run recoverPackagePayments() first.
 */
export async function packageHome(client: ClientProfile): Promise<{ offers: PackageOfferCard[]; paid: PackagePaidCard[]; enabled: boolean }> {
  const deps = packageDeps();
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
