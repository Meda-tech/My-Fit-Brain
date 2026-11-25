// Package (step 6, part payments and CRM since 2026-11-24): the words and small rules the admin screens show. No
// database access; the database keeps the package, fixes the package amount (package price − assessment amount paid),
// counts every payment and decides when a package starts (migrations 20261121300000_packages.sql and
// 20261124000000_package_part_payments_crm.sql).

/** Paid in total before a session (stored and shown only; enforced later, in the CRM phase). */
export interface Milestone {
  session: number;
  paid_paise: number;
}

export interface PackageSettings {
  name: string;
  sessions: number;
  frequency: string;
  price_paise: number;
  /** The smallest first payment (booking amount). */
  first_min_paise: number;
  /** Paid in total to start: the package is handed over to CRM. */
  start_paise: number;
  milestones: Milestone[];
  updated_at: string;
}

/** The package of one assessment purchase, as the database calculates it (package_balance()). */
export interface PackageBalance {
  name: string;
  sessions: number;
  frequency: string;
  price_paise: number;
  advance_paise: number;
  /** The whole package amount: price − advance. */
  total_paise: number;
  paid_paise: number;
  remaining_paise: number;
  first_min_paise: number;
  start_paise: number;
  /** The Package purchase exists: handed over to CRM. */
  started: boolean;
}

/** One paid package payment, as the panels show it. */
export interface PackagePayment {
  id: string;
  amount_paise: number;
  paid_at: string;
  provider: 'razorpay' | 'offline';
  method: string | null;
  /** Manual payments: the reference, the proof and who recorded it. */
  reference: string | null;
  proof_url: string | null;
  recorded_by_name: string | null;
  accounts_check: 'pending' | 'checked' | null;
  /** More than the remaining balance: it counts for nothing and waits for a refund. */
  refund_needed: boolean;
  /** Paid after the handover to CRM (never shown to coordinators). */
  after_handover: boolean;
}

/**
 * The package of an assessment purchase as its side panel and My tasks show it. A coordinator sees only the payments
 * up to the handover; `complete` is false then, and no remaining amount is shown.
 */
export interface PackageState {
  payments: PackagePayment[];
  /** The sum of the payments this staff member sees that count (not refund needed). */
  paid_paise: number;
  /** The whole package amount (price − advance); null when the package is not set up. */
  total_paise: number | null;
  /** Paid in total to start (never more than the package amount). */
  start_paise: number | null;
  started: boolean;
  started_at: string | null;
  complete: boolean;
}

export type PackagePaymentState = 'paid' | 'refund_needed' | 'refunded' | 'failed' | 'not_completed';

export const PACKAGE_PAYMENT_STATE_LABELS: Record<PackagePaymentState, string> = {
  paid: 'Paid',
  refund_needed: 'Refund needed',
  refunded: 'Refunded',
  failed: 'Payment failed',
  not_completed: 'Not completed',
};

export function packagePaymentState(p: { status: string; refund_status: string | null }): PackagePaymentState {
  if (p.status === 'paid') return p.refund_status === 'needed' ? 'refund_needed' : p.refund_status === 'refunded' ? 'refunded' : 'paid';
  return p.status === 'failed' ? 'failed' : 'not_completed';
}

/** "₹31,500" (whole rupees, Indian grouping). */
export function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

/** What the coordinator sees once the package has started (read-only from then on). */
export const PACKAGE_STARTED_LABEL = 'Package started – with CRM';

/** How much is still missing to start the sessions (0 once reached). */
export function neededToStart(paidPaise: number, startPaise: number): number {
  return Math.max(startPaise - paidPaise, 0);
}

/** "Paid ₹4,000 of ₹10,000 to start" (the Package call's context line once a part is paid). */
export function paidToStartText(paidPaise: number, startPaise: number): string {
  return `Paid ${rupees(paidPaise)} of ${rupees(startPaise)} to start`;
}

type AmountRules = Pick<PackageBalance, 'paid_paise' | 'remaining_paise' | 'first_min_paise' | 'start_paise' | 'started'>;

/**
 * The smallest amount the next payment may be. The start amount is paid in at most 2 payments (owner, 2026-11-25):
 * the first at least the first minimum, the second at least the rest of the start amount. After the start: ₹1.
 */
export function minPaymentPaise(b: AmountRules): number {
  if (b.remaining_paise <= 0) return 0;
  if (b.paid_paise === 0) return Math.min(b.first_min_paise, b.remaining_paise);
  if (!b.started && b.paid_paise < b.start_paise) return Math.min(b.start_paise - b.paid_paise, b.remaining_paise);
  return Math.min(100, b.remaining_paise);
}

/** The follow-up booked with a part payment below the start amount (the same words as the database). */
export const PENDING_FOLLOW_UP_MESSAGE = 'Pick when to call the client about the rest: within 3 working days.';

/** True when a payment of this amount leaves the package below the start amount: a follow-up call is booked with it. */
export function needsPendingFollowUp(b: Pick<PackageBalance, 'paid_paise' | 'start_paise' | 'started'>, amountPaise: number): boolean {
  return !b.started && b.paid_paise + amountPaise < b.start_paise;
}

const RUPEES = /^\d{1,7}$/;
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/[,\s₹]/g, '') : typeof v === 'number' ? String(v) : '');

/**
 * Checks the amount typed in "Add package payment" (whole rupees). The same rules as the database: the first payment
 * at least the first minimum, the second at least the rest of the start amount, never more than the remaining balance.
 */
