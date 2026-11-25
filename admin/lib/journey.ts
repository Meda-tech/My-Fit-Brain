// The purchase journey as our team's five tasks (side panel), with the call attempts and the client's own steps
// nested under the task they belong to. Display only: no rule or data changes; everything comes from what the
// database already keeps (calls and call history, payments, the assessment, the booking, the package payment).
//
//   1. Payment call · 2. Assessment call · 3. Booking call · 4. Report presentation (counsellor) · 5. Package call
//
// Status of a task: done ✓ · open ● · upcoming ○ · not interested ✕ · not needed (strikethrough). "Not needed" = the
// client did it before anyone called (the call closed by itself with no call attempt), or the call was never made
// because it was not needed (e.g. paid directly: no Payment call).
//
// The package can be paid in parts (owner, 2026-11-24): each package payment is a line under task 5; the task stays
// open until the amount paid in total reaches the start amount, then it is done ("Package started – with CRM").
//
// A purchase from before the system (paid more than 7 days before go-live; owner, 2026-11-21): tasks 1–3 show
// "Before the system" (no automatic calls, never late). It can still be booked into a slot by hand (then task 3 is
// done as usual), or a super admin marks a presentation that happened outside the system done ("Marked by admin",
// no slot). From the presentation on, tasks 4–5 work as for any purchase.

import { formatAmount } from '../components/payments/amount';
import { twelveHourText } from './availability';
import { paymentMethodLabel } from '../components/payments/format';
import { CALL_EVENT_LABELS, CALL_REASON_LABELS, choiceLabel, type CallChoice, type CallEvent, type CallKind, type CallOutcome, type CallReason } from './calls';

export type JourneyTaskKey = 'payment' | 'assessment' | 'booking' | 'presentation' | 'package';
export type JourneyStatus = 'done' | 'open' | 'upcoming' | 'not_interested' | 'not_needed' | 'before_system';

export const JOURNEY_TASK_TITLES: Record<JourneyTaskKey, string> = {
  payment: 'Payment call',
  assessment: 'Assessment call',
  booking: 'Booking call',
  presentation: 'Report presentation',
  package: 'Package call',
};

export const JOURNEY_STATUS_LABELS: Record<JourneyStatus, string> = {
  done: 'Done',
  open: 'Open',
  upcoming: 'Upcoming',
  not_interested: 'Not interested',
  not_needed: 'Not needed',
  before_system: 'Before the system',
};

/** One nested line: a call attempt, a client step, or a system note. */
export interface JourneyItem {
  at: string;
  kind: 'call' | 'client' | 'system';
  title: string;
  /** A second line, e.g. "Razorpay · UPI · ₹3,500". */
  detail: string | null;
  /** The call note, full text. */
  note: string | null;
  /** Who: the staff member who called / recorded / marked. */
  by: string | null;
  followUp: string | null;
}

export interface JourneyTask {
  key: JourneyTaskKey;
  title: string;
  whoRole: 'Coordinator' | 'Counsellor';
  who: string | null;
  status: JourneyStatus;
  /** Due time (calls) or slot time (presentation). */
  planned: string | null;
  /** How the planned time is shown when it is a slot: "Sun, 22 Nov 2026, 9:00–9:30 pm". */
  plannedLabel?: string;
  /** A short label after the status, e.g. "Marked by admin". */
  statusNote?: string;
  /** When it was completed. */
  actual: string | null;
  /** Open and the due time has passed. */
  late: boolean;
  /** Done after its planned time. */
  actualLate: boolean;
  /** "Not needed – <what> at <at>". */
  notNeeded: { what: string; at: string | null } | null;
  /** The open call of this task, for Mark as call done. */
  callId: string | null;
  priorCalls: number;
  items: JourneyItem[];
}

interface LogIn {
  id: string;
  at: string;
  entry: 'call' | 'event';
  choice: CallChoice | null;
  reason: CallReason | null;
  note: string | null;
  follow_up_at: string | null;
  event: CallEvent | null;
  by_name: string | null;
}

