'use client';

import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button, Card, Notice, cn, helpTextClasses, inputClasses, labelClasses } from '../brand';
import {
  CALL_CHOICES,
  CALL_CHOICE_LABELS,
  CALL_KIND_LABELS,
  CALL_NOTE_MAX,
  CALL_REASONS,
  CALL_REASON_LABELS,
  CALLS_BEFORE_NOT_INTERESTED,
  FOLLOW_UP_WORKING_HOURS,
  NEEDS_EARLIER_CALL,
  addWorkingHours,
  dueLabel,
  followUpIn2Hours,
  followUpTomorrow,
  needsFollowUp,
  toIstInput,
  type CallChoice,
  type CallKind,
  type CallReason,
} from '../../lib/calls';
import { markCallAction } from '../../app/tasks/actions';
import { TimeSelect } from '../TimeSelect';

const latest = (d: Date) =>
  d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

const OPTION =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-input border px-3.5 text-[15px] text-ink has-[:checked]:border-teal has-[:checked]:bg-mist';
const QUICK =
  'min-h-11 rounded-full border px-4 text-[14px] font-medium transition-colors border-sand text-ink-soft hover:border-teal hover:text-teal';
const QUICK_ON = 'border-teal bg-mist text-teal';

type FollowMode = 'in2h' | 'tomorrow' | 'pick';
const FOLLOW_MODES: { mode: FollowMode; label: string }[] = [
  { mode: 'in2h', label: 'In 2 hours' },
  { mode: 'tomorrow', label: 'Tomorrow' },
  { mode: 'pick', label: 'Pick date & time' },
];

// "Mark as call done", the same on every call (owner, 2026-11-23): Talked to client · Not picked / Call later (both
// with a follow-up within 2 working days; quick buttons In 2 hours (working hours) · Tomorrow (next working day, same
// time) · Pick date & time) · Not interested (after at least 2 calls; a reason). No Done: a call closes by itself when
// the client does the step. A note on every choice. The database checks again.
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
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<CallChoice | ''>('');
  const [reason, setReason] = useState<CallReason | ''>('');
  const [mode, setMode] = useState<FollowMode>('in2h');
  const [quick, setQuick] = useState<{ in2h: string; tomorrow: string }>({ in2h: '', tomorrow: '' });
  const [followDate, setFollowDate] = useState('');
  const [followTime, setFollowTime] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [limits, setLimits] = useState({ min: '', max: '', maxText: '' });
  const [now, setNow] = useState(() => new Date());

  // The same value the server reads: "YYYY-MM-DDTHH:MM", India time.
  const followUp = mode === 'pick' ? (followDate && followTime ? `${followDate}T${followTime}` : '') : quick[mode];

  const start = () => {
    const at = new Date();
    const max = addWorkingHours(at, FOLLOW_UP_WORKING_HOURS);
    setNow(at);
    setLimits({ min: toIstInput(at), max: toIstInput(max), maxText: latest(max) });
    setQuick({ in2h: toIstInput(followUpIn2Hours(at)), tomorrow: toIstInput(followUpTomorrow(at)) });
    setChoice('');
    setReason('');
    setMode('in2h');
    setFollowDate('');
    setFollowTime('');
    setNote('');
    setError(null);
    setOpen(true);
  };

  const pickChoice = (c: CallChoice) => {
    setChoice(c);
    // Default follow-up: In 2 hours (owner, 2026-11-23).
    if (needsFollowUp(c) && choice !== c) setMode('in2h');
  };

  const blocked = choice === 'not_interested' && priorCalls < CALLS_BEFORE_NOT_INTERESTED;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice || blocked) return;
    // Quick check here ("YYYY-MM-DDTHH:MM" strings compare in time order); the server checks again.
    if (needsFollowUp(choice) && (!followUp || followUp <= limits.min || followUp > limits.max)) {
      setError(`Pick a follow-up date and time within 2 working days (by ${limits.maxText}).`);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await markCallAction({
      callId,
      choice,
      reason: reason || null,
      note,
      followUp: needsFollowUp(choice) ? followUp : null,
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'The call could not be saved.');
      return;
    }
    setOpen(false);
  };

  // "Today, 5:30 pm" for the chosen follow-up.
  const followText = followUp ? dueLabel(new Date(`${followUp}:00+05:30`).toISOString(), now) : null;

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
                <div className="grid gap-2">
                  {CALL_CHOICES.map((c) => (
                    <label key={c} className={cn(OPTION, 'border-sand')}>
                      <input
                        type="radio"
                        name="choice"
                        value={c}
                        checked={choice === c}
                        onChange={() => pickChoice(c)}
                        className="h-4 w-4 accent-teal"
                        required
                      />
                      {CALL_CHOICE_LABELS[c]}
                    </label>
                  ))}
                </div>
              </fieldset>

              {choice && needsFollowUp(choice) && (
                <div>
                  <span className={labelClasses}>Follow-up</span>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Follow-up">
                    {FOLLOW_MODES.map((m) => (
                      <button
                        key={m.mode}
                        type="button"
                        aria-pressed={mode === m.mode}
                        onClick={() => setMode(m.mode)}
                        className={cn(QUICK, mode === m.mode && QUICK_ON)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {mode === 'pick' && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`follow-up-date-${callId}`} className="sr-only">
                          Follow-up date
                        </label>
                        <input
                          id={`follow-up-date-${callId}`}
                          type="date"
                          required
                          min={limits.min.slice(0, 10)}
                          max={limits.max.slice(0, 10)}
                          value={followDate}
                          onChange={(e) => setFollowDate(e.target.value)}
                          className={inputClasses}
                        />
                      </div>
                      <div>
                        <label htmlFor={`follow-up-time-${callId}`} className="sr-only">
                          Follow-up time
                        </label>
                        <TimeSelect id={`follow-up-time-${callId}`} required step={15} value={followTime} onChange={setFollowTime} />
                      </div>
                    </div>
                  )}
                  <p className={helpTextClasses}>
                    {followText ? (
                      <>
                        Next call: <span className="font-semibold text-ink">{followText}</span>.{' '}
                      </>
                    ) : null}
                    Within 2 working days (by {limits.maxText}). The call stays open until the client does the step.
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
