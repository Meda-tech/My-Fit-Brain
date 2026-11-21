import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { requireStaff } from '../auth';
import {
  ALL_CALL_CHOICES,
  CALL_NOTE_MAX,
  CALL_REASONS,
  assessmentContext,
  bookingContext,
  packageContext,
  fromIstInput,
  needsFollowUp,
  paymentContext,
  type AssessmentProgress,
  type CallChoice,
  type CallKind,
  type CallReason,
} from '../calls';
import { canViewPurchases, nameLookup } from './purchases';

// Calls (step 2): My tasks and Mark as call done. Reads use the staff session (RLS: super admins all calls, a
// coordinator the calls of their own clients). The one write goes through call_mark() in the database, which
// checks every rule again.

export interface TaskRow {
  call_id: string;
  kind: CallKind;
  due_at: string;
  purchase_id: string;
  client_name: string | null;
  phone: string;
  test_name: string;
  context: string;
  coordinator_name: string | null;
  /** Earlier "Mark as call done" entries on this call (Not interested needs at least one). */
  prior_calls: number;
  /** A Booking call whose presentation can be booked now. */
  can_book: boolean;
}

type One<T> = T | T[] | null;
const one = <T>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

interface TaskPurchase {
  test_code: string;
  phone: string;
  client_id: string | null;
  coordinator_id: string | null;
  paid_at: string | null;
  purchase_payments: { payments: One<{ created_at: string; status: string; attempt_id: string | null }> }[] | null;
  status: string;
  purchase_stages: { stage: string; done_at: string | null }[] | null;
  presentation_bookings: { status: string; done_at: string | null; counsellor_id: string }[] | null;
}

interface RawTask {
  id: string;
  kind: CallKind;
  due_at: string;
  purchase_id: string;
  call_logs: { entry: string }[] | null;
  purchases: One<TaskPurchase>;
}

/** Open calls, one list by due time (late ones first). Super admins may filter by coordinator. */
export async function listTasks(opts: { coordinatorId?: string | null }): Promise<TaskRow[]> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return [];
  const db = await createClient();
  const now = new Date();
  let q = db
    .from('calls')
    .select(
      'id, kind, due_at, purchase_id, call_logs(entry), ' +
        'purchases!inner(test_code, phone, client_id, coordinator_id, paid_at, status, purchase_payments(payments(created_at, status, attempt_id)), ' +
        'purchase_stages(stage, done_at), presentation_bookings(status, done_at, counsellor_id))'
    )
    .eq('status', 'open');
  if (profile.role === 'super_admin' && opts.coordinatorId) q = q.eq('purchases.coordinator_id', opts.coordinatorId);
  const { data, error } = await q.order('due_at').limit(500);
  if (error) {
    if (error.code === '42P01') return [];
    throw new Error(`Could not read tasks: ${error.message}`);
  }

  const raw = ((data ?? []) as unknown as RawTask[])
    .map((t) => ({ t, p: one(t.purchases) }))
    .filter((x): x is { t: RawTask; p: TaskPurchase } => !!x.p);
  const counsellorIds = raw.flatMap(({ p }) => (p.presentation_bookings ?? []).filter((b) => b.status === 'booked').map((b) => b.counsellor_id));
  const names = await nameLookup(db, raw.map(({ p }) => p), counsellorIds);

  // How far the client got with the assessment (only ids of rows the staff member may see).
  const attemptIds = [
    ...new Set(
      raw.flatMap(({ p }) => (p.purchase_payments ?? []).map((l) => one(l.payments)?.attempt_id).filter((v): v is string => !!v))
    ),
  ];
  const { data: attempts } = attemptIds.length
    ? await createAdminClient().from('attempts').select('id, status').in('id', attemptIds)
    : { data: [] };
  const attemptStatus = new Map(((attempts ?? []) as { id: string; status: string }[]).map((a) => [a.id, a.status]));

  return raw.map(({ t, p }) => {
    const tries = (p.purchase_payments ?? [])
      .map((l) => one(l.payments))
      .filter((x): x is { created_at: string; status: string; attempt_id: string | null } => !!x)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    let context: string;
    if (t.kind === 'payment') {
      const last = tries.at(-1);
      context = paymentContext(tries.length, last?.created_at ?? t.due_at, last?.status === 'failed', now);
    } else if (t.kind === 'booking') {
      context = bookingContext((p.purchase_stages ?? []).find((s) => s.stage === 'assessment')?.done_at ?? null);
    } else if (t.kind === 'package') {
      const done = (p.purchase_stages ?? []).find((s) => s.stage === 'report_presentation')?.done_at ?? null;
      const booked = (p.presentation_bookings ?? []).find((b) => b.status === 'booked');
      context = packageContext(done, booked ? names.coordinator(booked.counsellor_id) : null);
    } else {
      const statuses = tries.map((x) => (x.attempt_id ? attemptStatus.get(x.attempt_id) : undefined));
      const progress: AssessmentProgress = statuses.includes('completed')
        ? 'completed'
        : statuses.includes('in_progress')
          ? 'in_progress'
          : 'not_started';
      context = assessmentContext(p.paid_at, progress);
    }
    return {
      call_id: t.id,
      kind: t.kind,
      due_at: t.due_at,
      purchase_id: t.purchase_id,
      client_name: names.client(p),
      phone: p.phone,
      test_name: names.test(p.test_code),
      context,
      coordinator_name: names.coordinator(p.coordinator_id),
      prior_calls: (t.call_logs ?? []).filter((l) => l.entry === 'call').length,
      can_book:
        t.kind === 'booking' &&
        p.status === 'paid' &&
        !(p.presentation_bookings ?? []).some((b) => b.status === 'booked') &&
        (p.purchase_stages ?? []).some((s) => s.stage === 'assessment' && !!s.done_at),
    };
  });
}

