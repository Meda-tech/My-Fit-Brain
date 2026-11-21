// Calls (step 2): the words and the small rules the screens show. No database access; the database makes,
// closes and checks calls (migration 20261120120000_calls.sql, call_mark()).

export type CallKind = 'payment' | 'assessment' | 'booking' | 'package';
export type CallChoice = 'done' | 'call_later' | 'not_picked' | 'not_interested';
export type CallReason = 'too_costly' | 'not_now' | 'wrong_number' | 'other';
export type CallEvent =
  | 'created'
  | 'new_try'
  | 'try_failed'
  | 'paid'
  | 'assessment_completed'
  | 'ended'
  | 'reopened'
  | 'presentation_booked'
  | 'booking_cancelled';
export type CallOutcome = 'done' | 'not_interested' | 'paid' | 'assessment_completed' | 'ended' | 'before_go_live' | 'booked';

export const CALL_KIND_LABELS: Record<CallKind, string> = {
  payment: 'Payment call',
  assessment: 'Assessment call',
  booking: 'Booking call',
  package: 'Package call',
};

export const CALL_CHOICES: readonly CallChoice[] = ['done', 'call_later', 'not_picked', 'not_interested'];
export const CALL_CHOICE_LABELS: Record<CallChoice, string> = {
  done: 'Done',
  call_later: 'Call later',
  not_picked: 'Not picked',
  not_interested: 'Not interested',
};

export const CALL_REASONS: readonly CallReason[] = ['too_costly', 'not_now', 'wrong_number', 'other'];
export const CALL_REASON_LABELS: Record<CallReason, string> = {
  too_costly: 'Too costly',
  not_now: 'Not now',
  wrong_number: 'Wrong number',
  other: 'Other',
};

export const CALL_EVENT_LABELS: Record<CallEvent, string> = {
  created: 'Call created',
  new_try: 'New try on the pay page',
  try_failed: 'Tried again – failed',
  paid: 'Paid: call closed',
  assessment_completed: 'Assessment completed: call closed',
  ended: 'Refunded or cancelled: call closed',
  reopened: 'Payment call reopened',
  presentation_booked: 'Presentation booked',
  booking_cancelled: 'Booking cancelled',
};

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  done: 'Done',
  not_interested: 'Not interested',
  paid: 'Closed: paid',
  assessment_completed: 'Closed: assessment completed',
  ended: 'Closed: refunded or cancelled',
  before_go_live: 'Closed: paid more than 7 days before go-live',
  booked: 'Closed: presentation booked',
};

export const CALL_NOTE_MAX = 2000;
/** "Within 2 working days" = 18 working hours (9:00–18:00). */
export const FOLLOW_UP_WORKING_HOURS = 18;
export const NEEDS_EARLIER_CALL = 'At least one follow-up call is needed first.';

export function needsFollowUp(choice: CallChoice): boolean {
  return choice === 'call_later' || choice === 'not_picked';
}

// --- India time (UTC+5:30, no daylight saving) and working hours ------------------------------------------

const IST_MS = 330 * 60 * 1000;
const HOUR_MS = 3600 * 1000;

/**
 * The same rule as the database's add_working_hours(): Mon–Sat 9:00–18:00 India time, Sunday off. A start outside
 * working time counts from the next opening (Fri 17:30 + 2 h = Sat 10:30).
 */
export function addWorkingHours(at: Date, hours: number): Date {
  let local = at.getTime() + IST_MS; // India wall clock, read with the UTC getters
  let left = Math.max(hours, 0) * HOUR_MS;
  for (;;) {
    const d = new Date(local);
    const day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const open = day0 + 9 * HOUR_MS;
    const close = day0 + 18 * HOUR_MS;
    if (d.getUTCDay() === 0 || local >= close) {
      local = day0 + 24 * HOUR_MS + 9 * HOUR_MS;
      continue;
    }
    if (local < open) local = open;
    if (local + left <= close) return new Date(local + left - IST_MS);
    left -= close - local;
    local = day0 + 24 * HOUR_MS + 9 * HOUR_MS;
  }
}

/** "2026-11-21T10:30" (India time) for a datetime-local field. */
export function toIstInput(at: Date): string {
  return new Date(at.getTime() + IST_MS).toISOString().slice(0, 16);
}

