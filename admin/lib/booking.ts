// Book presentation (step 4): grouping the free slots for the picker, and the words. No database access; the
// database lists the free slots (free_presentation_slots()) and books (presentation_book(), refuses a double booking).

import { dayLabel, slotRange } from './availability';

export interface FreeSlotRow {
  counsellor_id: string;
  counsellor_name: string;
  on_date: string;
  start_time: string;
  end_time: string;
}

export interface FreeDay {
  date: string;
  /** The next 2 dates that have free slots. Later dates can still be picked, no reason needed. */
  preferred: boolean;
  counsellors: { id: string; name: string; slots: { start: string; end: string }[] }[];
}

export const PREFERRED_DAYS = 2;
/** How far ahead the picker looks. */
export const BOOKING_DAYS_AHEAD = 30;

/** Free slots grouped by date, then counsellor (by name), slots in time order. */
export function groupFreeSlots(rows: FreeSlotRow[], preferredDays = PREFERRED_DAYS): FreeDay[] {
  const days = new Map<string, Map<string, FreeDay['counsellors'][number]>>();
  const sorted = [...rows].sort(
    (a, b) => a.on_date.localeCompare(b.on_date) || a.counsellor_name.localeCompare(b.counsellor_name) || a.start_time.localeCompare(b.start_time)
  );
  for (const r of sorted) {
    const day = days.get(r.on_date) ?? new Map();
    const c = day.get(r.counsellor_id) ?? { id: r.counsellor_id, name: r.counsellor_name, slots: [] };
    c.slots.push({ start: r.start_time, end: r.end_time });
    day.set(r.counsellor_id, c);
    days.set(r.on_date, day);
  }
  return [...days.entries()].map(([date, counsellors], i) => ({ date, preferred: i < preferredDays, counsellors: [...counsellors.values()] }));
}

/** "Mon, 23 Nov 2026, 10:00–10:30 am": the whole slot, start to end. */
export function presentationLabel(date: string, start: string, end: string | null): string {
  return `${dayLabel(date)}, ${slotRange(start, end)}`;
}

/** Booked presentation of a purchase, as the screens show it. */
export interface Presentation {
  id: string;
  counsellor_id: string;
  counsellor_name: string | null;
  on_date: string;
  start_time: string;
  end_time: string;
  booked_at: string;
  booked_by_name: string | null;
  /** Report presentation done (step 5): when and by whom. */
  done_at: string | null;
  done_by_name: string | null;
}

export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 300;
