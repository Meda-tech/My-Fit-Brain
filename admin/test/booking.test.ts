import { describe, expect, it } from 'vitest';
import { bookingContext } from '../lib/calls';
import { groupFreeSlots, presentationLabel } from '../lib/booking';

const row = (on_date: string, counsellor_name: string, start_time: string) => ({
  counsellor_id: counsellor_name === 'Asha' ? 'a' : 'b',
  counsellor_name,
  on_date,
  start_time,
  end_time: start_time.replace(':00:', ':30:'),
});

describe('book presentation', () => {
  it('groups free slots by date, then counsellor; the first 2 dates are Preferred', () => {
    const days = groupFreeSlots([
      row('2026-11-24', 'Bina', '10:00:00'),
      row('2026-11-23', 'Bina', '11:00:00'),
      row('2026-11-23', 'Asha', '10:00:00'),
      row('2026-11-23', 'Asha', '09:00:00'),
      row('2026-11-26', 'Asha', '09:00:00'),
    ]);
    expect(days.map((d) => [d.date, d.preferred])).toEqual([
      ['2026-11-23', true],
      ['2026-11-24', true],
      ['2026-11-26', false],
    ]);
    expect(days[0].counsellors.map((c) => c.name)).toEqual(['Asha', 'Bina']);
    expect(days[0].counsellors[0].slots.map((s) => s.start)).toEqual(['09:00:00', '10:00:00']);
  });

  it('labels', () => {
    expect(presentationLabel('2026-11-23', '10:00:00')).toBe('Mon, 23 Nov 2026, 10:00');
    expect(bookingContext('2026-11-20T08:00:00Z')).toBe('Assessment completed 20 Nov');
  });
});
