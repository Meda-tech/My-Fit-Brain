import { describe, expect, it } from 'vitest';
import { JOURNEY_STAGES, JOURNEY_STAGE_LABELS, PURCHASE_STATUS_LABELS, currentStage, isLate } from '../lib/purchases';

describe('purchase journey', () => {
  it('has the five stages in order, in the team words', () => {
    expect(JOURNEY_STAGES.map((s) => JOURNEY_STAGE_LABELS[s])).toEqual([
      'Payment',
      'Assessment',
      'Presentation booking',
      'Report presentation',
      'Package call',
    ]);
    expect(PURCHASE_STATUS_LABELS.not_paid).toBe('Payment failed');
    expect(PURCHASE_STATUS_LABELS.paid).toBe('Paid');
  });

  it('the stage now is the first one not done', () => {
    const stages = [
      { stage: 'assessment' as const, position: 2, status: 'open' as const },
      { stage: 'payment' as const, position: 1, status: 'done' as const },
      { stage: 'presentation_booking' as const, position: 3, status: 'waiting' as const },
    ];
    expect(currentStage(stages)).toBe('assessment');
    expect(currentStage(stages.map((s) => ({ ...s, status: 'done' as const })))).toBeNull();
  });

  it('late = planned time passed and not done', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    expect(isLate({ planned_at: '2026-11-20T09:00:00Z', done_at: null }, now)).toBe(true);
    expect(isLate({ planned_at: '2026-11-20T11:00:00Z', done_at: null }, now)).toBe(false);
    expect(isLate({ planned_at: '2026-11-20T09:00:00Z', done_at: '2026-11-20T09:30:00Z' }, now)).toBe(false);
    expect(isLate({ planned_at: null, done_at: null }, now)).toBe(false);
  });
});
