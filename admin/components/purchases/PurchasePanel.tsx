import { Phone } from 'lucide-react';
import { SidePanel } from './SidePanel';
import { PurchaseStatusPill, StagePill } from './PurchasePills';
import { formatAmount, formatDateTime, paymentMethodLabel } from '../payments/format';
import { JOURNEY_STAGE_LABELS, PURCHASE_KIND_LABELS, isLate } from '../../lib/purchases';
import type { PurchaseDetail, PurchasePayment } from '../../lib/services/purchases';

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

// The purchase in a right-side panel: who, what, status, coordinator, the purchase journey with planned and
// actual times, and the payments (collapsed).
export function PurchasePanel({ purchase: p, closeHref, now }: { purchase: PurchaseDetail; closeHref: string; now: Date }) {
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
          <PurchaseStatusPill status={p.status} />
        </div>
        <p className="text-[14px] text-ink-soft">
          Coordinator: <span className="font-medium text-ink">{p.coordinator_name ?? 'None yet'}</span>
        </p>
      </div>

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
    </SidePanel>
  );
}
