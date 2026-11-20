import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import type { AvailabilityChange, AvailabilitySettings, Slot } from '../availability';

// Counsellor availability (step 3). Super admins only: the screen, every read and every write. Counsellors and
// coordinators cannot see or change availability (RLS reads super admins only; the writers check again).

export function canManageAvailability(role: string): boolean {
  return role === 'super_admin';
}

async function requireAvailabilityAdmin() {
  const staff = await requireStaff();
  if (!canManageAvailability(staff.profile.role)) throw new Error('Only super admins can manage availability.');
  return staff;
}

/** Active counsellors, by name. */
export async function listCounsellors(): Promise<{ id: string; full_name: string }[]> {
  await requireAvailabilityAdmin();
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'counsellor')
    .eq('is_active', true)
    .order('full_name');
  return (data ?? []) as { id: string; full_name: string }[];
}

export async function getAvailabilitySettings(): Promise<AvailabilitySettings | null> {
  await requireAvailabilityAdmin();
  const db = await createClient();
  const { data } = await db
    .from('availability_settings')
    .select('slot_minutes, gap_minutes, work_days, day_start, day_end, lunch_start, lunch_end')
    .maybeSingle();
  return (data as AvailabilitySettings | null) ?? null;
}

/** Every slot of a counsellor between two dates (inclusive), with Free / Booked / Off. */
export async function counsellorSlots(counsellorId: string, from: string, to: string): Promise<Slot[]> {
  await requireAvailabilityAdmin();
  const { data, error } = await createAdminClient().rpc('counsellor_slots', { p_counsellor: counsellorId, p_from: from, p_to: to });
  if (error) {
    if (error.code === '42883') return [];
    throw new Error(`Could not read slots: ${error.message}`);
  }
  return (data ?? []) as Slot[];
}

/** Every change of one date (active and undone), oldest first: the history of that day. */
export async function dayChanges(counsellorId: string, date: string): Promise<AvailabilityChange[]> {
  await requireAvailabilityAdmin();
  const db = await createClient();
  const { data } = await db
    .from('availability_changes')
    .select('id, kind, on_date, start_time, end_time, reason, created_at, created_by_name, removed_at, removed_by_name')
    .eq('counsellor_id', counsellorId)
    .eq('on_date', date)
    .order('created_at');
  return (data ?? []) as AvailabilityChange[];
}

// Messages from availability_add() / availability_remove() written for staff, shown as they are.
const DB_MESSAGES = [
  'Only super admins can change availability.',
  'Choose an active counsellor.',
  'Choose Mark off or Add custom slots.',
  'Pick today or a later date.',
  'The end time must be after the start time.',
  'The reason is too long (300 characters at most).',
  'This day is already off.',
  'Some of these slots are booked. Move those bookings first.',
  'Choose a time range for the custom slots.',
  'Custom slots already cover part of this time.',
  'This change was not found.',
  'This change was already undone.',
  'Some of its slots are booked, so it cannot be undone.',
];

function dbMessage(message: string): string {
  if (message.includes('whole number of')) return message.replace(/^.*?(The time range)/, '$1');
  return DB_MESSAGES.find((m) => message.includes(m)) ?? '';
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface AddChangeInput {
  counsellorId: string;
  kind: 'off' | 'custom';
  date: string;
  /** "HH:MM"; empty for a whole-day Mark off. */
  start?: string | null;
  end?: string | null;
  reason?: string | null;
}

export async function addAvailabilityChange(input: AddChangeInput): Promise<{ success: boolean; error?: string }> {
  const { profile } = await requireAvailabilityAdmin();
  const start = input.start?.trim() || null;
  const end = input.end?.trim() || null;
  if ((start && !TIME.test(start)) || (end && !TIME.test(end)) || (!start) !== (!end)) {
    return { success: false, error: 'Enter both times, like 14:00 and 16:00.' };
  }
  if (input.kind === 'custom' && !start) return { success: false, error: 'Choose a time range for the custom slots.' };
  const { error } = await createAdminClient().rpc('availability_add', {
    p_counsellor: input.counsellorId,
    p_kind: input.kind,
    p_date: input.date,
    p_start: start,
    p_end: end,
    p_reason: input.reason?.trim() || null,
    p_by: profile.id,
  });
  if (error) {
    const known = dbMessage(error.message);
    if (!known) console.error('availability_add failed:', error.message);
    return { success: false, error: known || 'The change could not be saved. Please try again.' };
  }
  return { success: true };
}

/** Undo a Mark off or a custom slot range (refused when any of its slots is booked). The row stays in the history. */
export async function removeAvailabilityChange(changeId: string): Promise<{ success: boolean; error?: string }> {
  const { profile } = await requireAvailabilityAdmin();
  const { error } = await createAdminClient().rpc('availability_remove', { p_change: changeId, p_by: profile.id });
  if (error) {
    const known = dbMessage(error.message);
    if (!known) console.error('availability_remove failed:', error.message);
    return { success: false, error: known || 'It could not be undone. Please try again.' };
  }
  return { success: true };
}
