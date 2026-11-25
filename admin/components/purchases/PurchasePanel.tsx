import { Phone } from 'lucide-react';
import { SidePanel } from './SidePanel';
import { PurchaseStatusPill } from './PurchasePills';
import { JourneyView } from './JourneyView';
import { formatAmount, formatDateTime, paymentMethodLabel } from '../payments/format';
import { PackagePaymentDialog } from '../packages/PackagePaymentDialog';
import { OfflinePaymentDialog } from '../payments/OfflinePaymentDialog';
import { CopyButton } from '../CopyButton';
import { CLIENTS_URL } from '../../lib/site';
import { CallDoneButton } from '../calls/CallDoneButton';
import { BookPresentationButton } from '../booking/BookPresentationButton';
import { CancelBookingButton } from '../booking/CancelBookingButton';
import { PresentationDoneButton } from '../presentations/PresentationDoneButton';
import { AdminPresentationDoneButton } from '../presentations/AdminPresentationDoneButton';
import { presentationLabel } from '../../lib/booking';
import { PURCHASE_KIND_LABELS } from '../../lib/purchases';
import { JOURNEY_TASK_CALL, buildJourney, type JourneyTaskKey } from '../../lib/journey';
import type { PurchaseDetail, PurchasePayment } from '../../lib/services/purchases';
import { PACKAGE_STARTED_LABEL, neededToStart, rupees, type PackagePayment, type PackageState } from '../../lib/package';

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

function PackagePaymentItem({ p }: { p: PackagePayment }) {
  const manual = p.provider === 'offline';
  return (
    <li className="rounded-card border border-sand p-4">
      <p className="mb-2 font-semibold text-ink">
        Package · {manual ? 'manual payment' : 'in the app'} · {formatAmount(p.amount_paise)}
      </p>
      <dl className="grid gap-1.5">
        <Row label="Status">{p.refund_needed ? 'Refund needed · not counted' : 'Paid'}</Row>
        <Row label="Method">{paymentMethodLabel(p)}</Row>
        <Row label="Paid">{formatDateTime(p.paid_at)}</Row>
        {manual && (
          <>
            <Row label="Reference">
              <span className="font-mono text-[12px]">{p.reference ?? '—'}</span>
            </Row>
            <Row label={p.after_handover ? 'Recorded by' : 'Verified by coordinator'}>{p.recorded_by_name ?? '—'}</Row>
            <Row label="Accounts check">{p.accounts_check === 'checked' ? 'Checked' : 'Pending'}</Row>
            <Proof url={p.proof_url} />
          </>
        )}
      </dl>
    </li>
  );
}

/**
 * The package at a glance, once anything is paid for it (or it can be paid): Package · Paid so far · Remaining and
 * how much is still needed to start the sessions. Once started it is read-only for the coordinator ("Package started
 * – with CRM"): they see what they collected, not what came after the handover.
 */
function PackageSummary({ pkg, canOpenCrm }: { pkg: PackageState; canOpenCrm: boolean }) {
  if (pkg.total_paise === null) return null;
  const needed = pkg.start_paise !== null ? neededToStart(pkg.paid_paise, pkg.start_paise) : 0;
  return (
    <section aria-labelledby="package-summary" className="mb-6 rounded-card border border-sand bg-cream p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="package-summary" className="m-0 text-[16px] font-semibold text-teal">
          Package
        </h3>
        {pkg.started && <span className="rounded-full bg-teal px-3 py-0.5 text-[12px] font-semibold leading-5 text-white">{PACKAGE_STARTED_LABEL}</span>}
      </div>
      <dl className="m-0 mt-2 grid gap-1.5">
        <Row label="Package">{formatAmount(pkg.total_paise)}</Row>
        <Row label={pkg.complete ? 'Paid so far' : 'Collected before the handover'}>
          <span className="font-semibold text-teal">{formatAmount(pkg.paid_paise)}</span>
        </Row>
        {pkg.complete && <Row label="Remaining">{formatAmount(Math.max(pkg.total_paise - pkg.paid_paise, 0))}</Row>}
      </dl>
      {!pkg.started && pkg.start_paise !== null && (
        <p className="m-0 mt-2 text-[14px] font-medium text-teal">
          {needed > 0 ? `${rupees(needed)} more needed to start sessions` : 'Enough is paid to start sessions.'}
        </p>
      )}
      {pkg.started && !pkg.complete && <p className="m-0 mt-2 text-[13px] text-ink-muted">The CRM team takes it from here. This purchase is read-only now.</p>}
      {pkg.started && canOpenCrm && (
        <a href="/crm" className="mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-teal hover:underline">
          Open in CRM
        </a>
      )}
    </section>
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
      presentation: p.presentation,
      packagePayments: p.pkg.payments,
      packageStartPaise: p.pkg.start_paise,
      slotLabel: presentationLabel,
    },
    now
  );
  const task = (key: JourneyTaskKey) => tasks.find((t) => t.key === key);
  // The one main button: the first open task's first action.
  const firstOpen = tasks.find((t) => t.status === 'open')?.key;
  const main = (key: JourneyTaskKey) => (firstOpen === key ? 'primary' : 'secondary');
  const markDone = (key: JourneyTaskKey, variant: 'primary' | 'secondary' = main(key)) => {
    const t = task(key);
    return t?.callId && key !== 'presentation' ? (
      <CallDoneButton
        callId={t.callId}
        kind={JOURNEY_TASK_CALL[key]}
        priorCalls={t.priorCalls}
        adminOnlyNotInterested={(key === 'package' || key === 'pending') && p.pkg.paid_paise > 0 && !canCancelBooking}
        variant={variant}
      />
    ) : null;
  };

  const actions: Partial<Record<JourneyTaskKey, React.ReactNode>> = {
    payment:
      p.status === 'not_paid' ? (
        <>
          {markDone('payment')}
          <OfflinePaymentDialog purchase={{ id: p.id, testCode: p.test_code, testName: p.test_name }} />
          <CopyButton text={`${CLIENTS_URL}/pay/${p.test_code}`} label="Copy pay link" variant="secondary" />
        </>
      ) : null,
    assessment: markDone('assessment'),
    booking:
      p.can_book || task('booking')?.callId ? (
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
    // Add package payment sits on the Package call, or on the Pending payment call once a part is paid.
    package: (
      <>
        {markDone('package')}
        {p.can_add_package_payment && !task('pending') && <PackagePaymentDialog purchaseId={p.id} clientLabel={clientLabel} />}
      </>
    ),
    pending: task('pending') ? (
      <>
        {markDone('pending')}
        {p.can_add_package_payment && <PackagePaymentDialog purchaseId={p.id} clientLabel={clientLabel} />}
      </>
    ) : null,
  };

  const showPackage = p.pkg.payments.length > 0 || p.pkg.started || p.can_add_package_payment;
  const paymentCount = p.payments.length + p.pkg.payments.length;
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
          <PurchaseStatusPill status={p.status} notInterested={p.not_interested} />
        </div>
        <p className="m-0 text-[14px] text-ink-soft">
          Coordinator: <span className="font-medium text-ink">{p.coordinator_name ?? 'None yet'}</span>
        </p>
      </div>

      {showPackage && <PackageSummary pkg={p.pkg} canOpenCrm={canCancelBooking} />}

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
          {p.pkg.payments.map((pay) => (
            <PackagePaymentItem key={pay.id} p={pay} />
          ))}
        </ul>
      </details>
    </SidePanel>
  );
}
