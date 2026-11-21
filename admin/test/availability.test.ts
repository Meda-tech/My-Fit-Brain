import { describe, expect, it } from 'vitest';
import {
  addMonths,
  countByDay,
  dayLabel,
  describeChange,
  describeSettings,
  hm,
  twelveHourText,
  dayTimes,
  isDate,
  isMonth,
  istToday,
  monthGrid,
  monthLabel,
  monthRange,
} from '../lib/availability';

describe('availability words', () => {
  it('describes the default and the changes in the team words', () => {
    expect(
      describeSettings({
        slot_minutes: 30,
        gap_minutes: 0,
        work_days: [1, 2, 3, 4, 5, 6],
        day_start: '09:00:00',
        day_end: '18:00:00',
        lunch_start: '13:00:00',
        lunch_end: '13:30:00',
      })
    ).toBe('30-minute slots, Monday–Saturday, 9:00 am–6:00 pm, lunch 1:00 pm–1:30 pm');
    expect(describeChange({ kind: 'off', start_time: null, end_time: null })).toBe('Off all day');
    expect(describeChange({ kind: 'off', start_time: '14:00:00', end_time: '16:00:00' })).toBe('Off 2:00 pm–4:00 pm');
    expect(describeChange({ kind: 'custom', start_time: '18:00:00', end_time: '18:30:00' })).toBe('Custom slots 6:00 pm–6:30 pm');
    expect(hm('09:30:00')).toBe('9:30 am');
    expect([hm('00:00'), hm('12:00'), hm('12:30:00'), hm('23:45')]).toEqual(['12:00 am', '12:00 pm', '12:30 pm', '11:45 pm']);
    expect(twelveHourText('Test Counsellor, Mon 23 Nov 2026, 14:00 · Booked wrong')).toBe('Test Counsellor, Mon 23 Nov 2026, 2:00 pm · Booked wrong');
    expect(twelveHourText('Mon 23 Nov 2026, 2:00 pm')).toBe('Mon 23 Nov 2026, 2:00 pm');
    const times = dayTimes(30);
    expect(times).toHaveLength(48);
    expect(times.slice(0, 2)).toEqual([{ value: '00:00', label: '12:00 am' }, { value: '00:30', label: '12:30 am' }]);
    expect(times[27]).toEqual({ value: '13:30', label: '1:30 pm' });
  });
});

describe('calendar', () => {
  it('November 2026 starts on a Sunday: six leading blanks, Monday-first weeks', () => {
    const weeks = monthGrid('2026-11');
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[1][0]).toBe('2026-11-02');
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('months, ranges, labels and checks', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(dayLabel('2026-11-23')).toBe('Mon, 23 Nov 2026');
    expect(isMonth('2026-13')).toBe(false);
    expect(isDate('2026-11-23') && !isDate('23-11-2026')).toBe(true);
    expect(istToday(new Date('2026-11-20T20:00:00Z'))).toBe('2026-11-21'); // 1:30 am India time
  });

  it('counts free / booked / off per date', () => {
    const c = countByDay([
      { on_date: '2026-11-23', state: 'free' },
      { on_date: '2026-11-23', state: 'off' },
      { on_date: '2026-11-23', state: 'free' },
      { on_date: '2026-11-24', state: 'booked' },
    ]);
    expect(c.get('2026-11-23')).toEqual({ free: 2, booked: 0, off: 1 });
    expect(c.get('2026-11-24')).toEqual({ free: 0, booked: 1, off: 0 });
  });
});
