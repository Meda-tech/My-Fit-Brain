'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Card, Notice, cn } from '../brand';
import { markPresentationDoneAction } from '../../app/presentations/actions';

// "Report presentation done", with a confirm. The database decides who and when (the counsellor from the slot's
// start; super admins at any time) and then creates the Package call for the client's coordinator.
export function PresentationDoneButton({
  bookingId,
  summary,
  variant = 'primary',
  className,
}: {
  bookingId: string;
  /** What is being marked, e.g. "Asha Test · Mon, 23 Nov 2026, 10:00". */
  summary: string;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const res = await markPresentationDoneAction(bookingId);
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'It could not be saved.');
      return;
    }
    setOpen(false);
  };

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => { setError(null); setOpen(true); }} className={cn('whitespace-nowrap', className)}>
        Report presentation done
      </Button>
      {open && (
        <div className="fixed inset-0 z-60 flex items-end justify-center bg-night/40 sm:items-center sm:p-4">
          <Card role="dialog" aria-modal="true" aria-labelledby={`done-${bookingId}`} className="w-full max-w-110 rounded-b-none p-5 sm:rounded-b-card sm:p-6">
            <h2 id={`done-${bookingId}`} className="m-0 text-[22px] font-semibold leading-[1.3] text-teal">
              Report presentation done?
            </h2>
            <p className="m-0 mt-1 text-[15px] text-ink">{summary}</p>
            <p className="m-0 mt-2 text-[14px] text-ink-soft">The coordinator gets a Package call, due in 2 working hours. This cannot be undone.</p>
            {error && (
              <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />} className="mt-4">
                {error}
              </Notice>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Not yet
              </Button>
              <Button onClick={confirm} loading={saving} loadingText="Saving...">
                Yes, it is done
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