export interface JourneyInput {
  status: 'not_paid' | 'paid' | 'refunded' | 'cancelled';
  /** Paid (or last tried) more than 7 days before go-live: no automatic Payment, Assessment or Booking call. */
  beforeSystem?: boolean;
  coordinatorName: string | null;
  calls: {
    id: string;
    kind: CallKind;
    status: 'open' | 'closed';
    outcome: CallOutcome | null;
    due_at: string;
    closed_at: string | null;
    closed_note: string | null;
    logs: LogIn[];
    prior_calls: number;
  }[];
  payments: {
    status: string;
    provider: 'razorpay' | 'offline';
    method: string | null;
    amount_paise: number;
    currency: string;
    paid_at: string | null;
    created_at: string;
    refund_status: string | null;
    recorded_by_name: string | null;
    attempt: { started_at: string | null; completed_at: string | null } | null;
    /** Safety net: paid a second time while this purchase was open (refund needed; no journey of its own). */
    extra_paid?: boolean;
  }[];
  /** Pay page tries refused because this purchase was open (no order made). */
  blockedTries?: { at: string; signed_in: boolean }[];
  presentation: {
    counsellor_name: string | null;
    on_date: string;
    /** Empty when a super admin marked the presentation of an old purchase done (no slot). */
    start_time: string | null;
    end_time: string | null;
    marked_by_admin?: boolean;
    booked_at: string;
    booked_by_name: string | null;
    done_at: string | null;
    done_by_name: string | null;
  } | null;
  /** The package payments this staff member sees (a coordinator: up to the handover), paid ones only. */
  packagePayments: {
    amount_paise: number;
    paid_at: string;
    provider: 'razorpay' | 'offline';
    method: string | null;
    recorded_by_name: string | null;
    /** More than the remaining balance: counts for nothing, waits for a refund. */
    refund_needed?: boolean;
  }[];
  /** Paid in total to start the package (for "paid ₹4,000 of ₹10,000 to start"); null when unknown. */
  packageStartPaise?: number | null;
  /** "Mon, 23 Nov 2026, 10:00–10:30 am" for a slot (the screens' own formatter). */
  slotLabel: (date: string, start: string | null, end: string | null) => string;
}

/** The slot start as an instant (India time). */
function slotAt(date: string, start: string): string {
  return new Date(`${date}T${start.slice(0, 8)}+05:30`).toISOString();
}

const later = (a: string | null, b: string | null) => !!a && !!b && new Date(a).getTime() > new Date(b).getTime();

/** "17 Nov 2026" (India time). */
const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
export const journeyDay = (iso: string) => dayFormat.format(new Date(iso));

/** Call attempts of a call (Mark as call done entries) as nested lines. */
function callItems(kind: CallKind, logs: LogIn[]): JourneyItem[] {
  return logs
    .filter((l) => l.entry === 'call' && l.choice)
    .map((l) => ({
      at: l.at,
      kind: 'call' as const,
      title: [choiceLabel(kind, l.choice!), l.reason ? CALL_REASON_LABELS[l.reason] : null].filter(Boolean).join(' · '),
      detail: null,
      note: l.note,
      by: l.by_name,
      followUp: l.follow_up_at,
    }));
}

/** System lines worth showing under a task (reopened, cancelled booking, package tries, refund needed). */
// (A part payment and a refund-needed payment show as their own payment lines, so their history events are left out.)
const SYSTEM_EVENTS: CallEvent[] = ['reopened', 'booking_cancelled', 'package_payment_failed', 'package_payment_not_completed', 'package_started'];
function systemItems(logs: LogIn[]): JourneyItem[] {
  return logs
    .filter((l) => l.entry === 'event' && l.event && SYSTEM_EVENTS.includes(l.event))
    // System notes written before times were shown in 12-hour form are shown in 12-hour form too.
    .map((l) => ({ at: l.at, kind: 'system' as const, title: CALL_EVENT_LABELS[l.event!], detail: l.note ? twelveHourText(l.note) : null, note: null, by: l.by_name, followUp: null }));
}

const byTime = (a: JourneyItem, b: JourneyItem) => a.at.localeCompare(b.at);

/**
 * The task's status from its call. A call that closed by itself because the client did the step (paid,
 * completed, bought in the app) with no call attempt logged is "not needed"; with attempts it counts as done.
 */
