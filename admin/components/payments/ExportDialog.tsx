'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button, cn } from '../brand';
import type { PaymentPeriod, PaymentList } from '../../lib/services/payments';

// "Export to Excel": first asks which list (a stage, or all) and which period, then downloads the
// file from /payments/export. The choice starts from the filters on screen.

interface Props {
  stages: { id: PaymentList | 'all'; label: string; count: number }[];
  periods: { id: PaymentPeriod; label: string }[];
  initialStatus: PaymentList | 'all';
  initialPeriod: PaymentPeriod;
}

export function ExportDialog({ stages, periods, initialStatus, initialPeriod }: Props) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    first.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };

  const option = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-input border border-sand px-3 text-[14px] text-ink has-checked:border-teal has-checked:bg-mist';

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={(e) => {
          opener.current = e.currentTarget;
          setOpen(true);
        }}
      >
        <Download size={16} strokeWidth={2} aria-hidden />
        Export to Excel
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-night/40" onClick={close} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            className="relative max-h-full w-full max-w-120 overflow-y-auto rounded-card bg-white p-5 shadow-card sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="export-title" className="font-heading text-[22px] font-semibold text-teal">
                  Export to Excel
                </h2>
                <p className="mt-1 text-[14px] text-ink-muted">Choose the list you need. The file has one row per purchase.</p>
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

            <form method="GET" action="/payments/export" onSubmit={() => setTimeout(close, 0)} className="space-y-5">
              <fieldset>
                <legend className="mb-2 text-[14px] font-semibold text-ink">Which data?</legend>
                <div className="space-y-2">
                  {stages.map((s, i) => (
                    <label key={s.id} className={option}>
                      <input
                        ref={i === 0 ? first : undefined}
                        type="radio"
                        name="status"
                        value={s.id}
                        defaultChecked={s.id === initialStatus}
                        className="h-4 w-4 accent-teal"
                      />
                      <span className="flex-1">{s.label}</span>
                      <span className="text-[13px] text-ink-muted">{s.count}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-[14px] font-semibold text-ink">Which period?</legend>
                <div className="flex flex-wrap gap-2">
                  {periods.map((p) => (
                    <label
                      key={p.id}
                      className={cn(option, 'rounded-full px-4 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-coral')}
                    >
                      <input type="radio" name="period" value={p.id} defaultChecked={p.id === initialPeriod} className="sr-only" />
                      {p.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[13px] text-ink-muted">Counts above are for all time. The period uses the date the checkout was opened.</p>
              </fieldset>

              <p className="rounded-input border border-sand bg-cream p-3 text-[13px] text-ink-soft">
                The file holds names and phone numbers. Keep it inside the team and delete it when the calls are done.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button type="submit">
                  <Download size={18} strokeWidth={2} aria-hidden />
                  Download Excel
                </Button>
                <Button type="button" variant="ghost" onClick={close}>
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
