import { cn } from '../brand';
import { PURCHASE_STATUS_LABELS, STAGE_STATUS_LABELS, type PurchaseStatus, type StageStatus } from '../../lib/purchases';

const PILL = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-4.5';

// Calm colours only: paid = teal, the rest quiet; a failed payment uses the small coral-deep text.
export function PurchaseStatusPill({ status }: { status: PurchaseStatus }) {
  return (
    <span
      className={cn(
        PILL,
        status === 'paid' && 'bg-mist text-teal',
        status === 'not_paid' && 'border border-coral-deep text-coral-deep',
        (status === 'refunded' || status === 'cancelled') && 'border border-sand bg-cream text-ink-soft'
      )}
    >
      {PURCHASE_STATUS_LABELS[status]}
    </span>
  );
}

export function StagePill({ status, late }: { status: StageStatus; late: boolean }) {
  if (late) return <span className={cn(PILL, 'border border-coral-deep text-coral-deep')}>Late</span>;
  return (
    <span
      className={cn(
        PILL,
        status === 'done' && 'bg-teal text-white',
        status === 'open' && 'bg-mist text-teal',
        status === 'waiting' && 'border border-sand bg-cream text-ink-muted'
      )}
    >
      {STAGE_STATUS_LABELS[status]}
    </span>
  );
}
