'use client';

import { inputClasses } from './brand';
import { dayTimes } from '../lib/availability';

// A time of day as a dropdown with 12-hour labels ("9:00 am", "1:30 pm"). The browser's own time field shows 12 or
// 24 hours depending on the computer, so the screens use this instead (owner, 2026-11-21: 12-hour times only).
// The value is "HH:MM" (24-hour, for the server).
export function TimeSelect({
  id,
  value,
  onChange,
  step = 30,
  required = false,
  placeholder = 'Choose a time',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Minutes between choices. */
  step?: number;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <select id={id} required={required} value={value} onChange={(e) => onChange(e.target.value)} className={inputClasses}>
      <option value="" disabled>
        {placeholder}
      </option>
      {dayTimes(step).map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
