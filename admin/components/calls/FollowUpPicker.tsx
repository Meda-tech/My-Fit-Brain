'use client';

import { useEffect, useState } from 'react';
import { cn, helpTextClasses, inputClasses, labelClasses } from '../brand';
import { addWorkingHours, dueLabel, followUpIn2Hours, followUpTomorrow, toIstInput } from '../../lib/calls';
import { TimeSelect } from '../TimeSelect';

const latest = (d: Date) =>
  d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

const QUICK =
  'min-h-11 rounded-full border px-4 text-[14px] font-medium transition-colors border-sand text-ink-soft hover:border-teal hover:text-teal';
const QUICK_ON = 'border-teal bg-mist text-teal';

export type FollowMode = 'in2h' | 'tomorrow' | 'pick';
const FOLLOW_MODES: { mode: FollowMode; label: string }[] = [
  { mode: 'in2h', label: 'In 2 hours' },
  { mode: 'tomorrow', label: 'Tomorrow' },
  { mode: 'pick', label: 'Pick date & time' },
];

/** What the picker hands to its form: the value the server reads ("YYYY-MM-DDTHH:MM", India time) and a quick check. */
export interface FollowUpState {
  value: string;
  ok: boolean;
  /** "Sat, 28 Nov, 6:00 pm": the latest allowed follow-up, for messages. */
  maxText: string;
}

/**
 * The follow-up of a call: quick buttons In 2 hours (working hours) · Tomorrow (next working day, same time) · Pick
 * date & time, never later than `hours` working hours from now (2 working days on most calls, 3 on the Pending payment
 * call). The limits are fixed when the picker appears; the server checks again.
 */
export function FollowUpPicker({
  id,
  hours,
  limitText,
  label = 'Follow-up',
  defaultMode = 'in2h',
  note,
  onChange,
}: {
  id: string;
  hours: number;
  /** "within 2 working days". */
  limitText: string;
  label?: string;
  defaultMode?: FollowMode;
  /** A sentence after the limit, e.g. "The call stays open until the client does the step." */
  note?: string;
  onChange: (state: FollowUpState) => void;
}) {
  const [at] = useState(() => new Date());
  const [limits] = useState(() => {
    const max = addWorkingHours(at, hours);
    return {
      min: toIstInput(at),
      max: toIstInput(max),
      maxText: latest(max),
      in2h: toIstInput(followUpIn2Hours(at)),
      tomorrow: toIstInput(followUpTomorrow(at)),
    };
  });
  const [mode, setMode] = useState<FollowMode>(defaultMode);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  const value = mode === 'pick' ? (date && time ? `${date}T${time}` : '') : limits[mode];
  // "YYYY-MM-DDTHH:MM" strings compare in time order.
  const ok = !!value && value > limits.min && value <= limits.max;

  useEffect(() => {
    onChange({ value, ok, maxText: limits.maxText });
  }, [value, ok, limits.maxText, onChange]);

  const text = value ? dueLabel(new Date(`${value}:00+05:30`).toISOString(), at) : null;

  return (
    <div>
      <span className={labelClasses}>{label}</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
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
            <label htmlFor={`${id}-date`} className="sr-only">
              {label} date
            </label>
            <input
              id={`${id}-date`}
              type="date"
              required
              min={limits.min.slice(0, 10)}
              max={limits.max.slice(0, 10)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor={`${id}-time`} className="sr-only">
              {label} time
            </label>
            <TimeSelect id={`${id}-time`} required step={15} value={time} onChange={setTime} />
          </div>
        </div>
      )}
      <p className={helpTextClasses}>
        {text ? (
          <>
            Next call: <span className="font-semibold text-ink">{text}</span>.{' '}
          </>
        ) : null}
        {limitText.charAt(0).toUpperCase() + limitText.slice(1)} (by {limits.maxText}).{note ? ` ${note}` : ''}
      </p>
    </div>
  );
}
