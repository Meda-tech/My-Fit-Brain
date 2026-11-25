'use client';

import { useCallback, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button, Card, Notice, cn, inputClasses, labelClasses } from '../brand';
import {
  CALL_CHOICES,
  CALL_CHOICE_LABELS,
  CALL_KIND_LABELS,
  CALL_NOTE_MAX,
  CALL_REASONS,
  CALL_REASON_LABELS,
  CALLS_BEFORE_NOT_INTERESTED,
  NEEDS_EARLIER_CALL,
  PACKAGE_PAID_ADMIN_ONLY,
  followUpLimit,
  needsFollowUp,
  type CallChoice,
  type CallKind,
  type CallReason,
} from '../../lib/calls';
import { markCallAction } from '../../app/tasks/actions';
import { FollowUpPicker, type FollowUpState } from './FollowUpPicker';

const OPTION =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-input border px-3.5 text-[15px] text-ink has-[:checked]:border-teal has-[:checked]:bg-mist';

// "Mark as call done", the same on every call (owner, 2026-11-23): Talked to client · Not picked / Call later (both
// with a follow-up within 2 working days, 3 on the Pending payment call; quick buttons In 2 hours (working hours) ·
// Tomorrow (next working day, same time) · Pick date & time) · Not interested (after at least 2 calls; a reason). No
// Done: a call closes only by itself when the client does the step. A note on every choice. The database checks again.
export function CallDoneButton({
  callId,
  kind,
  priorCalls,
  adminOnlyNotInterested = false,
  variant = 'secondary',
  className,
}: {
  callId: string;
  kind: CallKind;
  priorCalls: number;
  /** A Package or Pending payment call with a package amount already paid, opened by someone who is not a super admin. */
  adminOnlyNotInterested?: boolean;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<CallChoice | ''>('');
  const [reason, setReason] = useState<CallReason | ''>('');
  const [follow, setFollow] = useState<FollowUpState>({ value: '', ok: false, maxText: '' });
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const limit = followUpLimit(kind);
  const onFollow = useCallback((s: FollowUpState) => setFollow(s), []);

  const start = () => {
    setChoice('');
    setReason('');
    setNote('');
    setError(null);
    setOpen(true);
  };

  const adminOnly = choice === 'not_interested' && adminOnlyNotInterested;
  const blocked = adminOnly || (choice === 'not_interested' && priorCalls < CALLS_BEFORE_NOT_INTERESTED);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice || blocked) return;
    // Quick check here; the server checks again.
    if (needsFollowUp(choice) && !follow.ok) {
      setError(`Pick a follow-up date and time ${limit.text} (by ${follow.maxText}).`);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await markCallAction({
      callId,
      choice,
      reason: reason || null,
      note,
      followUp: needsFollowUp(choice) ? follow.value : null,
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? 'The call could not be saved.');
      return;
    }
    setOpen(false);
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
                <div className="grid gap-2">
                  {CALL_CHOICES.map((c) => (
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
                      {CALL_CHOICE_LABELS[c]}
                    </label>
                  ))}
                </div>
              </fieldset>

              {choice && needsFollowUp(choice) && (
                // A new picker for each choice: the default is In 2 hours again (owner, 2026-11-23).
                <FollowUpPicker
                  key={choice}
                  id={`follow-up-${callId}`}
                  hours={limit.hours}
                  limitText={limit.text}
                  note={kind === 'pending_payment' ? 'The call stays open until the rest is paid.' : 'The call stays open until the client does the step.'}
                  onChange={onFollow}
                />
              )}

              {choice === 'not_interested' &&
                (blocked ? (
                  <Notice variant="info" role="status">
                    {adminOnly ? PACKAGE_PAID_ADMIN_ONLY : NEEDS_EARLIER_CALL}
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
