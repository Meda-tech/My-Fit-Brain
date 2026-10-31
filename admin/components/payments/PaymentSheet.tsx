'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { markRefundedAction, movePurchaseAction } from '../../app/payments/actions';
import { Button, cn, inputClasses, labelClasses } from '../brand';
import type { PaymentListRow } from '../../lib/services/payments';
import { PaymentStatusPill, paymentState } from './PaymentStatusPill';
import { ATTEMPT_STATUS_LABELS, formatAmount, formatDateTime, methodLabel } from './format';

// Side sheet with everything about one payment. Slides in from the right; Esc, the close button or
// the backdrop closes it. Focus moves into the sheet and back to the row on close.

export function PaymentSheet({ payment, onClose }: { payment: PaymentListRow | null; onClose: () => void }) {
  const open = !!payment;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div className={cn('fixed inset-0 z-50', open ? '' : 'pointer-events-none')} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={cn('absolute inset-0 bg-night/40 transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0')}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-sheet-title"
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-120 flex-col bg-white shadow-card transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {payment && <SheetBody payment={payment} onClose={onClose} closeRef={closeRef} />}
      </aside>
    </div>
  );
}

function SheetBody({
  payment: p,
  onClose,
  closeRef,
}: {
  payment: PaymentListRow;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const location = [p.client?.city, p.client?.state].filter(Boolean).join(', ');
  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-sand px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Payment</p>
          <h2 id="payment-sheet-title" className="mt-1 font-heading text-[26px] font-semibold leading-tight text-ink">
            {formatAmount(p.amount_paise, p.currency)}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
            <PaymentStatusPill state={paymentState(p)} />
            <span>{p.status === 'paid' ? formatDateTime(p.paid_at) : formatDateTime(p.created_at)}</span>
          </div>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-mist hover:text-teal"
        >
          <X size={20} strokeWidth={2} aria-hidden />
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
        {p.status === 'failed' && (p.failure_reason || p.failure_code) && (
          <p className="rounded-input border border-sand bg-cream p-3 text-[14px] text-ink-soft">
            <span className="font-semibold text-coral-deep">Did not go through.</span> {p.failure_reason}
            {p.failure_code ? ` (${p.failure_code})` : ''}
          </p>
        )}

        <Section title="Purchase">
          <Row label="Paid for number">
            <span className="font-mono text-[13px]">{p.phone}</span>
          </Row>
          <Row label="Linked to client">{p.claimed_at ? formatDateTime(p.claimed_at) : 'Not yet (logs in with this number)'}</Row>
        </Section>

        <PurchaseActions payment={p} />

        <Section title="Client">
          {p.client ? (
            <>
              <Row label="Name">
                <Link href={`/clients/${p.client.id}`} className="font-semibold text-teal hover:underline">
                  {p.client.full_name}
                </Link>
              </Row>
              <Row label="Mobile">
                <span className="font-mono text-[13px]">{p.client.phone}</span>
              </Row>
              <Row label="Email">{p.client.email || '—'}</Row>
              <Row label="Gender · age">
                {p.client.gender} · {p.client.age} years
              </Row>
              <Row label="Location">{location || '—'}</Row>
            </>
          ) : (
            <p className="text-[14px] text-ink-muted">Nobody has logged in with this number yet.</p>
          )}
        </Section>

        <Section title="Assessment">
          <Row label="Test">{p.test_name}</Row>
          {p.attempt ? (
            <>
              <Row label="Report ID">
                <Link href={`/attempts/${p.attempt.id}`} className="font-mono text-[13px] font-semibold text-teal hover:underline">
                  {p.attempt.report_id ?? '—'}
                </Link>
              </Row>
              <Row label="Status">{ATTEMPT_STATUS_LABELS[p.attempt.status] ?? p.attempt.status}</Row>
              <Row label="Version">{p.attempt.version_number ?? '—'}</Row>
              <Row label="Started">{formatDateTime(p.attempt.started_at)}</Row>
              <Row label="Completed">{formatDateTime(p.attempt.completed_at)}</Row>
            </>
          ) : (
            <p className="text-[14px] text-ink-muted">
              {p.status !== 'paid'
                ? 'No assessment: the payment was not completed.'
                : p.refund_status
                  ? 'No assessment: the purchase is marked for refund.'
                  : 'Not started yet. The assessment and its report ID are created when the client presses Start.'}
            </p>
          )}
        </Section>

        <Section title="Payment details">
          <Row label="Amount">{formatAmount(p.amount_paise, p.currency)}</Row>
          <Row label="Method">{methodLabel(p.method)}</Row>
          <Row label="Started at">{formatDateTime(p.created_at)}</Row>
          <Row label="Paid at">{formatDateTime(p.paid_at)}</Row>
          <Row label="Last update">{formatDateTime(p.updated_at)}</Row>
        </Section>

        <Section title="Razorpay">
          <Row label="Payment ID">
            {p.provider_payment_id ? <CopyText value={p.provider_payment_id} /> : '—'}
          </Row>
          <Row label="Order ID">
            <CopyText value={p.provider_order_id} />
          </Row>
          <Row label="Our reference">
            <CopyText value={p.id} />
          </Row>
          {p.provider_payment_id && (
            <a
              href={`https://dashboard.razorpay.com/app/payments/${encodeURIComponent(p.provider_payment_id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-semibold text-teal hover:underline"
            >
              Open in Razorpay
              <ExternalLink size={15} strokeWidth={2} aria-hidden />
            </a>
          )}
        </Section>
      </div>
    </>
  );
}

/** Move to another number / mark refunded: only for a paid purchase that is not started. */
function PurchaseActions({ payment: p }: { payment: PaymentListRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [moving, setMoving] = useState(false);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (p.status !== 'paid' || p.attempt || p.refund_status === 'refunded') return null;

  const run = (action: () => Promise<{ error: string | null }>) => {
    setError(null);
    startTransition(async () => {
      const { error } = await action();
      if (error) {
        setError(error);
        return;
      }
      setMoving(false);
      setPhone('');
      router.refresh();
    });
  };

  return (
    <section className="space-y-3">
      {p.refund_status === 'needed' && (
        <p className="rounded-input border border-sand bg-cream p-3 text-[14px] text-ink-soft">
          <span className="font-semibold text-coral-deep">Refund needed.</span> Refund it in the Razorpay dashboard, then mark it
          refunded here.
        </p>
      )}
      {moving ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => movePurchaseAction(p.id, phone));
          }}
          className="space-y-2 rounded-card border border-sand p-4"
        >
          <label htmlFor="move-phone" className={labelClasses}>
            New mobile number
          </label>
          <input
            id="move-phone"
            type="tel"
            inputMode="numeric"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
            className={inputClasses}
          />
          <p className="text-[13px] text-ink-muted">
            Whoever logs in with the new number gets this purchase on Home. The current link to a client is removed.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={pending} loadingText="Moving…">
              Move purchase
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMoving(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setMoving(true)} disabled={pending}>
            Move purchase to another number
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (window.confirm('Mark this purchase as refunded? Do this only after the money was returned in Razorpay. It cannot be undone.')) {
                run(() => markRefundedAction(p.id));
              }
            }}
          >
            Mark refunded
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[14px] text-coral-deep">
          {error}
        </p>
      )}
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{title}</h3>
      <dl className="divide-y divide-sand rounded-card border border-sand px-4">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[14px] text-ink wrap-break-word">{children}</dd>
    </div>
  );
}

function CopyText({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the value stays selectable.
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="select-all break-all font-mono text-[12px] text-ink-soft">{value}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${value}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-teal hover:bg-mist"
      >
        {copied ? <Check size={15} strokeWidth={2} aria-hidden /> : <Copy size={15} strokeWidth={2} aria-hidden />}
      </button>
    </span>
  );
}
