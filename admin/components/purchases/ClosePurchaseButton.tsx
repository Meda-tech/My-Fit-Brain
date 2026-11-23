'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Notice, cn, helpTextClasses, inputClasses, labelClasses } from '../brand';
import { CLOSE_REASON_MAX, CLOSE_REASON_MIN } from '../../lib/purchases';
import { closePurchaseAction } from '../../app/purchases/close-actions';

// "Close purchase" (owner, 2026-11-23): super admins, and coordinators for their own clients. Reason required. The
// purchase is then finished: its open calls close, and a new payment of this number starts a new purchase.
export function ClosePurchaseButton({ purchaseId }: { purchaseId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await closePurchaseAction(purchaseId, reason);
    setSaving(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setOpen(false);
  };

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="w-fit">
        Close purchase
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
        <label htmlFor={`close-${purchaseId}`} className={labelClasses}>
          Why close this purchase?
        </label>
        <textarea
          id={`close-${purchaseId}`}
          rows={2}
          required
          minLength={CLOSE_REASON_MIN}
          maxLength={CLOSE_REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={cn(inputClasses, 'py-2.5')}
        />
        <p className={helpTextClasses}>
          Its open calls close. If this number pays for this assessment again, that starts a new purchase.
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Keep open
        </Button>
        <Button type="submit" size="sm" loading={saving} loadingText="Closing...">
          Close purchase
        </Button>
      </div>
    </form>
  );
}
