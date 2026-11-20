// Counsellor availability (step 3): the words and the small rules the screen shows. No database access; the
// database turns the default and the changes into slots (counsellor_slots()) and checks every change.

export type SlotState = 'free' | 'booked' | 'off';

export interface Slot {
  on_date: string;
  /** "HH:MM:SS", India time. */
  start_time: string;
  end_time: string;
  state: SlotState;
  custom_change: string | null;
  off_change: string | null;
}

export const SLOT_STATE_LABELS: Record<SlotState, string> = { free: 'Free', booked: 'Booked', off: 'Off' };

export interface AvailabilitySettings {
  slot_minutes: number;
  gap_minutes: number;
  work_days: number[];
  day_start: string;
  day_end: string;
  lunch_start: string | null;
  lunch_end: string | null;
}

export interface AvailabilityChange {
  id: string;
  kind: 'off' | 'custom';
  on_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
  created_by_name: string | null;
  removed_at: string | null;
  removed_by_name: string | null;
}

/** "09:00:00" → "9:00" (24-hour, as the team writes times). */
export function hm(time: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':');
  return `${Number(h)}:${m}`;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "30-minute slots, Monday–Saturday, 9:00–18:00, lunch 13:00–13:30". */
export function describeSettings(s: AvailabilitySettings): string {
  const days = [...s.work_days].sort((a, b) => a - b);
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayText =
    days.length === 0
      ? 'no work days'
      : consecutive && days.length > 1
        ? `${WEEKDAYS[days[0] - 1]}–${WEEKDAYS[days[days.length - 1] - 1]}`
        : days.map((d) => WEEKDAYS[d - 1]).join(', ');
  const parts = [`${s.slot_minutes}-minute slots`, dayText, `${hm(s.day_start)}–${hm(s.day_end)}`];
  if (s.gap_minutes > 0) parts.push(`${s.gap_minutes}-minute gap`);
  if (s.lunch_start && s.lunch_end) parts.push(`lunch ${hm(s.lunch_start)}–${hm(s.lunch_end)}`);
  return parts.join(', ');
}

/** "Off all day" · "Off 14:00–16:00" · "Custom slots 10:00–12:00". */
export function describeChange(c: Pick<AvailabilityChange, 'kind' | 'start_time' | 'end_time'>): string {
  if (c.kind === 'off') return c.start_time ? `Off ${hm(c.start_time)}–${hm(c.end_time)}` : 'Off all day';
  return `Custom slots ${hm(c.start_time)}–${hm(c.end_time)}`;
}

// --- Dates (India calendar dates as "YYYY-MM-DD"; no time zone maths needed once we have today's date) -------

const IST_MS = 330 * 60 * 1000;

export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
}

export function isDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export function isMonth(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** "2026-11" ± n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** "November 2026". */
export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "Mon, 23 Nov 2026". */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const month = d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
  return `${WEEKDAY_SHORT[(d.getUTCDay() + 6) % 7]}, ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/** The month as weeks, Monday first; days outside the month are null. */
export function monthGrid(month: string): (string | null)[][] {
  const first = new Date(`${month}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export type DayCounts = Record<SlotState, number>;

/** How many slots of each state every date has. */
export function countByDay(slots: Pick<Slot, 'on_date' | 'state'>[]): Map<string, DayCounts> {
  const out = new Map<string, DayCounts>();
  for (const s of slots) {
    const c = out.get(s.on_date) ?? { free: 0, booked: 0, off: 0 };
    c[s.state] += 1;
    out.set(s.on_date, c);
  }
  return out;
}
