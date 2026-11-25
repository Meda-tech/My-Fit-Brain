'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, Plus, X } from 'lucide-react';
import { Button, Notice, helpTextClasses, inputClasses, labelClasses } from '../brand';
import { savePackageAmountsAction } from '../../app/purchases/package-actions';
import { MAX_MILESTONES, rupees, type PackageSettings } from '../../lib/package';

// Package amounts (super admins): the smallest first payment, the amount paid in total that starts the package
// (handover to CRM), and the milestones (paid in total before a session). Milestones are stored and shown only; they
// are not enforced yet. Everything is typed in whole rupees; the database checks again.
export function PackageAmountsForm({ settings, assessmentPrice }: { settings: PackageSettings; assessmentPrice: number }) {
  const [firstMin, setFirstMin] = useState(String(settings.first_min_paise / 100));
  const [start, setStart] = useState(String(settings.start_paise / 100));
  const [rows, setRows] = useState(settings.milestones.map((m) => ({ session: String(m.session), amount: String(m.paid_paise / 100) })));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const totalPaise = settings.price_paise - assessmentPrice * 100;
  const digits = (v: string) => v.replace(/[^\d,]/g, '');
  const setRow = (i: number, key: 'session' | 'amount', value: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: key === 'session' ? value.replace(/\D/g, '') : digits(value) } : row)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await savePackageAmountsAction({ firstMin, start, milestones: rows });
    setSaving(false);
    if (!res.success) return setError(res.error ?? 'The package amounts could not be saved.');
    setSaved(true);
  };

  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      {error && (
        <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />} className="sm:col-span-2">
          {error}
        </Notice>
      )}
      {saved && (
        <Notice variant="info" role="status" icon={<CheckCircle2 size={18} strokeWidth={2} />} className="sm:col-span-2">
          Saved. New payments use these amounts.
        </Notice>
      )}
      <p className="m-0 rounded-card border border-sand bg-cream p-4 text-[14px] text-ink-soft sm:col-span-2">
        Package amount after the ₹{assessmentPrice.toLocaleString('en-IN')} advance:{' '}
        <span className="font-semibold text-teal">{rupees(totalPaise)}</span>. It can be paid in parts.
      </p>
      <div>
        <label htmlFor="pkg-first-min" className={labelClasses}>
          First payment minimum (₹)
        </label>
        <input id="pkg-first-min" required inputMode="numeric" maxLength={9} value={firstMin} onChange={(e) => setFirstMin(digits(e.target.value))} className={inputClasses} />
        <p className={helpTextClasses}>The booking amount. Later payments can be any amount up to the remaining balance.</p>
      </div>
      <div>
        <label htmlFor="pkg-start" className={labelClasses}>
          Start amount (₹)
        </label>
        <input id="pkg-start" required inputMode="numeric" maxLength={9} value={start} onChange={(e) => setStart(digits(e.target.value))} className={inputClasses} />
        <p className={helpTextClasses}>Paid in total to start: the package then goes to the CRM team.</p>
      </div>

      <fieldset className="m-0 border-0 p-0 sm:col-span-2">
        <legend className={labelClasses}>Milestones</legend>
        <p className={`${helpTextClasses} mt-0 mb-2`}>Paid in total before a session. Shown to the team only; not enforced yet.</p>
        <ul className="m-0 grid list-none gap-2 p-0">
          {rows.map((row, i) => (
            <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <div>
                <label htmlFor={`pkg-ms-amount-${i}`} className="mb-1 block text-[13px] text-ink-muted">
                  Paid in total (₹)
                </label>
                <input id={`pkg-ms-amount-${i}`} inputMode="numeric" maxLength={9} value={row.amount} onChange={(e) => setRow(i, 'amount', e.target.value)} className={inputClasses} />
              </div>
              <div>
                <label htmlFor={`pkg-ms-session-${i}`} className="mb-1 block text-[13px] text-ink-muted">
                  Before session
                </label>
                <input id={`pkg-ms-session-${i}`} inputMode="numeric" maxLength={3} value={row.session} onChange={(e) => setRow(i, 'session', e.target.value)} className={inputClasses} />
              </div>
              <button
                type="button"
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                aria-label={`Remove milestone ${i + 1}`}
                className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft hover:bg-mist hover:text-teal"
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        {rows.length < MAX_MILESTONES && (
          <button
            type="button"
            onClick={() => setRows((r) => [...r, { session: '', amount: '' }])}
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-semibold text-teal hover:underline"
          >
            <Plus size={16} strokeWidth={2} aria-hidden />
            Add milestone
          </button>
        )}
      </fieldset>

      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" loading={saving} loadingText="Saving...">
          Save amounts
        </Button>
      </div>
    </form>
  );
}
