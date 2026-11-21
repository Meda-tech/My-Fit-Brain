// The purchase journey as our team's five tasks (side panel), with the call attempts and the client's own steps
// nested under the task they belong to. Display only: no rule or data changes; everything comes from what the
// database already keeps (calls and call history, payments, the assessment, the booking, the package payment).
//
//   1. Payment call · 2. Assessment call · 3. Booking call · 4. Report presentation (counsellor) · 5. Package call
//
// Status of a task: done ✓ · open ● · upcoming ○ · not interested ✕ · not needed (strikethrough). "Not needed" = the
// client did it before anyone called (the call closed by itself with no call attempt), or the call was never made
// because it was not needed (e.g. paid directly: no Payment call).

import { formatAmount } from '../components/payments/amount';
import { paymentMethodLabel } from '../components/payments/format';
import { CALL_EVENT_LABELS, CALL_REASON_LABELS, choiceLabel, type CallChoice, type CallEvent, type CallKind, type CallOutcome, type CallReason } from './calls';

export type JourneyTaskKey = 'payment' | 'assessment' | 'booking' | 'presentation' | 'package';
export type JourneyStatus = 'done' | 'open' | 'upcoming' | 'not_interested' | 'not_needed';

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
  }[];
  presentation: {
    counsellor_name: string | null;
    on_date: string;
    start_time: string;
    booked_at: string;
    booked_by_name: string | null;
    done_at: string | null;
    done_by_name: string | null;
  } | null;
  packagePaid: { amount_paise: number; paid_at: string; provider: 'razorpay' | 'offline'; method: string | null; recorded_by_name: string | null } | null;
  /** "Mon, 23 Nov 2026, 10:00" for a slot (the screens' own formatter). */
  slotLabel: (date: string, start: string) => string;
}

/** The slot start as an instant (India time). */
function slotAt(date: string, start: string): string {
  return new Date(`${date}T${start.slice(0, 8)}+05:30`).toISOString();
}

const later = (a: string | null, b: string | null) => !!a && !!b && new Date(a).getTime() > new Date(b).getTime();

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
const SYSTEM_EVENTS: CallEvent[] = ['reopened', 'booking_cancelled', 'package_payment_failed', 'package_payment_not_completed', 'package_refund_needed'];
function systemItems(logs: LogIn[]): JourneyItem[] {
  return logs
    .filter((l) => l.entry === 'event' && l.event && SYSTEM_EVENTS.includes(l.event))
    .map((l) => ({ at: l.at, kind: 'system' as const, title: CALL_EVENT_LABELS[l.event!], detail: l.note, note: null, by: l.by_name, followUp: null }));
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
    case 'paid':
    case 'assessment_completed':
    case 'package_paid':
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
  const paidPayment = input.payments.find((p) => p.status === 'paid' && p.paid_at) ?? null;
  const attempt = paidPayment?.attempt ?? null;
  const completedAt = attempt?.completed_at ?? null;
  const pres = input.presentation;
  const pkg = input.packagePaid;
  const nowIso = now.toISOString();

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
    planned: state.status === 'not_needed' ? null : planned,
    late: state.status === 'open' && !!planned && later(nowIso, planned),
    actualLate: state.status === 'done' && later(state.actual, planned),
    callId: c?.status === 'open' ? c.id : null,
    priorCalls: c?.prior_calls ?? 0,
    items: [...items].sort(byTime),
  });

  // 1. Payment call. Client steps: every try on the pay page, and the payment.
  const payCall = call('payment');
  const payItems: JourneyItem[] = input.payments.map((p) => {
    const manual = p.provider === 'offline';
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
  const payment = task('payment', 'Coordinator', input.coordinatorName, payCall, payState, [
    ...payItems,
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
  const assessment = task('assessment', 'Coordinator', input.coordinatorName, asCall, asState, [
    ...asItems,
    ...(asCall ? [...callItems('assessment', asCall.logs), ...systemItems(asCall.logs)] : []),
  ]);

  // 3. Booking call. Steps: presentation booked (and any cancelled booking, from the history).
  const bkCall = call('booking');
  const bookedItem: JourneyItem[] = pres
    ? [{
        at: pres.booked_at,
        kind: 'client',
        title: 'Presentation booked',
        detail: `${pres.counsellor_name ?? 'Counsellor'} · ${input.slotLabel(pres.on_date, pres.start_time)}`,
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
  const booking = task('booking', 'Coordinator', input.coordinatorName, bkCall, bkState, [
    ...bookedItem,
    ...(bkCall ? [...callItems('booking', bkCall.logs), ...systemItems(bkCall.logs)] : []),
  ]);

  // 4. Report presentation (the counsellor's task). Planned = the slot.
  const slot = pres ? slotAt(pres.on_date, pres.start_time) : null;
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
    pres?.done_at ? [{ at: pres.done_at, kind: 'client', title: 'Marked done', detail: null, note: null, by: pres.done_by_name, followUp: null }] : [],
    slot
  );
  // Done at the slot or later is on time; only an open one past its slot is late.
  presentation.actualLate = false;

  // 5. Package call. Steps: package paid (app or manual), failed tries (from the history).
  const pkCall = call('package');
  const pkItems: JourneyItem[] = pkg
    ? [{
        at: pkg.paid_at,
        kind: 'client',
        title: pkg.provider === 'offline' ? 'Package paid · manual payment' : 'Package paid in the app',
        detail: `${paymentMethodLabel(pkg)} · ${formatAmount(pkg.amount_paise)}`,
        note: null,
        by: pkg.provider === 'offline' ? pkg.recorded_by_name : null,
        followUp: null,
      }]
    : [];
  const pkState: Pick<JourneyTask, 'status' | 'actual' | 'notNeeded'> = pkCall
    ? fromCall(pkCall, pkg ? { what: 'client bought the package in the app', at: pkg.paid_at } : null, pkg?.provider === 'offline')
    : { status: 'upcoming', actual: null, notNeeded: null };
  const pack = task('package', 'Coordinator', input.coordinatorName, pkCall, pkState, [
    ...pkItems,
    ...(pkCall ? [...callItems('package', pkCall.logs), ...systemItems(pkCall.logs)] : []),
  ]);

  return [payment, assessment, booking, presentation, pack];
}
