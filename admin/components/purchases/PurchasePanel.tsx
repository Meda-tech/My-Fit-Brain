import { Phone } from 'lucide-react';
import { SidePanel } from './SidePanel';
import { PurchaseStatusPill } from './PurchasePills';
import { JourneyView } from './JourneyView';
import { formatAmount, formatDateTime, paymentMethodLabel } from '../payments/format';
import { PackagePaymentDialog } from '../packages/PackagePaymentDialog';
import { CopyButton } from '../CopyButton';
import { CLIENTS_URL } from '../../lib/site';
import { CallDoneButton } from '../calls/CallDoneButton';
import { BookPresentationButton } from '../booking/BookPresentationButton';
import { CancelBookingButton } from '../booking/CancelBookingButton';
import { ClosePurchaseButton } from './ClosePurchaseButton';
import { PresentationDoneButton } from '../presentations/PresentationDoneButton';
import { AdminPresentationDoneButton } from '../presentations/AdminPresentationDoneButton';
import { presentationLabel } from '../../lib/booking';
import { PURCHASE_KIND_LABELS } from '../../lib/purchases';
import { buildJourney, type JourneyTask, type JourneyTaskKey } from '../../lib/journey';
import type { PurchaseDetail, PurchasePayment } from '../../lib/services/purchases';
import type { PackagePaid } from '../../lib/package';

const PAYMENT_STATUS: Record<string, string> = {
  created: 'Not completed',
  failed: 'Failed',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-[14px]">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0 text-right text-ink">{children}</dd>
    </div>
  );
}

function Proof({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <Row label="Proof">
      <a href={url} target="_blank" rel="noreferrer" className="font-medium text-teal hover:underline">
        Open
      </a>
    </Row>
  );
}

function PaymentItem({ p }: { p: PurchasePayment }) {
  const manual = p.provider === 'offline';
  return (
    <li className="rounded-card border border-sand p-4">
      <p className="mb-2 font-semibold text-ink">
        Assessment · {manual ? 'manual payment' : 'pay page'} · {formatAmount(p.amount_paise, p.currency)}
      </p>
      <dl className="grid gap-1.5">
        <Row label="Status">{p.refund_status === 'refunded' ? 'Refunded' : PAYMENT_STATUS[p.status] ?? p.status}</Row>
        <Row label="Method">{paymentMethodLabel(p)}</Row>
        <Row label={p.paid_at ? 'Paid' : 'Tried'}>{formatDateTime(p.paid_at ?? p.created_at)}</Row>
        <Row label="Reference">
          <span className="font-mono text-[12px]">{manual ? p.reference : p.provider_payment_id ?? p.provider_order_id}</span>
        </Row>
        {manual && (
          <>
            <Row label="Verified by coordinator">{p.recorded_by_name ?? '—'}</Row>
            <Row label="Accounts check">{p.accounts_check === 'checked' ? 'Checked' : 'Pending'}</Row>
            <Proof url={p.proof_url} />
          </>
        )}
      </dl>
    </li>
  );
}

function PackagePaymentItem({ p }: { p: PackagePaid }) {
  const manual = p.provider === 'offline';
  return (
    <li className="rounded-card border border-sand p-4">
      <p className="mb-2 font-semibold text-ink">
        Package · {manual ? 'manual payment' : 'in the app'} · {formatAmount(p.amount_paise)}
      </p>
      <dl className="grid gap-1.5">
        <Row label="Status">Paid</Row>
        <Row label="Method">{paymentMethodLabel(p)}</Row>
        <Row label="Paid">{formatDateTime(p.paid_at)}</Row>
        {manual && (
          <>
            <Row label="Reference">
              <span className="font-mono text-[12px]">{p.reference ?? '—'}</span>
            </Row>
            <Row label="Verified by coordinator">{p.recorded_by_name ?? '—'}</Row>
            <Row label="Accounts check">Pending</Row>
            <Proof url={p.proof_url} />
          </>
        )}
      </dl>
    </li>
  );
}

