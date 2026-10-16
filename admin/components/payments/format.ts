// Shared display helpers for the Payments page (client and server components).

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

export const ATTEMPT_STATUS_LABELS: Record<string, string> = {
  paid: 'Paid, not started',
  in_progress: 'In progress',
  completed: 'Completed',
  stopped: 'Stopped',
};
