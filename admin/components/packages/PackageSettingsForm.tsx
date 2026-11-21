'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button, Notice, helpTextClasses, inputClasses, labelClasses } from '../brand';
import { savePackageAction } from '../../app/purchases/package-actions';
import type { PackageSettings } from '../../lib/package';

// The one active package (super admins): name, sessions, frequency text, price. The client pays the price minus
// what they paid for the assessment; payments already made keep the package as it was sold.
export function PackageSettingsForm({ settings, assessmentPrice }: { settings: PackageSettings; assessmentPrice: number }) {
  const router = useRouter();
  const [name, setName] = useState(settings.name);
  const [sessions, setSessions] = useState(String(settings.sessions));
  const [frequency, setFrequency] = useState(settings.frequency);
  const [price, setPrice] = useState(String(settings.price_paise / 100));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const rupees = Number(price.replace(/[,\s₹]/g, ''));
  const toPay = Number.isFinite(rupees) && rupees > assessmentPrice ? rupees - assessmentPrice : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await savePackageAction({ name, sessions, frequency, price });
    setSaving(false);
    if (!res.success) return setError(res.error ?? 'The package could not be saved.');
    setSaved(true);
    router.refresh();
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
          Saved. New offers and payments use these values.
        </Notice>
      )}
      <div className="sm:col-span-2">
        <label htmlFor="pkg-name" className={labelClasses}>
          Package name
        </label>
        <input id="pkg-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputClasses} />
        <p className={helpTextClasses}>Staff see this name. The client&rsquo;s card says &ldquo;A plan made for you&rdquo;.</p>
      </div>
      <div>
        <label htmlFor="pkg-sessions" className={labelClasses}>
          Number of sessions
        </label>
        <input id="pkg-sessions" required inputMode="numeric" maxLength={3} value={sessions} onChange={(e) => setSessions(e.target.value.replace(/\D/g, ''))} className={inputClasses} />
      </div>
      <div>
        <label htmlFor="pkg-frequency" className={labelClasses}>
          How often
        </label>
        <input id="pkg-frequency" required maxLength={80} value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputClasses} placeholder="1 session every week" />
        <p className={helpTextClasses}>Shown to the client as typed.</p>
      </div>
      <div>
        <label htmlFor="pkg-price" className={labelClasses}>
          Package price (₹)
        </label>
        <input id="pkg-price" required inputMode="numeric" maxLength={9} value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d,]/g, ''))} className={inputClasses} />
      </div>
      <div className="rounded-card border border-sand bg-cream p-4 text-[14px] text-ink-soft">
        <p className="m-0">Already paid for the assessment (advance): ₹{assessmentPrice.toLocaleString('en-IN')}</p>
        <p className="m-0 mt-1 font-semibold text-teal">The client pays now: {toPay === null ? '—' : `₹${toPay.toLocaleString('en-IN')}`}</p>
      </div>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" loading={saving} loadingText="Saving...">
          Save package
        </Button>
      </div>
    </form>
  );
}
