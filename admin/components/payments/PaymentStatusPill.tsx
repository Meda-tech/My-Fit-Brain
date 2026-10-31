import { cn } from '../brand';
import type { PaymentListRow, PaymentView } from '../../lib/services/payments';

// Calm status colours (no red): paid = mist/teal, open = cream, failed / refund needed = cream with
// coral-deep text.
const STYLES: Record<PaymentView, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'bg-mist text-teal' },
  not_started: { label: 'Paid, not started', className: 'bg-mist text-teal' },
  refund_needed: { label: 'Refund needed', className: 'bg-cream text-coral-deep border border-sand' },
  refunded: { label: 'Refunded', className: 'bg-cream text-ink-soft border border-sand' },
  created: { label: 'Not completed', className: 'bg-cream text-ink-soft border border-sand' },
  failed: { label: 'Failed', className: 'bg-cream text-coral-deep border border-sand' },
};

/** One word for where a payment stands: its status, refined for paid purchases. */
export function paymentState(p: Pick<PaymentListRow, 'status' | 'refund_status' | 'attempt'>): PaymentView {
  if (p.status !== 'paid') return p.status;
  if (p.refund_status === 'needed') return 'refund_needed';
  if (p.refund_status === 'refunded') return 'refunded';
  return p.attempt ? 'paid' : 'not_started';
}

export function PaymentStatusPill({ state, className }: { state: PaymentView; className?: string }) {
  const s = STYLES[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold',
        s.className,
        className
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}
