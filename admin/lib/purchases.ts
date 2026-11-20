// Purchases and the purchase journey (step 1): the words and the small rules the screen shows.
// No database access; the database keeps the data (migration 20261120100000_purchases.sql).

export type PurchaseStatus = 'not_paid' | 'paid' | 'refunded' | 'cancelled';

/** not_paid covers every try that did not end in a payment. */
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  not_paid: 'Payment failed',
  paid: 'Paid',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

export const PURCHASE_KIND_LABELS: Record<string, string> = { assessment: 'Assessment' };

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