/** Active coordinators, for the super admin's filter. */
export async function listCoordinators(): Promise<{ id: string; full_name: string }[]> {
  const { profile } = await requireStaff();
  if (profile.role !== 'super_admin') return [];
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'coordinator')
    .order('full_name');
  return (data ?? []) as { id: string; full_name: string }[];
}

export interface MarkCallInput {
  callId: string;
  choice: string;
  reason?: string | null;
  note?: string | null;
  /** datetime-local value, India time. */
  followUp?: string | null;
}

// Messages from call_mark() that are written for staff and shown as they are.
const DB_MESSAGES = [
  'This call was not found.',
  'This call is already closed.',
  'Choose what happened on the call.',
  'The note is too long (2,000 characters at most).',
  'Pick a follow-up date and time within 2 working days.',
  'At least one follow-up call is needed first.',
  'Choose a reason.',
];

/** Mark as call done. Coordinators only on their own clients' calls (RLS read first), super admins on all. */
export async function markCall(input: MarkCallInput): Promise<{ success: boolean; error?: string }> {
  const { profile } = await requireStaff();
  if (!canViewPurchases(profile.role)) return { success: false, error: 'Only coordinators and super admins can mark calls.' };

  const db = await createClient();
  const { data: call } = await db.from('calls').select('id, status').eq('id', input.callId).maybeSingle();
  if (!call) return { success: false, error: 'This call was not found.' };
  if (call.status !== 'open') return { success: false, error: 'This call is already closed.' };

  if (!(ALL_CALL_CHOICES as readonly string[]).includes(input.choice)) return { success: false, error: 'Choose what happened on the call.' };
  const choice = input.choice as CallChoice;
  const note = (input.note ?? '').trim();
  if (note.length > CALL_NOTE_MAX) return { success: false, error: 'The note is too long (2,000 characters at most).' };

  let followUp: Date | null = null;
  if (needsFollowUp(choice)) {
    followUp = input.followUp ? fromIstInput(input.followUp) : null;
    if (!followUp) return { success: false, error: 'Pick a follow-up date and time within 2 working days.' };
  }
  let reason: CallReason | null = null;
  if (choice === 'not_interested') {
    if (!(CALL_REASONS as readonly string[]).includes(input.reason ?? '')) return { success: false, error: 'Choose a reason.' };
    reason = input.reason as CallReason;
  }

  const { error } = await createAdminClient().rpc('call_mark', {
    p_call: input.callId,
    p_by: profile.id,
    p_choice: choice,
    p_reason: reason,
    p_note: note || null,
    p_follow_up: followUp ? followUp.toISOString() : null,
  });
  if (error) {
    const known = DB_MESSAGES.find((m) => error.message.includes(m));
    if (!known) console.error('call_mark failed:', error.message);
    return { success: false, error: known ?? 'The call could not be saved. Please try again.' };
  }
  return { success: true };
}
