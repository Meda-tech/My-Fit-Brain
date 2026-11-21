// Package (step 6): the words and small rules the admin screens show. No database access; the database keeps the
// package, calculates the amount (package price − assessment amount paid) and settles payments
// (migration 20261121300000_packages.sql).

export interface PackageSettings {
  name: string;
  sessions: number;
  frequency: string;
  price_paise: number;
  updated_at: string;
}

export interface PackageOffer {
  name: string;
  sessions: number;
  frequency: string;
  price_paise: number;
  advance_paise: number;
  amount_paise: number;
}

/** A paid package of an assessment purchase, as the side panel shows it. */
export interface PackagePaid {
  amount_paise: number;
  paid_at: string;
  provider: 'razorpay' | 'offline';
  method: string | null;
  /** Manual payments: the reference, the proof and who recorded it. */
  reference: string | null;
  proof_url: string | null;
  recorded_by_name: string | null;
}

export type PackagePaymentState = 'paid' | 'refund_needed' | 'refunded' | 'failed' | 'not_completed';

export const PACKAGE_PAYMENT_STATE_LABELS: Record<PackagePaymentState, string> = {
  paid: 'Paid',
  refund_needed: 'Refund needed',
  refunded: 'Refunded',
  failed: 'Payment failed',
  not_completed: 'Not completed',
};

export function packagePaymentState(p: { status: string; refund_status: string | null }): PackagePaymentState {
  if (p.status === 'paid') return p.refund_status === 'needed' ? 'refund_needed' : p.refund_status === 'refunded' ? 'refunded' : 'paid';
  return p.status === 'failed' ? 'failed' : 'not_completed';
}

const RUPEES = /^\d{1,7}$/;

/** Checks the settings form. The price is typed in rupees. */
export function parsePackageSettings(fields: { name: unknown; sessions: unknown; frequency: unknown; price: unknown }):
  | { ok: true; value: { name: string; sessions: number; frequency: string; price_paise: number } }
  | { ok: false; error: string } {
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'Enter the package name (2 to 80 characters).' };
  const sessions = Number(typeof fields.sessions === 'string' ? fields.sessions.trim() : fields.sessions);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 100) return { ok: false, error: 'Enter the number of sessions (1 to 100).' };
  const frequency = typeof fields.frequency === 'string' ? fields.frequency.trim() : '';
  if (frequency.length < 2 || frequency.length > 80) return { ok: false, error: 'Enter how often the sessions are (2 to 80 characters).' };
  const price = typeof fields.price === 'string' ? fields.price.replace(/[,\s₹]/g, '') : '';
  if (!RUPEES.test(price) || Number(price) <= 3500) return { ok: false, error: 'The package price must be more than the assessment price (₹3,500), in whole rupees.' };
  return { ok: true, value: { name, sessions, frequency, price_paise: Number(price) * 100 } };
}
