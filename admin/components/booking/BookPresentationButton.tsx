'use client';

import { useState } from 'react';
import { AlertCircle, ArrowLeft, X } from 'lucide-react';
import { Button, Card, Notice, Pill, cn } from '../brand';
import { dayLabel, slotRange } from '../../lib/availability';
import { presentationLabel, type FreeDay } from '../../lib/booking';
import { bookPresentationAction, freeSlotsAction } from '../../app/tasks/booking-actions';
import { Portal } from '../Portal';

interface Picked {
  counsellorId: string;
  counsellorName: string;
  date: string;
  start: string;
  end: string;
}

// "Book presentation": one panel with the FREE future slots of all active counsellors, by date then counsellor.
// Only the next 3 working days (owner, 2026-11-21; the database refuses later dates). The first 2 dates with free
// slots are marked Preferred; the third can be picked too, no reason needed.
// Pick a slot → confirm (client, assessment, counsellor, date and time) → booked. The database refuses a slot that
// someone else booked meanwhile.
export function BookPresentationButton({
  purchaseId,
  clientLabel,
  testName,
  variant = 'secondary',
  className,
}: {
  purchaseId: string;
  clientLabel: string;
  testName: string;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<FreeDay[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await freeSlotsAction();
    setDays(res.days);
    if (res.error) setError(res.error);
    setLoading(false);
  };

  const start = async () => {
    setPicked(null);
    setOpen(true);
    await load();
  };

  const confirm = async () => {
    if (!picked) return;
    setSaving(true);
    setError(null);
    const res = await bookPresentationAction({ purchaseId, counsellorId: picked.counsellorId, date: picked.date, start: picked.start });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'The presentation could not be booked.');
      // The slot may have gone: show the list again, fresh.
      setPicked(null);
      await load();
      return;
    }
    setOpen(false);
  };

  return (
    <>
      <Button variant={variant} size="sm" onClick={start} className={cn('whitespace-nowrap', className)}>
        Book presentation
      </Button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-60 flex items-end justify-center bg-night/40 sm:items-center sm:p-4">
            <Card
              role="dialog"
              aria-modal="true"
              aria-labelledby={`book-${purchaseId}`}
              className="flex max-h-[92dvh] w-full max-w-160 flex-col rounded-b-none sm:rounded-b-card"
            >
              <div className="flex items-start justify-between gap-3 border-b border-sand px-5 py-4">
                <div className="min-w-0">
                  <h2 id={`book-${purchaseId}`} className="m-0 text-[22px] font-semibold leading-[1.3] text-teal">
                    {picked ? 'Confirm the presentation' : 'Book presentation'}
                  </h2>
                  <p className="m-0 text-[14px] text-ink-muted">
                    {clientLabel} · {testName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-mist hover:text-teal"
                >
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {error && (
                  <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />} className="mb-4">
                    {error}
                  </Notice>
                )}

                {picked ? (
                  <dl className="m-0 grid gap-2 text-[15px]">
                    {[
                      ['Client', clientLabel],
                      ['Assessment', testName],
                      ['Counsellor', picked.counsellorName],
                      ['Date and time', presentationLabel(picked.date, picked.start, picked.end)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 border-b border-sand pb-2 last:border-0">
                        <dt className="text-ink-muted">{k}</dt>
                        <dd className="m-0 text-right font-medium text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : loading ? (
                  <p className="m-0 text-ink-muted">Loading free slots…</p>
                ) : days.length === 0 ? (
                  <p className="m-0 text-ink-muted">No free slots in the next 3 working days. Ask a super admin to add availability.</p>
                ) : (
                  <>
                  <p className="m-0 mb-4 text-[14px] text-ink-muted">Free slots in the next 3 working days.</p>
                  <ol className="m-0 grid list-none gap-5 p-0">
                    {days.map((d) => (
                      <li key={d.date}>
                        <div className="mb-2 flex items-center gap-2">
                          <h3 className="m-0 text-[16px] font-semibold text-ink">{dayLabel(d.date)}</h3>
                          {d.preferred && <Pill>Preferred</Pill>}
                        </div>
                        <div className="grid gap-3">
                          {d.counsellors.map((c) => (
                            <div key={c.id}>
                              <p className="m-0 mb-1.5 text-[14px] font-medium text-ink-soft">{c.name}</p>
                              <div className="flex flex-wrap gap-2">
                                {c.slots.map((s) => (
                                  <button
                                    key={s.start}
                                    type="button"
                                    onClick={() => setPicked({ counsellorId: c.id, counsellorName: c.name, date: d.date, start: s.start, end: s.end })}
                                    className={cn(
                                      'min-h-11 rounded-full border px-4 text-[14px] font-semibold transition-colors hover:bg-mist',
                                      d.preferred ? 'border-teal text-teal' : 'border-sand text-ink-soft hover:text-teal'
                                    )}
                                  >
                                    {slotRange(s.start, s.end)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                  </>
                )}
              </div>

              {picked && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand px-5 py-4">
                  <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                    <ArrowLeft size={16} strokeWidth={2} aria-hidden />
                    Other slot
                  </Button>
                  <Button onClick={confirm} loading={saving} loadingText="Booking...">
                    Book
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </Portal>
      )}
    </>
  );
}
