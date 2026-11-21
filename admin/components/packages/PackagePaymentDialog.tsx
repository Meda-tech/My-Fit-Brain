'use client';

import { useEffect, useState, useTransition } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { packageOfferAction, packageReferenceUsedAction, recordPackagePaymentAction } from '../../app/purchases/package-actions';
import { Button, Notice, cn, helpTextClasses, inputClasses, labelClasses } from '../brand';
import { formatAmount } from '../payments/amount';
import {
  NOTE_MAX_LENGTH,
  OFFLINE_METHODS,
  OFFLINE_METHOD_LABELS,
  PROOF_ACCEPT,
  PROOF_MAX_BYTES,
  REFERENCE_MAX_LENGTH,
  indiaToday,
  type OfflineMethod,
} from '../../lib/offline-payments';
import type { PackageOffer } from '../../lib/package';

// "Add package payment" (coordinators for their own clients, super admins): the client paid the package outside
// Razorpay. The same form and rules as the ₹3,500 manual payment: the amount is fixed and read-only (the database
// calculates package price − assessment amount paid), method, date, reference, proof to the same Google Drive
// folder. The proof is uploaded first; if that fails nothing is saved. A reference used before only warns.

const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PackagePaymentDialog({
  purchaseId,
  clientLabel,
  variant = 'secondary',
  className,
}: {
  purchaseId: string;
  clientLabel: string;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState<PackageOffer | null | 'loading'>('loading');
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<OfflineMethod>('upi');
  const [proof, setProof] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usedCount, setUsedCount] = useState(0);
  const [today, setToday] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending]);

  const start = () => {
    setOffer('loading');
    setError(null);
    setUsedCount(0);
    setProof(null);
    setMethod('upi');
    setToday(indiaToday());
    setOpen(true);
    packageOfferAction(purchaseId)
      .then(setOffer)
      .catch(() => setOffer(null));
  };

  const checkReference = (value: string) => {
    if (!value.trim()) return setUsedCount(0);
    packageReferenceUsedAction(value)
      .then(setUsedCount)
      .catch(() => setUsedCount(0));
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('proof');
    // Quick checks here; the server checks the real file type again.
    if (!(file instanceof File) || file.size === 0) return setError('Add the payment proof (screenshot or PDF).');
    if (file.size > PROOF_MAX_BYTES) return setError('The proof is larger than 4 MB. Please upload a smaller file.');
    if (file.type && !PROOF_TYPES.includes(file.type)) return setError('The proof must be a JPG, PNG, WebP image or a PDF.');
    setError(null);
    startTransition(async () => {
      try {
        const result = await recordPackagePaymentAction(purchaseId, form);
        if (!result.ok) return setError(result.error);
        setOpen(false);
      } catch {
        setError('Proof could not be uploaded. Please try again.');
      }
    });
  };

  return (
    <>
      <Button type="button" variant={variant} size="sm" onClick={start} className={cn('whitespace-nowrap', className)}>
        Add package payment
      </Button>

      {open && (
        <div className="fixed inset-0 z-60 flex items-end justify-center sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-night/40" onClick={() => !pending && setOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`package-payment-${purchaseId}`}
            className="relative flex max-h-dvh w-full flex-col rounded-t-card bg-white shadow-card sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:rounded-card"
          >
            <div className="flex items-start justify-between gap-3 border-b border-sand px-5 pt-5 pb-4 sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 id={`package-payment-${purchaseId}`} className="font-heading text-[22px] font-semibold text-teal">
                    Add package payment
                  </h2>
                  {offer && offer !== 'loading' && (
                    <span className="rounded-full bg-mist px-3 py-1 text-[14px] font-semibold text-teal">{formatAmount(offer.amount_paise)}</span>
                  )}
                </div>
                <p className="mt-1 text-[14px] text-ink-muted">
                  {clientLabel}
                  {offer && offer !== 'loading' && (
                    <>
                      {' '}
                      · {offer.name}, {offer.sessions} sessions · {formatAmount(offer.price_paise)} − {formatAmount(offer.advance_paise)} already paid.
                      Full payment only, no cash.
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !pending && setOpen(false)}
                aria-label="Close"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-mist hover:text-teal"
              >
                <X size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>

            {offer === 'loading' ? (
              <p className="m-0 px-5 py-8 text-ink-muted sm:px-6">Loading…</p>
            ) : !offer ? (
              <div className="px-5 py-6 sm:px-6">
                <Notice variant="info" role="status">
                  A package payment cannot be added for this purchase now: the report presentation is not marked done yet, or the package is
                  already paid.
                </Notice>
              </div>
            ) : (
              <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
                <div className="grid min-h-0 flex-1 gap-x-5 gap-y-4 overflow-y-auto px-5 py-5 sm:grid-cols-2 sm:px-6">
                  <div>
                    <label htmlFor="pp-amount" className={labelClasses}>
                      Amount
                    </label>
                    <input id="pp-amount" readOnly value={formatAmount(offer.amount_paise)} className={cn(inputClasses, 'bg-cream font-semibold text-teal')} />
                  </div>

                  <div>
                    <label htmlFor="pp-date" className={labelClasses}>
                      Date paid
                    </label>
                    <input id="pp-date" name="paidOn" type="date" required defaultValue={today} max={today} className={inputClasses} />
                  </div>

                  <fieldset className="sm:col-span-2">
                    <legend className={labelClasses}>Method</legend>
                    <div className="grid grid-cols-3 gap-1 rounded-input border border-sand bg-cream p-1">
                      {OFFLINE_METHODS.map((m) => (
                        <label
                          key={m}
                          className="flex min-h-11 cursor-pointer items-center justify-center rounded-[6px] px-2 text-[15px] font-medium text-ink-soft transition-colors hover:text-teal has-checked:bg-white has-checked:font-semibold has-checked:text-teal has-checked:shadow-card has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-coral"
                        >
                          <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
                          {OFFLINE_METHOD_LABELS[m]}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div>
                    <label htmlFor="pp-reference" className={labelClasses}>
                      Reference ID
                    </label>
                    <input
                      id="pp-reference"
                      name="reference"
                      required
                      maxLength={REFERENCE_MAX_LENGTH}
                      autoComplete="off"
                      placeholder="e.g. 4123 9876 5432"
                      aria-describedby="pp-reference-help"
                      onBlur={(e) => checkReference(e.target.value)}
                      onChange={() => usedCount && setUsedCount(0)}
                      className={`${inputClasses} font-mono`}
                    />
                    {usedCount > 0 ? (
                      <p id="pp-reference-help" role="status" className="mt-1.5 text-[13px] font-semibold text-coral-deep">
                        Already on {usedCount === 1 ? 'another payment' : `${usedCount} other payments`}. Check before saving; you can still save.
                      </p>
                    ) : (
                      <p id="pp-reference-help" className={helpTextClasses}>
                        UPI transaction ID, bank UTR or other reference.
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="pp-note" className={labelClasses}>
                      Note <span className="font-normal text-ink-muted">(optional)</span>
                    </label>
                    <input id="pp-note" name="note" maxLength={NOTE_MAX_LENGTH} autoComplete="off" className={inputClasses} />
                  </div>

                  <div className="sm:col-span-2">
                    <span id="pp-proof-label" className={labelClasses}>
                      Proof
                    </span>
                    <label
                      htmlFor="pp-proof"
                      className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-input border border-dashed px-4 py-3 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-coral ${
                        proof ? 'border-teal bg-mist' : 'border-sand bg-cream hover:border-teal'
                      }`}
                    >
                      <input
                        id="pp-proof"
                        name="proof"
                        type="file"
                        required
                        accept={PROOF_ACCEPT}
                        aria-labelledby="pp-proof-label"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          setProof(f ? { name: f.name, size: f.size } : null);
                        }}
                        className="sr-only"
                      />
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-teal">
                        {proof ? <FileText size={20} strokeWidth={2} aria-hidden /> : <Upload size={20} strokeWidth={2} aria-hidden />}
                      </span>
                      {proof ? (
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-ink">{proof.name}</span>
                          <span className="block text-[13px] text-ink-muted">{fileSize(proof.size)} · click to choose another file</span>
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold text-teal">Choose screenshot or PDF</span>
                          <span className="block text-[13px] text-ink-muted">JPG, PNG, WebP or PDF, up to 4 MB. Saved in the company Google Drive.</span>
                        </span>
                      )}
                    </label>
                  </div>

                  {error && (
                    <Notice variant="error" role="alert" className="sm:col-span-2">
                      {error}
                    </Notice>
                  )}
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-sand px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <p className="text-[13px] text-ink-muted">Verified by you. Accounts check: Pending.</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                      Cancel
                    </Button>
                    <Button type="submit" loading={pending} loadingText="Uploading proof…">
                      Save payment
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
