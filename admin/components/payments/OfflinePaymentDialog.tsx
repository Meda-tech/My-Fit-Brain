'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { recordOfflinePaymentAction, referenceUsedAction } from '../../app/clients/[id]/actions';
import { Button, Notice, helpTextClasses, inputClasses, labelClasses } from '../brand';
import {
  NOTE_MAX_LENGTH,
  OFFLINE_METHODS,
  OFFLINE_METHOD_LABELS,
  PROOF_ACCEPT,
  PROOF_MAX_BYTES,
  REFERENCE_HINTS,
  REFERENCE_MAX_LENGTH,
  type OfflineMethod,
} from '../../lib/offline-payments';

// "Add offline payment" on a client's profile (super admins and coordinators). The proof is uploaded
// first; if that fails nothing is saved. A reference used before only shows a warning.

interface Props {
  clientId: string;
  questionnaires: { code: string; name: string }[];
  /** Formatted fixed price, e.g. ₹3,500 (read-only, no discounts). */
  price: string;
  today: string;
  /** Recorded by: the signed-in staff member. */
  staffName: string;
}

const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function OfflinePaymentDialog({ clientId, questionnaires, price, today, staffName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<OfflineMethod>('upi');
  const [error, setError] = useState<string | null>(null);
  const [usedCount, setUsedCount] = useState(0);
  const [saved, setSaved] = useState<{ paymentId: string; duplicate: boolean } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const first = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    first.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending]);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setError(null);
    setUsedCount(0);
    opener.current?.focus();
  };

  const checkReference = (value: string) => {
    if (!value.trim()) return setUsedCount(0);
    referenceUsedAction(value)
      .then(setUsedCount)
      .catch(() => setUsedCount(0));
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const proof = form.get('proof');
    // Quick checks here; the server checks the real file type again.
    if (!(proof instanceof File) || proof.size === 0) return setError('Add the payment proof (screenshot or PDF).');
    if (proof.size > PROOF_MAX_BYTES) return setError('The proof is larger than 4 MB. Please upload a smaller file.');
    if (proof.type && !PROOF_TYPES.includes(proof.type)) return setError('The proof must be a JPG, PNG, WebP image or a PDF.');
    setError(null);
    startTransition(async () => {
      try {
        const result = await recordOfflinePaymentAction(clientId, form);
        if (!result.ok) return setError(result.error);
        setSaved({ paymentId: result.paymentId, duplicate: result.duplicateReference });
        setOpen(false);
        setUsedCount(0);
        router.refresh();
      } catch {
        setError('Proof could not be uploaded. Please try again.');
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={(e) => {
          opener.current = e.currentTarget;
          setSaved(null);
          setOpen(true);
        }}
        disabled={questionnaires.length === 0}
        title={questionnaires.length === 0 ? 'No assessment can be bought right now.' : undefined}
      >
        <Plus size={18} strokeWidth={2} aria-hidden />
        <span>Add offline payment</span>
      </Button>

      {saved && (
        <Notice title="Payment recorded." className="order-last basis-full sm:max-w-120" role="status">
          The client can start the assessment from Home now.{' '}
          {saved.duplicate && <span className="font-semibold text-coral-deep">The same reference is on another payment; please check. </span>}
          <Link href={`/payments?payment=${saved.paymentId}`} className="font-semibold text-teal hover:underline">
            View in Payments
          </Link>
        </Notice>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-night/40" onClick={close} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="offline-payment-title"
            className="relative max-h-full w-full max-w-130 overflow-y-auto rounded-card bg-white p-5 shadow-card sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="offline-payment-title" className="font-heading text-[22px] font-semibold text-teal">
                  Add offline payment
                </h2>
                <p className="mt-1 text-[14px] text-ink-muted">For a payment made outside Razorpay. No cash payments.</p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-mist hover:text-teal"
              >
                <X size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="op-code" className={labelClasses}>
                  Assessment
                </label>
                <select id="op-code" name="code" ref={first} required className={inputClasses} defaultValue={questionnaires[0]?.code}>
                  {questionnaires.map((q) => (
                    <option key={q.code} value={q.code}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="op-amount" className={labelClasses}>
                  Amount
                </label>
                <input id="op-amount" value={price} readOnly aria-readonly className={`${inputClasses} bg-cream`} />
                <p className={helpTextClasses}>The fixed price of the assessment. No discounts.</p>
              </div>

              <fieldset>
                <legend className={labelClasses}>Method</legend>
                <div className="flex flex-wrap gap-2">
                  {OFFLINE_METHODS.map((m) => (
                    <label
                      key={m}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-sand px-4 text-[14px] text-ink has-checked:border-teal has-checked:bg-mist has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-coral"
                    >
                      <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
                      {OFFLINE_METHOD_LABELS[m]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="op-date" className={labelClasses}>
                  Date paid
                </label>
                <input id="op-date" name="paidOn" type="date" required defaultValue={today} max={today} className={inputClasses} />
              </div>

              <div>
                <label htmlFor="op-reference" className={labelClasses}>
                  {REFERENCE_HINTS[method]}
                </label>
                <input
                  id="op-reference"
                  name="reference"
                  required
                  maxLength={REFERENCE_MAX_LENGTH}
                  autoComplete="off"
                  onBlur={(e) => checkReference(e.target.value)}
                  onChange={() => usedCount && setUsedCount(0)}
                  className={`${inputClasses} font-mono`}
                />
                {usedCount > 0 && (
                  <p role="status" className="mt-1.5 text-[13px] font-semibold text-coral-deep">
                    This reference is already on {usedCount === 1 ? 'another payment' : `${usedCount} other payments`}. Check before saving; you can
                    still save.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="op-proof" className={labelClasses}>
                  Proof
                </label>
                <input
                  id="op-proof"
                  name="proof"
                  type="file"
                  required
                  accept={PROOF_ACCEPT}
                  className="block w-full text-[14px] text-ink-soft file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-mist file:px-4 file:font-heading file:font-semibold file:text-teal hover:file:bg-sand"
                />
                <p className={helpTextClasses}>Screenshot (JPG, PNG, WebP) or PDF, up to 4 MB. Saved in the company Google Drive.</p>
              </div>

              <div>
                <label htmlFor="op-note" className={labelClasses}>
                  Note <span className="font-normal text-ink-muted">(optional)</span>
                </label>
                <textarea id="op-note" name="note" rows={2} maxLength={NOTE_MAX_LENGTH} className={`${inputClasses} py-2.5`} />
              </div>

              <p className="text-[13px] text-ink-muted">Recorded by {staffName}.</p>

              {error && (
                <Notice variant="error" role="alert">
                  {error}
                </Notice>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={pending} loadingText="Uploading proof…">
                  Save payment
                </Button>
                <Button type="button" variant="ghost" onClick={close} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
