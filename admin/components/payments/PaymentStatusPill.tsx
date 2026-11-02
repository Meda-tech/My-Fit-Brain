import { cn } from '../brand';
import type { PaymentListRow } from '../../lib/services/payments';

// Two calm pills per purchase (no red): the payment, and where the client is with the assessment.
// Coral-deep text marks a row the team should act on (call the client, or refund).

const CALM = 'bg-mist text-teal';
const MUTED = 'bg-cream text-ink-soft border border-sand';
const ACT = 'bg-cream text-coral-deep border border-sand';

type Row = Pick<PaymentListRow, 'status' | 'refund_status' | 'claimed_at' | 'attempt' | 'paid_later'>;

export function paymentLabel(p: Row): { label: string; className: string } {
  if (p.status === 'created') return { label: 'Not paid', className: MUTED };
  if (p.status === 'failed') return { label: 'Payment failed', className: MUTED };
  if (p.refund_status === 'needed') return { label: 'Refund needed', className: ACT };
  if (p.refund_status === 'refunded') return { label: 'Refunded', className: MUTED };
  return { label: 'Paid', className: CALM };
}

/** Null when there is no assessment to speak of (not paid, refund). */
export function assessmentLabel(p: Row): { label: string; className: string } | null {
  if (p.status !== 'paid' || p.refund_status) return null;
  if (p.attempt?.status === 'completed') return { label: 'Completed', className: CALM };
  if (p.attempt) return { label: 'In progress', className: 'bg-white text-teal border border-teal' };
  // Two different calls: not logged in (solid) is a step earlier than not started (outlined).
  return p.claimed_at
    ? { label: 'Not started', className: 'bg-white text-coral-deep border border-coral-deep' }
    : { label: 'Not logged in', className: 'bg-coral-deep text-white' };
}

export function StatusPill({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold', className)}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function PaymentPill({ payment }: { payment: Row }) {
  if (!payment.paid_later) return <StatusPill {...paymentLabel(payment)} />;
  // This try was not paid, but the same number paid for the same test on a later try (its own row).
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <StatusPill {...paymentLabel(payment)} />
      <span className="text-[12px] text-ink-muted">Paid on a later try</span>
    </span>
  );
}

export function AssessmentPill({ payment }: { payment: Row }) {
  const s = assessmentLabel(payment);
  return s ? <StatusPill {...s} /> : <span className="text-ink-muted">—</span>;
}
