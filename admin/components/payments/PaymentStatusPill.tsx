import { cn } from '../brand';
import type { PaymentStatus } from '../../lib/services/payments';

// Calm status colours (no red): paid = mist/teal, open = cream, failed = cream with coral-deep text.
const STYLES: Record<PaymentStatus, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'bg-mist text-teal' },
  created: { label: 'Not completed', className: 'bg-cream text-ink-soft border border-sand' },
  failed: { label: 'Failed', className: 'bg-cream text-coral-deep border border-sand' },
};

export function PaymentStatusPill({ status, className }: { status: PaymentStatus; className?: string }) {
  const s = STYLES[status];
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
