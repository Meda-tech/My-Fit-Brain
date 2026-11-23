'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { FileText, Plus, Upload, X } from 'lucide-react';
import { recordOfflinePaymentAction, referenceUsedAction } from '../../app/clients/[id]/actions';
import { recordAssessmentPaymentAction } from '../../app/purchases/payment-actions';
import { formatAmount } from './amount';
import { Button, Notice, helpTextClasses, inputClasses, labelClasses } from '../brand';
import {
  ASSESSMENT_PRICE_PAISE,
  NOTE_MAX_LENGTH,
  OFFLINE_METHODS,
  OFFLINE_METHOD_LABELS,
  PROOF_ACCEPT,
  PROOF_MAX_BYTES,
  REFERENCE_MAX_LENGTH,
  indiaToday,
  type OfflineMethod,
} from '../../lib/offline-payments';

// "Add manual payment" on a client's profile (super admins and coordinators). Stored as provider
// 'offline'; staff only ever see "manual". The proof is uploaded first; if that fails nothing is saved.
// A reference used before only shows a warning. The form fits on one screen on a laptop: two columns,
// header and footer fixed; only on small screens does the middle part scroll.
// The same form opens as "Add assessment payment" on an unpaid row (My tasks Payment call, purchase side panel;
// owner, 2026-11-23): `purchase` fixes the assessment and the number to that row's.

interface Props {
  clientId?: string;
  questionnaires?: { code: string; name: string }[];
  /** An unpaid row: the payment is for its number and assessment ("Add assessment payment"). */
  purchase?: { id: string; testCode: string; testName: string };
  /** Formatted fixed price, e.g. ₹3,500 (read-only, no discounts). Default: the assessment price. */
  price?: string;
  /** Default: today in India. */
  today?: string;
  /** Recorded by: the signed-in staff member. Default: "you". */
  staffName?: string;
}

