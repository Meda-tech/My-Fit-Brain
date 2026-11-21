import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import { nameLookup } from './purchases';

// Report presentations (step 5). Counsellors see only their own; super admins see all (and can filter by
// counsellor). Reads run on the service role AFTER the role check here, with the counsellor filter applied in the
// query (counsellors cannot read purchases under RLS). The one write goes through presentation_mark_done(), which
// checks every rule again. Report access is unchanged: the link goes to /attempts/<id>, which already allows
// super admins and counsellors only.

export function canViewPresentations(role: string): boolean {
  return role === 'counsellor' || role === 'super_admin';
}

export interface PresentationRow {
  id: string;
  purchase_id: string;
  counsellor_id: string;
  counsellor_name: string | null;
  on_date: string;
  start_time: string;
  end_time: string;
  /** The slot start as an instant (India time). */
  starts_at: string;
  client_name: string | null;
  phone: string;
  test_name: string;
  coordinator_name: string | null;
  /** The client's assessment (report link), when it exists. */
  attempt_id: string | null;
  done_at: string | null;
  done_by_name: string | null;
}

type One<T> = T | T[] | null;
const one = <T>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

interface RawRow {
  id: string;
  purchase_id: string;
  counsellor_id: string;
  on_date: string;
  start_time: string;
  end_time: string;
  done_at: string | null;
  done_by_name: string | null;
  purchases: One<RowPurchase>;
}

interface RowPurchase {
  test_code: string;
  phone: string;
  client_id: string | null;
  coordinator_id: string | null;
  purchase_payments: { payments: One<{ status: string; attempt_id: string | null }> }[] | null;
}

const COLUMNS =
  'id, purchase_id, counsellor_id, on_date, start_time, end_time, done_at, done_by_name, ' +
  'purchases(test_code, phone, client_id, coordinator_id, purchase_payments(payments(status, attempt_id)))';

/** "2026-11-23" + "10:00:00" in India time → ISO instant. */
function startsAt(date: string, time: string): string {
  return new Date(`${date}T${time.slice(0, 8)}+05:30`).toISOString();
}

async function toRows(raw: RawRow[]): Promise<PresentationRow[]> {
  const admin = createAdminClient();
  const items = raw.map((r) => ({ r, p: one(r.purchases) })).filter((x): x is { r: RawRow; p: RowPurchase } => !!x.p);
  const names = await nameLookup(
    admin as unknown as Parameters<typeof nameLookup>[0],
    items.map(({ p }) => p),
    items.map(({ r }) => r.counsellor_id)
  );
  return items.map(({ r, p }) => {
    const paid = (p.purchase_payments ?? []).map((l) => one(l.payments)).find((x) => x?.status === 'paid' && x.attempt_id);
    return {
      id: r.id,
      purchase_id: r.purchase_id,
      counsellor_id: r.counsellor_id,
      counsellor_name: names.coordinator(r.counsellor_id),
      on_date: r.on_date,
      start_time: r.start_time,
      end_time: r.end_time,
      starts_at: startsAt(r.on_date, r.start_time),
      client_name: names.client(p),
      phone: p.phone,
      test_name: names.test(p.test_code),
      coordinator_name: names.coordinator(p.coordinator_id),
      attempt_id: paid?.attempt_id ?? null,
      done_at: r.done_at,
      done_by_name: r.done_by_name,
    };
  });
}

/** Booked presentations, by slot time. A counsellor always gets only their own; a super admin all, or one counsellor's. */
export async function listPresentations(counsellorId?: string | null): Promise<PresentationRow[]> {
  const { profile } = await requireStaff();
  if (!canViewPresentations(profile.role)) return [];
  let q = createAdminClient().from('presentation_bookings').select(COLUMNS).eq('status', 'booked');
  if (profile.role === 'counsellor') q = q.eq('counsellor_id', profile.id);
  else if (counsellorId) q = q.eq('counsellor_id', counsellorId);
  const { data, error } = await q.order('on_date').order('start_time').limit(500);
  if (error) {
    if (error.code === '42P01') return [];
    throw new Error(`Could not read presentations: ${error.message}`);
  }
  return toRows((data ?? []) as unknown as RawRow[]);
}

/** Super admins: presentations whose slot time has passed but nobody marked done (the forgotten ones). */
export async function unmarkedPresentations(counsellorId?: string | null): Promise<PresentationRow[]> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return [];
  const now = Date.now();
  let q = createAdminClient()
    .from('presentation_bookings')
    .select(COLUMNS)
    .eq('status', 'booked')
    .is('done_at', null)
    .lte('on_date', new Date(now + 330 * 60 * 1000).toISOString().slice(0, 10));
  if (counsellorId) q = q.eq('counsellor_id', counsellorId);
  const { data } = await q.order('on_date').order('start_time');
  return (await toRows((data ?? []) as unknown as RawRow[])).filter((r) => new Date(r.starts_at).getTime() <= now);
}

/** Counsellors of the super admin's filter. */
export async function listCounsellorsForFilter(): Promise<{ id: string; full_name: string }[]> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return [];
  const { data } = await createAdminClient().from('profiles').select('id, full_name').eq('role', 'counsellor').order('full_name');
  return (data ?? []) as { id: string; full_name: string }[];
}

const MESSAGES = [
  'Only the counsellor or a super admin can mark the presentation done.',
  'This booking was not found.',
  'Only the counsellor of this presentation can mark it done.',
  'This presentation is already marked done.',
  'It can be marked done from the start of the slot.',
];

export async function markPresentationDone(bookingId: string): Promise<{ success: boolean; error?: string }> {
  const { profile } = await requireStaff();
  if (!canViewPresentations(profile.role)) return { success: false, error: MESSAGES[0] };
  const { error } = await createAdminClient().rpc('presentation_mark_done', { p_booking: bookingId, p_by: profile.id });
  if (error) {
    const known = MESSAGES.find((m) => error.message.includes(m));
    if (!known) console.error('presentation_mark_done failed:', error.message);
    return { success: false, error: known ?? 'It could not be saved. Please try again.' };
  }
  return { success: true };
}