function fromCall(
  call: JourneyInput['calls'][number],
  clientDid: { what: string; at: string | null } | null,
  teamDid: boolean
): Pick<JourneyTask, 'status' | 'actual' | 'notNeeded'> {
  if (call.status === 'open') return { status: 'open', actual: null, notNeeded: null };
  const attempts = call.logs.some((l) => l.entry === 'call');
  switch (call.outcome) {
    case 'not_interested':
      return { status: 'not_interested', actual: call.closed_at, notNeeded: null };
    case 'ended':
      return { status: 'not_needed', actual: null, notNeeded: { what: 'the purchase was refunded or cancelled', at: call.closed_at } };
    case 'before_go_live':
      return { status: 'not_needed', actual: null, notNeeded: { what: 'no automatic call (paid more than 7 days before go-live)', at: null } };
    case 'not_needed':
      return { status: 'not_needed', actual: null, notNeeded: { what: 'had already paid for this assessment', at: call.closed_at } };
    case 'paid':
    case 'assessment_completed':
    case 'package_paid':
    case 'package_started':
      if (!teamDid && !attempts && clientDid) return { status: 'not_needed', actual: null, notNeeded: clientDid };
      return { status: 'done', actual: call.closed_at, notNeeded: null };
    default:
      // done (Mark as call done), booked (presentation booked by the team)
      return { status: 'done', actual: call.closed_at, notNeeded: null };
  }
}