/** A datetime-local value read as India time; null when it is not a valid date and time. */
export function fromIstInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function istDay(at: Date): string {
  return new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);
}

/**
 * My tasks shows one list in due-time order (owner, 2026-11-20). The filter at the top: All · Late only (due time
 * passed) · Upcoming (not due yet).
 */
/** 'unmarked' (super admins only): presentations whose slot time passed but nobody marked done (step 5). */
export type TaskShow = 'all' | 'late' | 'upcoming' | 'unmarked';
export const TASK_SHOWS: readonly TaskShow[] = ['all', 'late', 'upcoming'];
export const TASK_SHOW_LABELS: Record<TaskShow, string> = {
  all: 'All',
  late: 'Late only',
  upcoming: 'Upcoming',
  unmarked: 'Presentations not marked done',
};

export function isTaskShow(v: unknown): v is TaskShow {
  return typeof v === 'string' && ([...TASK_SHOWS, 'unmarked'] as readonly string[]).includes(v);
}

export function isCallLate(dueAt: string, now: Date): boolean {
  return new Date(dueAt).getTime() < now.getTime();
}

/** "Today, 4:19 pm" · "Tomorrow, 9:49 am" · "Mon, 23 Nov, 10:00 am" (India time). */
export function dueLabel(dueAt: string, now: Date): string {
  const due = new Date(dueAt);
  const t = due.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  if (istDay(due) === istDay(now)) return `Today, ${t}`;
  if (istDay(due) === istDay(new Date(now.getTime() + 24 * HOUR_MS))) return `Tomorrow, ${t}`;
  const d = due.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  return `${d}, ${t}`;
}

// --- The one context line of a task -----------------------------------------------------------------------

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** "2 tries, last 4:19 pm" (a date is added when the last try was not today); "· payment failed" when it failed. */
export function paymentContext(tries: number, lastTriedAt: string, lastFailed: boolean, now: Date): string {
  const when = istDay(new Date(lastTriedAt)) === istDay(now) ? time(lastTriedAt) : `${day(lastTriedAt)}, ${time(lastTriedAt)}`;
  return `${tries} ${tries === 1 ? 'try' : 'tries'}, last ${when}${lastFailed ? ' · payment failed' : ''}`;
}

export type AssessmentProgress = 'not_started' | 'in_progress' | 'completed';
const PROGRESS_TEXT: Record<AssessmentProgress, string> = {
  not_started: 'assessment not started',
  in_progress: 'assessment started, not finished',
  completed: 'assessment completed',
};

/** "Paid 19 Nov · assessment not started". */
export function assessmentContext(paidAt: string | null, progress: AssessmentProgress): string {
  return `${paidAt ? `Paid ${day(paidAt)}` : 'Paid'} · ${PROGRESS_TEXT[progress]}`;
}

/** The My tasks address for a coordinator filter and a show filter. */
export function tasksHref(coordinatorId: string, show: TaskShow, open?: string): string {
  const q = new URLSearchParams();
  if (coordinatorId) q.set('coordinator', coordinatorId);
  if (show !== 'all') q.set('show', show);
  if (open) q.set('open', open);
  return q.size ? `/tasks?${q}` : '/tasks';
}

/** "Assessment completed 20 Nov" (the Booking call's context line). */
export function bookingContext(completedAt: string | null): string {
  return completedAt ? `Assessment completed ${day(completedAt)}` : 'Assessment completed';
}

/** The choice as the screens show it: on a Package call, Done is "Client agreed" (owner, 2026-11-21). */
export function choiceLabel(kind: CallKind, choice: CallChoice): string {
  return kind === 'package' && choice === 'done' ? 'Client agreed' : CALL_CHOICE_LABELS[choice];
}

/** A closed call's result in words: on a Package call, done is "Client agreed". */
export function outcomeLabel(kind: CallKind, outcome: CallOutcome): string {
  return kind === 'package' && outcome === 'done' ? 'Client agreed' : CALL_OUTCOME_LABELS[outcome];
}

/** "Presentation done 21 Nov by Test Counsellor" (the Package call's context line). */
export function packageContext(doneAt: string | null, counsellorName: string | null): string {
  return `Presentation done${doneAt ? ` ${day(doneAt)}` : ''}${counsellorName ? ` by ${counsellorName}` : ''}`;
}