// The purchase in a right-side panel: a short top (client, phone, assessment, amount, status, coordinator), the
// purchase journey (our five tasks with the call attempts and client steps nested; each task's buttons next to it),
// and the payments, collapsed, with their proof links.
export function PurchasePanel({
  purchase: p,
  closeHref,
  now,
  canCancelBooking = false,
}: {
  purchase: PurchaseDetail;
  closeHref: string;
  now: Date;
  /** Super admins: Cancel booking (with a reason) and Report presentation done at any time. */
  canCancelBooking?: boolean;
}) {
  const clientLabel = p.client_name ?? p.phone;
  const tasks = buildJourney(
    {
      status: p.status,
      beforeSystem: p.before_system,
      coordinatorName: p.coordinator_name,
      calls: p.calls,
      payments: p.payments,
      blockedTries: p.blocked_tries,
      closed: p.closed,
      presentation: p.presentation,
      packagePaid: p.package_paid,
      slotLabel: presentationLabel,
    },
    now
  );
  const task = (key: JourneyTaskKey) => tasks.find((t) => t.key === key) as JourneyTask;
  // The one main button: the first open task's first action.
  const firstOpen = tasks.find((t) => t.status === 'open')?.key;
  const main = (key: JourneyTaskKey) => (firstOpen === key ? 'primary' : 'secondary');
  const markDone = (key: JourneyTaskKey, variant: 'primary' | 'secondary' = main(key)) => {
    const t = task(key);
    return t.callId ? <CallDoneButton callId={t.callId} kind={key === 'presentation' ? 'booking' : key} priorCalls={t.priorCalls} variant={variant} /> : null;
  };

  const actions: Partial<Record<JourneyTaskKey, React.ReactNode>> = {
    payment:
      p.status === 'not_paid' ? (
        <>
          {markDone('payment')}
          <CopyButton text={`${CLIENTS_URL}/pay/${p.test_code}`} label="Copy pay link" variant="secondary" />
        </>
      ) : null,
    assessment: markDone('assessment'),
    booking:
      p.can_book || task('booking').callId ? (
        <>
          {p.can_book && (
            // An old purchase has no Booking call: booking by hand is its main button.
            <BookPresentationButton purchaseId={p.id} clientLabel={clientLabel} testName={p.test_name} variant={p.before_system ? 'primary' : main('booking')} />
          )}
          {markDone('booking', 'secondary')}
        </>
      ) : null,
    presentation:
      p.presentation && !p.presentation.done_at && canCancelBooking ? (
        <>
          <PresentationDoneButton
            bookingId={p.presentation.id}
            summary={`${clientLabel} · ${presentationLabel(p.presentation.on_date, p.presentation.start_time, p.presentation.end_time)}`}
            variant={main('presentation')}
          />
          <CancelBookingButton bookingId={p.presentation.id} />
        </>
      ) : p.can_mark_presentation_admin && canCancelBooking ? (
        // An old purchase whose presentation already happened outside the system: a super admin marks it done,
        // without a slot. (Booking a slot is the main button, on the Booking call row.)
        <AdminPresentationDoneButton purchaseId={p.id} clientLabel={clientLabel} testName={p.test_name} variant="secondary" />
      ) : null,
    package: (
      <>
        {markDone('package')}
        {p.can_add_package_payment && <PackagePaymentDialog purchaseId={p.id} clientLabel={clientLabel} />}
      </>
    ),
  };

  const paymentCount = p.payments.length + (p.package_paid ? 1 : 0);
  return (
    <SidePanel title={p.client_name ?? 'Not registered yet'} closeHref={closeHref}>
      <div className="mb-5 grid gap-1">
        <a href={`tel:${p.phone}`} className="inline-flex min-h-11 w-fit items-center gap-2 font-mono text-[16px] font-semibold text-teal hover:underline">
          <Phone size={16} strokeWidth={2} aria-hidden />
          {p.phone}
        </a>
        <div className="flex flex-wrap items-center gap-2 text-[15px] text-ink">
          <span>
            {PURCHASE_KIND_LABELS[p.kind] ?? p.kind}: {p.test_name}
          </span>
          <span className="text-ink-muted">·</span>
          <span>{formatAmount(p.amount_paise)}</span>
          <PurchaseStatusPill status={p.status} notInterested={p.not_interested} closed={!!p.closed} />
        </div>
        <p className="m-0 text-[14px] text-ink-soft">
          Coordinator: <span className="font-medium text-ink">{p.coordinator_name ?? 'None yet'}</span>
        </p>
        {p.closed && (
          <p className="m-0 mt-1 rounded-input bg-mist px-3 py-2 text-[14px] leading-5.5 text-ink-soft">
            <span className="font-semibold text-teal">Closed</span> by {p.closed.by_name ?? 'staff'} on {formatDateTime(p.closed.at)}:{' '}
            <span className="text-ink">{p.closed.reason}</span>
          </p>
        )}
        {p.can_close && <ClosePurchaseButton purchaseId={p.id} />}
      </div>

      <JourneyView tasks={tasks} actions={actions} />

      <details className="group border-t border-sand pt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-teal">
          <span className="transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
          Payments ({paymentCount})
        </summary>
        <ul className="mt-2 grid gap-3">
          {p.payments.map((pay) => (
            <PaymentItem key={pay.id} p={pay} />
          ))}
          {p.package_paid && <PackagePaymentItem p={p.package_paid} />}
        </ul>
      </details>
    </SidePanel>
  );
}
