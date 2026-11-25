'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Card, Notice, cn, inputClasses, labelClasses } from '../brand';
import { activeCounsellorsAction, markPresentationDoneByAdminAction } from '../../app/presentations/actions';
import { istToday } from '../../lib/availability';
import { Portal } from '../Portal';

// "Mark report presentation done" on an OLD paid purchase (before the system) that has no booking: super admins only
// (owner, 2026-11-21). Choose the counsellor (the only active one is pre-selected) and the date it happened (today
// by default, earlier dates allowed). No slot is used. The database checks every rule again; from then on the
// purchase works like a new one: package offer in the client app, Package call for the coordinator, the client
// assigned to the counsellor.
export function AdminPresentationDoneButton({
  purchaseId,
  clientLabel,
  testName,
  variant = 'primary',
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
  const [counsellors, setCounsellors] = useState<{ id: string; full_name: string }[]>([]);
  const [counsellorId, setCounsellorId] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = istToday();

  const show = async () => {
    setError(null);
    setDate(today);
    setCounsellorId('');
    setOpen(true);
    setLoading(true);
    const list = await activeCounsellorsAction();
    setCounsellors(list);
    if (list.length === 1) setCounsellorId(list[0].id);
    setLoading(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!counsellorId) return setError('Choose the counsellor.');
    if (!date || date > today) return setError('Choose today or an earlier date.');
    setSaving(true);
    setError(null);
    const res = await markPresentationDoneByAdminAction({ purchaseId, counsellorId, date });
    setSaving(false);
    if (!res.success) return setError(res.error ?? 'It could not be saved.');
    setOpen(false);
  };

  return (
    <>
      <Button variant={variant} size="sm" onClick={show} className={cn('whitespace-nowrap', className)}>
        Mark report presentation done
      </Button>
      {open && (
        <Portal>
          <div className="fixed inset-0 z-60 flex items-end justify-center bg-night/40 sm:items-center sm:p-4">
            <Card
              role="dialog"
              aria-modal="true"
              aria-labelledby={`admin-done-${purchaseId}`}
              className="max-h-[90dvh] w-full max-w-110 overflow-y-auto rounded-b-none p-5 sm:rounded-b-card sm:p-6"
            >
              <h2 id={`admin-done-${purchaseId}`} className="m-0 text-[22px] font-semibold leading-[1.3] text-teal">
                Mark report presentation done
              </h2>
              <p className="m-0 mt-1 text-[15px] text-ink">
                {clientLabel} · {testName}
              </p>
              <p className="m-0 mt-2 text-[14px] text-ink-soft">
                Only for a presentation that already happened outside the system. No slot is used.
              </p>

              {loading ? (
                <p className="m-0 mt-4 text-ink-muted">Loading counsellors…</p>
              ) : counsellors.length === 0 ? (
                <>
                  <p className="m-0 mt-4 text-[14px] text-ink">There is no active counsellor. Add one in Team first.</p>
                  <div className="mt-5 flex justify-end">
                    <Button variant="secondary" onClick={() => setOpen(false)}>
                      Close
                    </Button>
                  </div>
                </>
              ) : (
                <form onSubmit={save} className="mt-4 space-y-4">
                  <div>
                    <label htmlFor={`admin-done-counsellor-${purchaseId}`} className={labelClasses}>
                      Counsellor who presented the report
                    </label>
                    <select
                      id={`admin-done-counsellor-${purchaseId}`}
                      required
                      value={counsellorId}
                      onChange={(e) => setCounsellorId(e.target.value)}
                      className={inputClasses}
                    >
                      <option value="" disabled>
                        Choose one
                      </option>
                      {counsellors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`admin-done-date-${purchaseId}`} className={labelClasses}>
                      Date it happened
                    </label>
                    <input
                      id={`admin-done-date-${purchaseId}`}
                      type="date"
                      required
                      max={today}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className={inputClasses}
                    />
                  </div>
                  <p className="m-0 text-[14px] text-ink-soft">
                    After this the client sees the package offer in the app, the coordinator gets a Package call (due in
                    2 working hours) and this counsellor can see the client. This cannot be undone.
                  </p>
                  {error && (
                    <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
                      {error}
                    </Notice>
                  )}
                  <div className="flex flex-wrap justify-end gap-3">
                    <Button variant="secondary" onClick={() => setOpen(false)}>
                      Not yet
                    </Button>
                    <Button type="submit" loading={saving} loadingText="Saving...">
                      Yes, it is done
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          </div>
        </Portal>
      )}
    </>
  );
}
