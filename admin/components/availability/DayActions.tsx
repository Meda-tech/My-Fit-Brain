'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Notice, cn, helpTextClasses, inputClasses, labelClasses } from '../brand';
import { addAvailabilityAction, undoAvailabilityAction } from '../../app/availability/actions';

const OPTION =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-input border border-sand px-3.5 text-[15px] text-ink has-[:checked]:border-teal has-[:checked]:bg-mist';

function ErrorNotice({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
      {error}
    </Notice>
  );
}

function TimeRange({ start, end, onStart, onEnd, idPrefix }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void; idPrefix: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label htmlFor={`${idPrefix}-from`} className={labelClasses}>
          From
        </label>
        <input id={`${idPrefix}-from`} type="time" step={1800} required value={start} onChange={(e) => onStart(e.target.value)} className={inputClasses} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-to`} className={labelClasses}>
          To
        </label>
        <input id={`${idPrefix}-to`} type="time" step={1800} required value={end} onChange={(e) => onEnd(e.target.value)} className={inputClasses} />
      </div>
    </div>
  );
}

// The two changes on a date: Mark off (whole day or a time range, optional reason) and Add custom slots (a time
// range split into slots). One form open at a time; the database checks every rule again.
export function DayActions({ counsellorId, date, slotMinutes }: { counsellorId: string; date: string; slotMinutes: number }) {
  const [mode, setMode] = useState<'off' | 'custom' | null>(null);
  const [wholeDay, setWholeDay] = useState(true);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const open = (m: 'off' | 'custom') => {
    setMode(m);
    setWholeDay(m === 'off');
    setStart('');
    setEnd('');
    setReason('');
    setError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode) return;
    setSaving(true);
    setError(null);
    const range = mode === 'off' && wholeDay ? { start: null, end: null } : { start, end };
    const res = await addAvailabilityAction({ counsellorId, kind: mode, date, ...range, reason: mode === 'off' ? reason : null });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'The change could not be saved.');
      return;
    }
    setMode(null);
  };

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => open('off')}>
          Mark off
        </Button>
        <Button size="sm" variant="secondary" onClick={() => open('custom')}>
          Add custom slots
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="grid gap-4 rounded-card border border-sand bg-cream p-4">
      <p className="m-0 font-semibold text-ink">{mode === 'off' ? 'Mark off' : 'Add custom slots'}</p>
      <ErrorNotice error={error} />

      {mode === 'off' ? (
        <>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">What to mark off</legend>
            <label className={OPTION}>
              <input type="radio" name="off-kind" checked={wholeDay} onChange={() => setWholeDay(true)} className="h-4 w-4 accent-teal" />
              Whole day
            </label>
            <label className={OPTION}>
              <input type="radio" name="off-kind" checked={!wholeDay} onChange={() => setWholeDay(false)} className="h-4 w-4 accent-teal" />
              Time range
            </label>
          </fieldset>
          {!wholeDay && <TimeRange start={start} end={end} onStart={setStart} onEnd={setEnd} idPrefix={`off-${date}`} />}
          <div>
            <label htmlFor={`reason-${date}`} className={labelClasses}>
              Reason (optional)
            </label>
            <input id={`reason-${date}`} type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClasses} placeholder="e.g. Training" />
          </div>
        </>
      ) : (
        <div>
          <TimeRange start={start} end={end} onStart={setStart} onEnd={setEnd} idPrefix={`custom-${date}`} />
          <p className={helpTextClasses}>Split into {slotMinutes}-minute slots, e.g. 10:00–12:00 or 18:00–18:30.</p>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={() => setMode(null)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={saving} loadingText="Saving...">
          Save
        </Button>
      </div>
    </form>
  );
}

/** Undo a Mark off or a custom slot range (refused when any of its slots is booked). */
export function UndoButton({ changeId }: { changeId: string }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = async () => {
    setSaving(true);
    setError(null);
    const res = await undoAvailabilityAction(changeId);
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'It could not be undone.');
      return;
    }
  };
  return (
    <span className="grid justify-items-end gap-1">
      <Button variant="ghost" size="sm" onClick={undo} loading={saving} loadingText="Undoing..." className={cn('whitespace-nowrap')}>
        Undo
      </Button>
      {error && <span className="text-right text-[13px] font-medium text-coral-deep">{error}</span>}
    </span>
  );
}
