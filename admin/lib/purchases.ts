// Purchases and the purchase journey (step 1): the words and the small rules the screen shows.
// No database access; the database keeps the data (migrations 20261120100000_purchases.sql and
// 20261120110000_payment_attempts.sql).

/**
 * A purchase is paid, or was paid and then refunded or cancelled. A try that is not paid is a payment attempt
 * (status not_paid in the database) and is never shown as a purchase. When the phone pays the same
 * assessment, the attempt becomes the purchase.
 */
export type PurchaseStatus = 'paid' | 'refunded' | 'cancelled';
export const PURCHASE_STATUSES: readonly PurchaseStatus[] = ['paid', 'refunded', 'cancelled'];

/** A row on the Purchases screen: a purchase, or an open payment attempt (not_paid, shown as "Unpaid"). */
export type PurchaseRowStatus = PurchaseStatus | 'not_paid';

/** The tabs of the Purchases screen. */
export const PURCHASE_TABS = ['unpaid', 'paid', 'all'] as const;
export type PurchaseTab = (typeof PURCHASE_TABS)[number];
export const PURCHASE_TAB_LABELS: Record<PurchaseTab, string> = { unpaid: 'Unpaid', paid: 'Paid', all: 'All' };

export function isPurchaseTab(v: unknown): v is PurchaseTab {
  return typeof v === 'string' && (PURCHASE_TABS as readonly string[]).includes(v);
}

/** The tab a page opens on when none is chosen: coordinators start on Unpaid when they have any, else Paid. */
export function defaultPurchaseTab(role: string, unpaidCount: number): PurchaseTab {
  if (role === 'coordinator') return unpaidCount > 0 ? 'unpaid' : 'paid';
  return 'all';
}

export const PURCHASE_STATUS_LABELS: Record<PurchaseRowStatus, string> = {
  not_paid: 'Unpaid',
  paid: 'Paid',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

export const PURCHASE_KIND_LABELS: Record<string, string> = { assessment: 'Assessment' };

/**
 * "Close purchase" (owner, 2026-11-23): a Paid purchase is closed by a super admin or the client's coordinator, with a
 * reason. It is then finished: its open calls close, and a new try or payment of the number starts a new purchase.
 */
export const CLOSE_REASON_MIN = 3;
export const CLOSE_REASON_MAX = 300;
/** The database's own refusals, shown as they are. */
export const CLOSE_MESSAGES = [
  'Only coordinators and super admins can close a purchase.',
  'Write the reason (3 to 300 characters).',
  'This purchase was not found.',
  'Only this client\'s coordinator can close their purchase.',
  'This purchase is already closed.',
  'Only a paid purchase can be closed.',
  'A presentation is booked. Cancel the booking first.',
] as const;

export const JOURNEY_STAGES = ['payment', 'assessment', 'presentation_booking', 'report_presentation', 'package_call'] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export const JOURNEY_STAGE_LABELS: Record<JourneyStage, string> = {
  payment: 'Payment',
  assessment: 'Assessment',
  presentation_booking: 'Presentation booking',
  report_presentation: 'Report presentation',
  package_call: 'Package call',
};

export type StageStatus = 'waiting' | 'open' | 'done';

export interface StageRow {
  stage: JourneyStage;
  position: number;
  planned_at: string | null;
  done_at: string | null;
  status: StageStatus;
}

/** The stage the purchase is at now (the open one), or null when every stage is done. */
export function currentStage(stages: Pick<StageRow, 'stage' | 'status' | 'position'>[]): JourneyStage | null {
  const open = [...stages].sort((a, b) => a.position - b.position).find((s) => s.status !== 'done');
  return open?.stage ?? null;
}

/** Late = planned time passed and the stage is not done. */
export function isLate(s: Pick<StageRow, 'planned_at' | 'done_at'>, now: Date): boolean {
  return !s.done_at && !!s.planned_at && new Date(s.planned_at).getTime() < now.getTime();
}

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  waiting: 'Waiting',
  open: 'Now',
  done: 'Done',
};
