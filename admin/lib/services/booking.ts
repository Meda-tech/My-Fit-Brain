import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import { istToday } from '../availability';
import { BOOKING_DAYS_AHEAD, CANCEL_REASON_MAX, CANCEL_REASON_MIN, groupFreeSlots, type FreeDay, type FreeSlotRow } from '../booking';
import { canViewPurchases, nameLookup } from './purchases';

// Book presentation (step 4). Coordinators book for their own clients, super admins for anyone; only super admins
// cancel (with a reason). The database checks every rule again and refuses a double booking.

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Free future slots of every active counsellor for the next 30 days, by date then counsellor. */
export async function freeSlots(): Promise<FreeDay[]> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return [];
  const from = istToday();
  const { data, error } = await createAdminClient().rpc('free_presentation_slots', { p_from: from, p_to: addDays(from, BOOKING_DAYS_AHEAD - 1) });
  if (error) throw new Error(`Could not read free slots: ${error.message}`);
  return groupFreeSlots((data ?? []) as FreeSlotRow[]);
}

const BOOK_MESSAGES = [
  'Only coordinators and super admins can book a presentation.',
  'This purchase was not found.',
  "Only this client's coordinator can book their presentation.",
  'Only a paid purchase can be booked.',
  'The assessment is not completed yet.',
  'A presentation is already booked for this purchase.',
  'Choose an active counsellor.',
  'This slot is no longer free. Pick another.',
  'This slot has already started. Pick a later one.',
  'This slot was just booked by someone else. Pick another.',
];
const CANCEL_MESSAGES = [
  'Only super admins can cancel a booking.',
  'Write the reason (3 to 300 characters).',
  'This booking was not found.',
  'This booking was already cancelled.',
];

export interface BookInput {
  purchaseId: string;
  counsellorId: string;
  date: string;
  start: string;
}

export async function bookPresentation(input: BookInput): Promise<{ success: boolean; error?: string }> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return { success: false, error: BOOK_MESSAGES[0] };
  if (!DATE.test(input.date) || !TIME.test(input.start)) return { success: false, error: 'Pick a slot.' };

  // A coordinator must see the purchase (their own client) under RLS before anything is written.
  const db = await createClient();
  const { data: visible } = await db.from('purchases').select('id').eq('id', input.purchaseId).maybeSingle();
  if (!visible) return { success: false, error: 'This purchase was not found.' };

  const { error } = await createAdminClient().rpc('presentation_book', {
    p_purchase: input.purchaseId,
    p_counsellor: input.counsellorId,
    p_date: input.date,
    p_start: input.start,
    p_by: profile.id,
  });
  if (error) {
    const known = BOOK_MESSAGES.find((m) => error.message.includes(m));
    if (!known) console.error('presentation_book failed:', error.message);
    return { success: false, error: known ?? 'The presentation could not be booked. Please try again.' };
  }
  return { success: true };
}

export async function cancelBooking(bookingId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return { success: false, error: CANCEL_MESSAGES[0] };
  const r = reason.trim();
  if (r.length < CANCEL_REASON_MIN || r.length > CANCEL_REASON_MAX) return { success: false, error: CANCEL_MESSAGES[1] };
  const { error } = await createAdminClient().rpc('presentation_cancel', { p_booking: bookingId, p_reason: r, p_by: profile.id });
  if (error) {
    const known = CANCEL_MESSAGES.find((m) => error.message.includes(m));
    if (!known) console.error('presentation_cancel failed:', error.message);
    return { success: false, error: known ?? 'The booking could not be cancelled. Please try again.' };
  }
  return { success: true };
}

/** Booked slots of a counsellor on one date with the client's name (availability screen, super admins). */
export async function bookingsOfDay(counsellorId: string, date: string): Promise<Map<string, string>> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return new Map();
  const db = await createClient();
  const { data } = await db
    .from('presentation_bookings')
    .select('start_time, purchases(client_id, phone, coordinator_id)')
    .eq('counsellor_id', counsellorId)
    .eq('on_date', date)
    .eq('status', 'booked');
  type Row = {
    start_time: string;
    purchases: { client_id: string | null; phone: string; coordinator_id: string | null } | { client_id: string | null; phone: string; coordinator_id: string | null }[] | null;
  };
  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => ({ start: r.start_time, p: Array.isArray(r.purchases) ? r.purchases[0] : r.purchases }))
    .filter((r): r is { start: string; p: { client_id: string | null; phone: string; coordinator_id: string | null } } => !!r.p);
  const names = await nameLookup(db, rows.map((r) => r.p));
  return new Map(rows.map((r) => [r.start, names.client(r.p) ?? r.p.phone]));
}
