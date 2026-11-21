'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, X } from 'lucide-react';
import { Button, Card, Notice, cn, helpTextClasses, inputClasses, labelClasses } from '../brand';
import {
  choicesFor,
  choiceLabel,
  CALL_KIND_LABELS,
  CALL_NOTE_MAX,
  CALL_REASONS,
  CALL_REASON_LABELS,
  FOLLOW_UP_WORKING_HOURS,
  NEEDS_EARLIER_CALL,
  addWorkingHours,
  needsFollowUp,
  toIstInput,
  type CallChoice,
  type CallKind,
  type CallReason,
} from '../../lib/calls';
import { markCallAction } from '../../app/tasks/actions';

const latest = (d: Date) =>
  d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const OPTION =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-input border px-3.5 text-[15px] text-ink has-[:checked]:border-teal has-[:checked]:bg-mist';

// "Mark as call done": one dialog for both calls. Done · Call later / Not picked (follow-up within 2 working days)
// · Not interested (after at least one earlier call; a reason). A note on every choice. The database checks again.
export function CallDoneButton({
  callId,
  kind,
  priorCalls,
  variant = 'secondary',
  className,
}: {
  callId: string;
  kind: CallKind;
  priorCalls: number;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<CallChoice | ''>('');
  const [reason, setReason] = useState<CallReason | ''>('');
  const [followUp, setFollowUp] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [limits, setLimits] = useState({ min: '', max: '', maxText: '' });

  const start = () => {
    const now = new Date();
    const max = addWorkingHours(now, FOLLOW_UP_WORKING_HOURS);
    setLimits({ min: toIstInput(now), max: toIstInput(max), maxText: latest(max) });
    setChoice('');
    setReason('');
    setFollowUp('');
    setNote('');
    setError(null);
    setOpen(true);
  };

  const blocked = choice === 'not_interested' && priorCalls < 1;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice || blocked) return;
    setSaving(true);
    setError(null);
    const res = await markCallAction({ callId, choice, reason: reason || null, note, followUp: followUp || null });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'The call could not be saved.');
      return;
    }
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button variant={variant} size="sm" onClick={start} className={cn('whitespace-nowrap', className)}>
        Mark as call done
      </Button>

      {open && (
        <div className="fixed inset-0 z-60 flex items-end justify-center bg-night/40 p-0 sm:items-center sm:p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-labelledby={`call-done-${callId}`}
            className="max-h-[92dvh] w-full max-w-120 overflow-y-auto rounded-b-none p-5 sm:rounded-b-card sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id={`call-done-${callId}`} className="m-0 text-[22px] font-semibold leading-[1.3] text-teal">
                  Mark as call done
                </h2>
                <p className="m-0 text-[14px] text-ink-muted">{CALL_KIND_LABELS[kind]}</p>
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

            {error && (
              <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />} className="mb-4">
                {error}
              </Notice>
            )}

            <form onSubmit={save} className="space-y-4">
              <fieldset>
                <legend className={labelClasses}>What happened?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {choicesFor(kind).map((c) => (
                    <label key={c} className={cn(OPTION, 'border-sand')}>
                      <input
                        type="radio"
                        name="choice"
                        value={c}
                        checked={choice === c}
                        onChange={() => setChoice(c)}
                        className="h-4 w-4 accent-teal"
                        required
                      />
                      {choiceLabel(kind, c)}
                    </label>
                  ))}
                </div>
              </fieldset>

              {choice && needsFollowUp(choice) && (
                <div>
                  <label htmlFor={`follow-up-${callId}`} className={labelClasses}>
                    Follow-up date and time
                  </label>
                  <input
                    id={`follow-up-${callId}`}
                    type="datetime-local"
                    required
                    min={limits.min}
                    max={limits.max}
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    className={inputClasses}
                  />
                  <p className={helpTextClasses}>
                    Within 2 working days: by {limits.maxText}.{" "}
                    {choice === "agreed" ? "The call stays open until the package payment arrives." : "The call stays open until then."}
                  </p>
                </div>
              )}

              {choice === 'not_interested' &&
                (blocked ? (
                  <Notice variant="info" role="status">
                    {NEEDS_EARLIER_CALL}
                  </Notice>
                ) : (
                  <fieldset>
                    <legend className={labelClasses}>Reason</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {CALL_REASONS.map((r) => (
                        <label key={r} className={cn(OPTION, 'border-sand')}>
                          <input
                            type="radio"
                            name="reason"
                            value={r}
                            checked={reason === r}
                            onChange={() => setReason(r)}
                            className="h-4 w-4 accent-teal"
                            required
                          />
                          {CALL_REASON_LABELS[r]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}

              <div>
                <label htmlFor={`note-${callId}`} className={labelClasses}>
                  Note (optional)
                </label>
                <textarea
                  id={`note-${callId}`}
                  rows={3}
                  maxLength={CALL_NOTE_MAX}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={cn(inputClasses, 'py-2.5')}
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving} loadingText="Saving..." disabled={!choice || blocked}>
                  Save
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
