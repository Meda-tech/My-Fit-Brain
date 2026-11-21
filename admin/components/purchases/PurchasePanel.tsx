import { Phone } from 'lucide-react';
import { SidePanel } from './SidePanel';
import { PurchaseStatusPill, StagePill } from './PurchasePills';
import { formatAmount, formatDateTime, formatTime, paymentMethodLabel } from '../payments/format';
import { CopyButton } from '../CopyButton';
import { CLIENTS_URL } from '../../lib/site';
import { CallDoneButton } from '../calls/CallDoneButton';
import { BookPresentationButton } from '../booking/BookPresentationButton';
import { CancelBookingButton } from '../booking/CancelBookingButton';
import { PresentationDoneButton } from '../presentations/PresentationDoneButton';
import { presentationLabel } from '../../lib/booking';
import { cn } from '../brand';
import { JOURNEY_STAGE_LABELS, PURCHASE_KIND_LABELS, isLate } from '../../lib/purchases';
import { CALL_EVENT_LABELS, CALL_KIND_LABELS, CALL_REASON_LABELS, choiceLabel, isCallLate, outcomeLabel } from '../../lib/calls';
import type { CallLogRow, CallRow, PurchaseDetail, PurchasePayment } from '../../lib/services/purchases';

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

function PaymentItem({ p }: { p: PurchasePayment }) {
  const manual = p.provider === 'offline';
  return (
    <li className="rounded-card border border-sand p-4">
      <p className="mb-2 font-semibold text-ink">
        {manual ? 'Manual payment' : 'Pay page'} · {formatAmount(p.amount_paise, p.currency)}
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
            {p.proof_url && (
              <Row label="Proof">
                <a href={p.proof_url} target="_blank" rel="noreferrer" className="font-medium text-teal hover:underline">
                  Open
                </a>
              </Row>
            )}
          </>
        )}
      </dl>
    </li>
  );
}

function logText(l: CallLogRow, kind: CallRow['kind']): string {
  // "Tried again – failed, 4:19 pm" (owner's words, 2026-11-20).
  if (l.entry === 'event' && l.event === 'try_failed') return `${CALL_EVENT_LABELS.try_failed}, ${formatTime(l.at)}`;
  // "Presentation booked: Test Counsellor, Mon 23 Nov 2026, 10:00" (the note holds what was booked / why cancelled).
  if (l.entry === 'event' && l.event && l.note) return `${CALL_EVENT_LABELS[l.event]}: ${l.note}`;
  if (l.entry === 'event') return l.event ? CALL_EVENT_LABELS[l.event] : '';
  const parts = [l.choice ? choiceLabel(kind, l.choice) : ''];
  if (l.reason) parts.push(CALL_REASON_LABELS[l.reason]);
  if (l.follow_up_at) parts.push(`follow-up ${formatDateTime(l.follow_up_at)}`);
  return parts.join(' · ');
}