export function parsePackageAmount(
  raw: unknown,
  b: AmountRules
): { ok: true; paise: number } | { ok: false; error: string } {
  if (b.remaining_paise <= 0) return { ok: false, error: 'This package is already paid in full.' };
  const text = clean(raw);
  if (!RUPEES.test(text) || Number(text) <= 0) return { ok: false, error: 'Enter the amount in whole rupees.' };
  const paise = Number(text) * 100;
  if (paise > b.remaining_paise) return { ok: false, error: `The amount is more than the remaining balance (${rupees(b.remaining_paise)}).` };
  const min = minPaymentPaise(b);
  if (paise < min) {
    if (b.paid_paise === 0) return { ok: false, error: `The first payment must be at least ${rupees(min)}.` };
    if (!b.started) return { ok: false, error: `The second payment must be at least ${rupees(min)} (${rupees(b.start_paise)} in total to start sessions).` };
  }
  return { ok: true, paise };
}

/** The next milestone for an amount paid in total; null when the package is paid in full. */
export function nextMilestone(milestones: Milestone[], paidPaise: number, totalPaise: number): { session: number | null; paid_paise: number } | null {
  if (paidPaise >= totalPaise) return null;
  const next = milestones
    .map((m) => ({ session: m.session, paid_paise: Math.min(m.paid_paise, totalPaise) }))
    .sort((a, b) => a.paid_paise - b.paid_paise || a.session - b.session)
    .find((m) => m.paid_paise > paidPaise);
  return next ?? { session: null, paid_paise: totalPaise };
}

/** "₹15,000 before session 2" · "₹31,500 in full" · "Fully paid". */
export function milestoneLabel(next: { session: number | null; paid_paise: number } | null): string {
  if (!next) return 'Fully paid';
  return next.session === null ? `${rupees(next.paid_paise)} in full` : `${rupees(next.paid_paise)} before session ${next.session}`;
}

/** Checks the settings form. The price is typed in rupees. */
export function parsePackageSettings(fields: { name: unknown; sessions: unknown; frequency: unknown; price: unknown }):
  | { ok: true; value: { name: string; sessions: number; frequency: string; price_paise: number } }
  | { ok: false; error: string } {
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'Enter the package name (2 to 80 characters).' };
  const sessions = Number(typeof fields.sessions === 'string' ? fields.sessions.trim() : fields.sessions);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 100) return { ok: false, error: 'Enter the number of sessions (1 to 100).' };
  const frequency = typeof fields.frequency === 'string' ? fields.frequency.trim() : '';
  if (frequency.length < 2 || frequency.length > 80) return { ok: false, error: 'Enter how often the sessions are (2 to 80 characters).' };
  const price = typeof fields.price === 'string' ? fields.price.replace(/[,\s₹]/g, '') : '';
  if (!RUPEES.test(price) || Number(price) <= 3500) return { ok: false, error: 'The package price must be more than the assessment price (₹3,500), in whole rupees.' };
  return { ok: true, value: { name, sessions, frequency, price_paise: Number(price) * 100 } };
}

/** The most milestones the Settings form keeps. */
export const MAX_MILESTONES = 8;

/**
 * Checks the package amounts form (all typed in rupees): the first payment minimum, the start amount and the
 * milestones. `totalPaise` is the package amount after the advance; `sessions` the package's number of sessions.
 * A milestone row left empty is dropped. The database checks again.
 */
export function parsePackageAmounts(
  fields: { firstMin: unknown; start: unknown; milestones: { session: unknown; amount: unknown }[] },
  pkg: { totalPaise: number; sessions: number }
): { ok: true; value: { first_min_paise: number; start_paise: number; milestones: Milestone[] } } | { ok: false; error: string } {
  const firstMin = clean(fields.firstMin);
  if (!RUPEES.test(firstMin) || Number(firstMin) < 1) return { ok: false, error: 'Enter the first payment minimum in whole rupees.' };
  const start = clean(fields.start);
  if (!RUPEES.test(start) || Number(start) < Number(firstMin) || Number(start) * 100 > pkg.totalPaise) {
    return { ok: false, error: `The start amount must be between the first payment minimum and the package amount (${rupees(pkg.totalPaise)}).` };
  }
  const rows = (Array.isArray(fields.milestones) ? fields.milestones : []).filter((m) => clean(m.session) !== '' || clean(m.amount) !== '');
  if (rows.length > MAX_MILESTONES) return { ok: false, error: `At most ${MAX_MILESTONES} milestones.` };
  const milestones: Milestone[] = [];
  for (const row of rows) {
    const session = clean(row.session);
    const amount = clean(row.amount);
    if (!/^\d{1,3}$/.test(session) || !RUPEES.test(amount)) return { ok: false, error: 'Each milestone needs a session number and an amount in whole rupees.' };
    const last = milestones.at(-1);
    if (Number(session) < 1 || Number(session) > pkg.sessions || (last && Number(session) <= last.session)) {
      return { ok: false, error: `Milestone sessions must go up, from 1 to ${pkg.sessions}.` };
    }
    if (Number(amount) < 1 || Number(amount) * 100 > pkg.totalPaise || (last && Number(amount) * 100 <= last.paid_paise)) {
      return { ok: false, error: `Milestone amounts must go up and never be more than the package amount (${rupees(pkg.totalPaise)}).` };
    }
    milestones.push({ session: Number(session), paid_paise: Number(amount) * 100 });
  }
  return { ok: true, value: { first_min_paise: Number(firstMin) * 100, start_paise: Number(start) * 100, milestones } };
}

/** Milestones as stored in the database (jsonb), read safely. */
export function readMilestones(raw: unknown): Milestone[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => ({ session: Number((m as Milestone)?.session), paid_paise: Number((m as Milestone)?.paid_paise) }))
    .filter((m) => Number.isInteger(m.session) && Number.isInteger(m.paid_paise) && m.session > 0 && m.paid_paise > 0);
}