export function buildJourney(input: JourneyInput, now: Date): JourneyTask[] {
  const call = (kind: CallKind) => input.calls.find((c) => c.kind === kind) ?? null;
  const paid = input.status !== 'not_paid';
  // The payment of this purchase: never an extra (safety net) payment.
  const paidPayment = input.payments.find((p) => p.status === 'paid' && p.paid_at && !p.extra_paid) ?? null;
  const attempt = paidPayment?.attempt ?? null;
  const completedAt = attempt?.completed_at ?? null;
  const pres = input.presentation;
  const nowIso = now.toISOString();
  const byAdmin = !!pres?.marked_by_admin;
  /** Tasks 1–3 of a purchase from before the system: no call, nothing planned, never late. */
  type State = Pick<JourneyTask, 'status' | 'actual' | 'notNeeded'>;
  const beforeSystem = (state: State): State =>
    input.beforeSystem ? { status: 'before_system', actual: null, notNeeded: null } : state;

  const task = (
    key: JourneyTaskKey,
    whoRole: JourneyTask['whoRole'],
    who: string | null,
    c: JourneyInput['calls'][number] | null,
    state: Pick<JourneyTask, 'status' | 'actual' | 'notNeeded'>,
    items: JourneyItem[],
    planned: string | null = c?.due_at ?? null
  ): JourneyTask => ({
    key,
    title: JOURNEY_TASK_TITLES[key],
    whoRole,
    who,
    ...state,
    planned: state.status === 'not_needed' || state.status === 'before_system' ? null : planned,
    late: state.status === 'open' && !!planned && later(nowIso, planned),
    actualLate: state.status === 'done' && later(state.actual, planned),
    callId: c?.status === 'open' ? c.id : null,
    priorCalls: c?.prior_calls ?? 0,
    items: [...items].sort(byTime),
  });

  // 1. Payment call. Client steps: every try on the pay page, and the payment. Once paid, later tries are history only
  // (owner, 2026-11-23): "Tried again – blocked, already paid <date>" (no order made), a try or a second payment that
  // still came through (refund needed).
  const payCall = call('payment');
  const alreadyPaid = paidPayment?.paid_at ? `already paid ${journeyDay(paidPayment.paid_at)}` : null;
  const blockedItems: JourneyItem[] = (input.blockedTries ?? []).map((b) => ({
    at: b.at,
    kind: 'client' as const,
    title: `Tried again – blocked${alreadyPaid ? `, ${alreadyPaid}` : ''}`,
    detail: `Pay page${b.signed_in ? ' · signed in' : ''} · no payment made`,
    note: null,
    by: null,
    followUp: null,
  }));
  const payItems: JourneyItem[] = input.payments.map((p) => {
    const manual = p.provider === 'offline';
    if (p.status === 'paid' && p.extra_paid) {
      return {
        at: p.paid_at ?? p.created_at,
        kind: 'client' as const,
        title: `Paid a second time – ${p.refund_status === 'refunded' ? 'refunded' : 'refund needed'}`,
        detail: `${paymentMethodLabel(p)} · ${formatAmount(p.amount_paise, p.currency)}${alreadyPaid ? ` · ${alreadyPaid}` : ''}`,
        note: null,
        by: manual ? p.recorded_by_name : null,
        followUp: null,
      };
    }
    if (p.status !== 'paid' && alreadyPaid && later(p.created_at, paidPayment!.paid_at)) {
      return {
        at: p.created_at,
        kind: 'client' as const,
        title: `Tried again – ${p.status === 'failed' ? 'failed' : 'not completed'}, ${alreadyPaid}`,
        detail: manual ? paymentMethodLabel(p) : 'Pay page',
        note: null,
        by: null,
        followUp: null,
      };
    }
    if (p.status === 'paid') {
      return {
        at: p.paid_at ?? p.created_at,
        kind: 'client' as const,
        title: manual ? 'Paid · manual payment' : 'Client paid',
        detail: `${paymentMethodLabel(p)} · ${formatAmount(p.amount_paise, p.currency)}${p.refund_status === 'refunded' ? ' · refunded' : ''}`,
        note: null,
        by: manual ? p.recorded_by_name : null,
        followUp: null,
      };
    }
    return {
      at: p.created_at,
      kind: 'client' as const,
      title: p.status === 'failed' ? 'Tried to pay · failed' : p.status === 'cancelled' ? 'Manual payment cancelled' : 'Started to pay · not completed',
      detail: manual ? paymentMethodLabel(p) : 'Pay page',
      note: null,
      by: null,
      followUp: null,
    };
  });
  const paidWhat = paidPayment
    ? { what: paidPayment.provider === 'offline' ? 'paid by manual payment' : 'client paid directly', at: paidPayment.paid_at }
    : null;
  const payState: Pick<JourneyTask, 'status' | 'actual' | 'notNeeded'> = payCall
    ? fromCall(payCall, paidWhat, paidPayment?.provider === 'offline' && payCall.logs.some((l) => l.entry === 'call'))
    : paid
      ? { status: 'not_needed', actual: null, notNeeded: paidWhat }
      : { status: 'upcoming', actual: null, notNeeded: null };
  const payment = task('payment', 'Coordinator', input.coordinatorName, payCall, beforeSystem(payState), [
    ...payItems,
    ...blockedItems,
    ...(payCall ? [...callItems('payment', payCall.logs), ...systemItems(payCall.logs)] : []),
  ]);

  // 2. Assessment call. Client steps: started, completed.
  const asCall = call('assessment');
  const asItems: JourneyItem[] = [
    ...(attempt?.started_at ? [{ at: attempt.started_at, kind: 'client' as const, title: 'Assessment started', detail: null, note: null, by: null, followUp: null }] : []),
    ...(completedAt ? [{ at: completedAt, kind: 'client' as const, title: 'Assessment completed', detail: null, note: null, by: null, followUp: null }] : []),
  ];
  const completedWhat = completedAt ? { what: 'client completed the assessment', at: completedAt } : null;
  const asState: Pick<JourneyTask, 'status' | 'actual' | 'notNeeded'> = asCall
    ? fromCall(asCall, completedWhat, false)
    : completedWhat
      ? { status: 'not_needed', actual: null, notNeeded: completedWhat }
      : { status: 'upcoming', actual: null, notNeeded: null };
  const assessment = task('assessment', 'Coordinator', input.coordinatorName, asCall, beforeSystem(asState), [
    ...asItems,
    ...(asCall ? [...callItems('assessment', asCall.logs), ...systemItems(asCall.logs)] : []),
  ]);

  // 3. Booking call. Steps: presentation booked (and any cancelled booking, from the history).
  const bkCall = call('booking');
  const bookedItem: JourneyItem[] = pres && !byAdmin
    ? [{
        at: pres.booked_at,
        kind: 'client',
        title: 'Presentation booked',
        detail: `${pres.counsellor_name ?? 'Counsellor'} · ${input.slotLabel(pres.on_date, pres.start_time, pres.end_time)}`,
        note: null,
        by: pres.booked_by_name,
        followUp: null,
      }]
    : [];
  const bkState: Pick<JourneyTask, 'status' | 'actual' | 'notNeeded'> = pres
    ? { status: 'done', actual: pres.booked_at, notNeeded: null }
    : bkCall
      ? fromCall(bkCall, null, false)
      : completedAt && paid
        ? { status: 'open', actual: null, notNeeded: null } // no automatic call (go-live rule), still to book
        : { status: 'upcoming', actual: null, notNeeded: null };
  // An old purchase booked into a slot by hand: the booking shows as done, like any other.
  const booking = task('booking', 'Coordinator', input.coordinatorName, bkCall, pres && !byAdmin ? bkState : beforeSystem(bkState), [
    ...bookedItem,
    ...(bkCall ? [...callItems('booking', bkCall.logs), ...systemItems(bkCall.logs)] : []),
  ]);

  // 4. Report presentation (the counsellor's task). Planned = the slot.
  const slot = pres?.start_time ? slotAt(pres.on_date, pres.start_time) : null;
  const presState: Pick<JourneyTask, 'status' | 'actual' | 'notNeeded'> = !pres
    ? { status: 'upcoming', actual: null, notNeeded: null }
    : pres.done_at
      ? { status: 'done', actual: pres.done_at, notNeeded: null }
      : { status: 'open', actual: null, notNeeded: null };
  const presentation = task(
    'presentation',
    'Counsellor',
    pres?.counsellor_name ?? null,
    null,
    presState,
    pres?.done_at
      ? [{
          at: pres.done_at,
          kind: 'client',
          title: byAdmin ? 'Marked done by admin' : 'Marked done',
          detail: byAdmin ? `Happened on ${input.slotLabel(pres.on_date, null, null)} · ${pres.counsellor_name ?? 'Counsellor'}` : null,
          note: null,
          by: pres.done_by_name,
          followUp: null,
        }]
      : [],
    slot
  );
  if (byAdmin) presentation.statusNote = 'Marked by admin';
  // Done at the slot or later is on time; only an open one past its slot is late.
  presentation.actualLate = false;
  if (pres?.start_time) presentation.plannedLabel = input.slotLabel(pres.on_date, pres.start_time, pres.end_time);

  // 5. Package call. Steps: every package payment (app or manual, in parts), failed tries and "Package started"
  // (from the history). Below the start amount each payment shows how far the client is: "paid ₹4,000 of ₹10,000 to
  // start".
  const pkCall = call('package');
  const pkPays = [...input.packagePayments].sort((a, b) => a.paid_at.localeCompare(b.paid_at));
  const startPaise = input.packageStartPaise ?? null;
  let running = 0;
  const pkItems: JourneyItem[] = pkPays.map((p) => {
    const manual = p.provider === 'offline';
    if (p.refund_needed) {
      return {
        at: p.paid_at,
        kind: 'client' as const,
        title: 'Package payment – refund needed',
        detail: `${paymentMethodLabel(p)} · ${formatAmount(p.amount_paise)} · more than the remaining balance`,
        note: null,
        by: manual ? p.recorded_by_name : null,
        followUp: null,
      };
    }
    const before = running;
    running += p.amount_paise;
    const toStart = startPaise !== null && before < startPaise && running < startPaise ? ` · paid ${formatAmount(running)} of ${formatAmount(startPaise)} to start` : '';
    return {
      at: p.paid_at,
      kind: 'client' as const,
      title: manual ? 'Package payment · manual payment' : 'Package payment in the app',
      detail: `${paymentMethodLabel(p)} · ${formatAmount(p.amount_paise)}${toStart}`,
      note: null,
      by: manual ? p.recorded_by_name : null,
      followUp: null,
    };
  });
  const counted = pkPays.filter((p) => !p.refund_needed);
  const fromApp = counted.length > 0 && counted.every((p) => p.provider === 'razorpay');
  const pkState: Pick<JourneyTask, 'status' | 'actual' | 'notNeeded'> = pkCall
    ? fromCall(pkCall, fromApp ? { what: 'client bought the package in the app', at: counted.at(-1)!.paid_at } : null, counted.some((p) => p.provider === 'offline'))
    : { status: 'upcoming', actual: null, notNeeded: null };
  const pack = task('package', 'Coordinator', input.coordinatorName, pkCall, pkState, [
    ...pkItems,
    ...(pkCall ? [...callItems('package', pkCall.logs), ...systemItems(pkCall.logs)] : []),
  ]);
  if (pkCall?.outcome === 'package_started' && pkState.status === 'done') pack.statusNote = 'Package started – with CRM';

  return [payment, assessment, booking, presentation, pack];
}