const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OfflinePaymentDialog({ clientId, questionnaires = [], purchase, price = formatAmount(ASSESSMENT_PRICE_PAISE), today: todayProp, staffName }: Props) {
  const title = purchase ? 'Add assessment payment' : 'Add manual payment';
  const choices = purchase ? [{ code: purchase.testCode, name: purchase.testName }] : questionnaires;
  const [today, setToday] = useState(todayProp ?? '');
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<OfflineMethod>('upi');
  const [proof, setProof] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usedCount, setUsedCount] = useState(0);
  const [saved, setSaved] = useState<{ paymentId: string; duplicate: boolean } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const first = useRef<HTMLSelectElement | HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    first.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, pending]);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setError(null);
    setUsedCount(0);
    setProof(null);
    setMethod('upi');
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
    const file = form.get('proof');
    // Quick checks here; the server checks the real file type again.
    if (!(file instanceof File) || file.size === 0) return setError('Add the payment proof (screenshot or PDF).');
    if (file.size > PROOF_MAX_BYTES) return setError('The proof is larger than 4 MB. Please upload a smaller file.');
    if (file.type && !PROOF_TYPES.includes(file.type)) return setError('The proof must be a JPG, PNG, WebP image or a PDF.');
    setError(null);
    startTransition(async () => {
      try {
        const result = purchase ? await recordAssessmentPaymentAction(purchase.id, form) : await recordOfflinePaymentAction(clientId ?? '', form);
        if (!result.ok) return setError(result.error);
        setSaved({ paymentId: result.paymentId, duplicate: result.duplicateReference });
        setOpen(false);
        setUsedCount(0);
        setProof(null);
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
        size={purchase ? 'sm' : undefined}
        className={purchase ? 'whitespace-nowrap' : undefined}
        onClick={(e) => {
          opener.current = e.currentTarget;
          if (!todayProp) setToday(indiaToday());
          setSaved(null);
          setOpen(true);
        }}
        disabled={choices.length === 0}
        title={choices.length === 0 ? 'No assessment can be bought right now.' : undefined}
      >
        <Plus size={purchase ? 16 : 18} strokeWidth={2} aria-hidden />
        <span>{title}</span>
      </Button>

      {saved && (
        <Notice title="Payment recorded." className="order-last basis-full sm:max-w-120" role="status">
          {purchase
            ? 'The purchase is Paid now. The client starts the assessment from Home (after logging in with this number).'
            : 'The client can start the assessment from Home now.'}{' '}
          {saved.duplicate && <span className="font-semibold text-coral-deep">The same reference ID is on another payment; please check. </span>}
          <Link href={`/payments?payment=${saved.paymentId}`} className="font-semibold text-teal hover:underline">
            View in Payments
          </Link>
        </Notice>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-night/40" onClick={close} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-payment-title"
            className="relative flex max-h-dvh w-full flex-col rounded-t-card bg-white shadow-card sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:rounded-card"
          >
            <div className="flex items-start justify-between gap-3 border-b border-sand px-5 pt-5 pb-4 sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 id="manual-payment-title" className="font-heading text-[22px] font-semibold text-teal">
                    {title}
                  </h2>
                  <span className="rounded-full bg-mist px-3 py-1 text-[14px] font-semibold text-teal">{price}</span>
                </div>
                <p className="mt-1 text-[14px] text-ink-muted">A payment made outside Razorpay, at the fixed price. No cash payments.</p>
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

            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
              <div className="grid min-h-0 flex-1 gap-x-5 gap-y-4 overflow-y-auto px-5 py-5 sm:grid-cols-2 sm:px-6">
                <div>
                  <label htmlFor="mp-code" className={labelClasses}>
                    Assessment
                  </label>
                  {purchase ? (
                    <>
                      {/* Fixed by the row; the server uses the row's assessment anyway. */}
                      <input id="mp-code" readOnly value={purchase.testName} className={`${inputClasses} bg-cream`} />
                      <input type="hidden" name="code" value={purchase.testCode} />
                    </>
                  ) : (
                    <select
                      id="mp-code"
                      name="code"
                      ref={(el) => {
                        first.current = el;
                      }}
                      required
                      className={inputClasses}
                      defaultValue={choices[0]?.code}
                    >
                      {choices.map((q) => (
                        <option key={q.code} value={q.code}>
                          {q.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label htmlFor="mp-date" className={labelClasses}>
                    Date paid
                  </label>
                  <input
                    id="mp-date"
                    name="paidOn"
                    type="date"
                    required
                    defaultValue={today}
                    max={today}
                    ref={(el) => {
                      if (purchase) first.current = el;
                    }}
                    className={inputClasses}
                  />
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
                  <label htmlFor="mp-reference" className={labelClasses}>
                    Reference ID
                  </label>
                  <input
                    id="mp-reference"
                    name="reference"
                    required
                    maxLength={REFERENCE_MAX_LENGTH}
                    autoComplete="off"
                    placeholder="e.g. 4123 9876 5432"
                    aria-describedby="mp-reference-help"
                    onBlur={(e) => checkReference(e.target.value)}
                    onChange={() => usedCount && setUsedCount(0)}
                    className={`${inputClasses} font-mono`}
                  />
                  {usedCount > 0 ? (
                    <p id="mp-reference-help" role="status" className="mt-1.5 text-[13px] font-semibold text-coral-deep">
                      Already on {usedCount === 1 ? 'another payment' : `${usedCount} other payments`}. Check before saving; you can still save.
                    </p>
                  ) : (
                    <p id="mp-reference-help" className={helpTextClasses}>
                      UPI transaction ID, bank UTR or other reference.
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="mp-note" className={labelClasses}>
                    Note <span className="font-normal text-ink-muted">(optional)</span>
                  </label>
                  <input id="mp-note" name="note" maxLength={NOTE_MAX_LENGTH} autoComplete="off" className={inputClasses} />
                </div>

                <div className="sm:col-span-2">
                  <span id="mp-proof-label" className={labelClasses}>
                    Proof
                  </span>
                  <label
                    htmlFor="mp-proof"
                    className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-input border border-dashed px-4 py-3 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-coral ${
                      proof ? 'border-teal bg-mist' : 'border-sand bg-cream hover:border-teal'
                    }`}
                  >
                    <input
                      id="mp-proof"
                      name="proof"
                      type="file"
                      required
                      accept={PROOF_ACCEPT}
                      aria-labelledby="mp-proof-label"
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
                <p className="text-[13px] text-ink-muted">Recorded by {staffName ?? 'you'}</p>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={close} disabled={pending}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={pending} loadingText="Uploading proof…">
                    Save payment
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
