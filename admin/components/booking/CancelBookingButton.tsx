'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Button, Notice, cn, helpTextClasses, inputClasses, labelClasses } from '../brand';
import { CANCEL_REASON_MAX } from '../../lib/booking';
import { cancelBookingAction } from '../../app/tasks/booking-actions';

// Super admins only: "Cancel booking" with a required reason, to fix mistakes. It frees the slot and reopens the
// Booking call (due 2 working hours). No reschedule or no-show here.
export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await cancelBookingAction(bookingId, reason);
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'The booking could not be cancelled.');
      return;
    }
    setOpen(false);
    router.refresh();
  };

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="w-fit">
        Cancel booking
      </Button>
    );
  }
  return (
    <form onSubmit={save} className="grid gap-3 rounded-card border border-sand bg-cream p-4">
      {error && (
        <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
          {error}
        </Notice>
      )}
      <div>
        <label htmlFor={`cancel-${bookingId}`} className={labelClasses}>
          Why cancel this booking?
        </label>
        <textarea
          id={`cancel-${bookingId}`}
          rows={2}
          required
          minLength={3}
          maxLength={CANCEL_REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={cn(inputClasses, 'py-2.5')}
        />
        <p className={helpTextClasses}>The slot becomes free and the Booking call opens again, due in 2 working hours.</p>
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Keep booking
        </Button>
        <Button type="submit" size="sm" loading={saving} loadingText="Cancelling...">
          Cancel booking
        </Button>
      </div>
    </form>
  );
}
