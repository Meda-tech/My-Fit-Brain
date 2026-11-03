// Shared display helpers for the Payments page (client and server components).
import type { PaymentListRow } from '../../lib/services/payments';
import { OFFLINE_METHOD_LABELS, type OfflineMethod } from '../../lib/offline-payments';

export { formatAmount } from './amount';

/** India time: the server runs in UTC once deployed. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

const METHODS: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
  emi: 'EMI',
  paylater: 'Pay later',
};

export function methodLabel(method: string | null): string {
  if (!method) return '—';
  return METHODS[method] ?? method;
}

/** Razorpay (with the method used inside the checkout), or the offline method: UPI / Bank transfer / Other. */
export function paymentMethodLabel(p: Pick<PaymentListRow, 'provider' | 'method'>): string {
  if (p.provider === 'offline') return OFFLINE_METHOD_LABELS[p.method as OfflineMethod] ?? p.method ?? 'Offline';
  return p.method ? `Razorpay · ${methodLabel(p.method)}` : 'Razorpay';
}

/** The payment's reference: the offline reference typed by staff, else the Razorpay payment / order ID. */
export function paymentReference(p: Pick<PaymentListRow, 'provider' | 'reference' | 'provider_payment_id' | 'provider_order_id'>): string {
  if (p.provider === 'offline') return p.reference ?? '';
  return p.provider_payment_id ?? p.provider_order_id;
}

export const ATTEMPT_STATUS_LABELS: Record<string, string> = {
  paid: 'Started, consent not given yet',
  in_progress: 'In progress',
  completed: 'Completed',
};

/** Who the purchase is for: the linked client, else the client registered with the number, else the under-18 record. */
export function clientName(p: Pick<PaymentListRow, 'client' | 'registered' | 'age_stop'>): string | null {
  const c = p.client ?? p.registered;
  if (c) return c.full_name;
  if (p.age_stop) return `Under 18 · ${p.age_stop.full_name ?? 'no name'}`;
  return null;
}