// The open call (with Mark as call done; a Booking call also with Book presentation) and the call history of every
// call, collapsed.
function CallBox({ calls, now, book }: { calls: CallRow[]; now: Date; book: React.ReactNode }) {
  if (calls.length === 0) return null;
  const open = calls.find((c) => c.status === 'open');
  // The history lines, plus one line for a call a rule closed (its note, e.g. paid before go-live).
  const logs: (CallLogRow & { kind: CallRow['kind']; text?: string })[] = calls
    .flatMap((c) => [
      ...c.logs.map((l) => ({ ...l, kind: c.kind })),
      ...(c.closed_note && c.closed_at
        ? [{ id: `${c.id}-note`, at: c.closed_at, entry: 'event' as const, choice: null, reason: null, note: null, follow_up_at: null, event: null, by_name: null, kind: c.kind, text: c.closed_note }]
        : []),
    ])
    .sort((a, b) => b.at.localeCompare(a.at));
  const late = open ? isCallLate(open.due_at, now) : false;
  return (
    <section className="mb-6 grid gap-3">
      {open && (
        <div className="rounded-card border border-sand bg-cream p-4">
          <p className="m-0 font-semibold text-ink">{CALL_KIND_LABELS[open.kind]}</p>
          <p className={cn('m-0 mt-0.5 text-[14px]', late ? 'font-semibold text-coral-deep' : 'text-ink-soft')}>
            {late ? 'Late · was due ' : 'Due '}
            {formatDateTime(open.due_at)}
          </p>
          {open.kind === 'booking' && book ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {book}
              <CallDoneButton callId={open.id} kind={open.kind} priorCalls={open.prior_calls} />
            </div>
          ) : (
            <CallDoneButton callId={open.id} kind={open.kind} priorCalls={open.prior_calls} variant="primary" className="mt-3" />
          )}
        </div>
      )}
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-teal">
          <span className="transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
          Call history ({logs.length})
        </summary>
        <ol className="mt-2 grid gap-2">
          {logs.map((l) => (
            <li key={l.id} className="rounded-card border border-sand p-3 text-[14px]">
              <p className="m-0 text-[12px] text-ink-muted">
                {formatDateTime(l.at)} · {CALL_KIND_LABELS[l.kind]}
                {l.by_name ? ` · ${l.by_name}` : ''}
              </p>
              <p className={cn('m-0', l.entry === 'call' ? 'font-medium text-ink' : 'text-ink-soft')}>{l.text ?? logText(l, l.kind)}</p>
              {l.note && l.entry === 'call' && <p className="m-0 mt-1 whitespace-pre-line text-ink-soft">{l.note}</p>}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

// The row in a right-side panel: who, what, status, coordinator, the open call and the call history. A purchase
// shows its purchase journey with planned and actual times, and the payments (collapsed). An unpaid row (payment
// attempt) lists its tries.
export function PurchasePanel({
  purchase: p,
  closeHref,
  now,
  canCancelBooking = false,
}: {
  purchase: PurchaseDetail;
  closeHref: string;
  now: Date;
  /** Super admins: Cancel booking (with a reason). */
  canCancelBooking?: boolean;
}) {
  const unpaid = p.status === 'not_paid';
  const clientLabel = p.client_name ?? p.phone;
  const book = p.can_book ? (
    <BookPresentationButton purchaseId={p.id} clientLabel={clientLabel} testName={p.test_name} variant="primary" />
  ) : null;
  const bookingCallOpen = p.calls.some((c) => c.kind === 'booking' && c.status === 'open');
  return (
    <SidePanel title={p.client_name ?? 'Not registered yet'} closeHref={closeHref}>
      <div className="mb-5 grid gap-2">
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
        <p className="text-[14px] text-ink-soft">
          Coordinator: <span className="font-medium text-ink">{p.coordinator_name ?? 'None yet'}</span>
        </p>
        {/* During a Payment call: the pay link for this assessment, to send to the client. */}
        {unpaid && (
          <div className="w-fit">
            <CopyButton text={`${CLIENTS_URL}/pay/${p.test_code}`} label="Copy pay link" variant="secondary" />
          </div>
        )}
      </div>

      {p.presentation ? (
        <section className="mb-6 rounded-card border border-teal/30 bg-mist p-4">
          <h3 className="m-0 text-[16px] font-semibold text-teal">Report presentation</h3>
          <p className="m-0 mt-1 font-medium text-ink">
            {p.presentation.counsellor_name ?? 'Counsellor'} · {presentationLabel(p.presentation.on_date, p.presentation.start_time)}
          </p>
          <p className="m-0 text-[13px] text-ink-muted">
            Booked by {p.presentation.booked_by_name ?? '—'}, {formatDateTime(p.presentation.booked_at)}
          </p>
          {p.presentation.done_at ? (
            <>
              <p className="m-0 mt-2 text-[14px] font-semibold text-teal">
                Presentation done {formatDateTime(p.presentation.done_at)}
                {p.presentation.done_by_name ? ` by ${p.presentation.done_by_name}` : ''}
              </p>
              {p.package_call && (
                <p className="m-0 text-[14px] text-ink">
                  Package call:{' '}
                  {p.package_call.status === 'open'
                    ? `open, due ${formatDateTime(p.package_call.due_at)}`
                    : p.package_call.outcome
                      ? outcomeLabel('package', p.package_call.outcome)
                      : 'closed'}
                </p>
              )}
            </>
          ) : (
            canCancelBooking && (
              // Super admins: mark it done at any time (e.g. a forgotten one), or cancel the booking.
              <div className="mt-2 flex flex-wrap gap-2">
                <PresentationDoneButton
                  bookingId={p.presentation.id}
                  summary={`${clientLabel} · ${presentationLabel(p.presentation.on_date, p.presentation.start_time)}`}
                  variant="secondary"
                />
                <CancelBookingButton bookingId={p.presentation.id} />
              </div>
            )
          )}
        </section>
      ) : (
        // No open Booking call (e.g. marked Done, or none by the go-live rule) but it can still be booked.
        book &&
        !bookingCallOpen && <div className="mb-6">{book}</div>
      )}

      <CallBox calls={p.calls} now={now} book={book} />

      {unpaid ? (
        <>
          <h3 className="mb-1 text-[16px] font-semibold text-teal">Tries ({p.payments.length})</h3>
          <p className="mb-3 text-[13px] text-ink-muted">
            {p.not_interested
              ? 'Closed as Not interested on the Payment call. If this number pays this assessment, it moves to Paid.'
              : 'Not paid yet. When this number pays this assessment, it moves to Paid.'}
          </p>
          <ul className="grid gap-3">
            {p.payments.map((pay) => (
              <PaymentItem key={pay.id} p={pay} />
            ))}
          </ul>
        </>
      ) : (
        <PurchaseJourney purchase={p} now={now} />
      )}
    </SidePanel>
  );
}

function PurchaseJourney({ purchase: p, now }: { purchase: PurchaseDetail; now: Date }) {
  return (
    <>
      <h3 className="mb-3 text-[16px] font-semibold text-teal">Purchase journey</h3>
      <ol className="mb-6 grid gap-3">
        {p.stages.map((s, i) => (
          <li key={s.stage} className="flex gap-3">
            <span
              aria-hidden
              className={
                s.status === 'done'
                  ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal text-[13px] font-semibold text-white'
                  : s.status === 'open'
                    ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-teal text-[13px] font-semibold text-teal'
                    : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sand text-[13px] text-ink-muted'
              }
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{JOURNEY_STAGE_LABELS[s.stage]}</span>
                <StagePill status={s.status} late={isLate(s, now)} />
              </div>
              <p className="mt-0.5 text-[13px] text-ink-soft">
                Planned: {formatDateTime(s.planned_at)} · Actual: {formatDateTime(s.done_at)}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-teal">
          <span className="transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
          Payments ({p.payments.length})
        </summary>
        <ul className="mt-2 grid gap-3">
          {p.payments.map((pay) => (
            <PaymentItem key={pay.id} p={pay} />
          ))}
        </ul>
      </details>
    </>
  );
}
