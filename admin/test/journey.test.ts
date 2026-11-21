import { describe, expect, it } from 'vitest';
import { buildJourney, type JourneyInput } from '../lib/journey';

const slotLabel = (d: string, s: string) => `${d} ${s.slice(0, 5)}`;
const NOW = new Date('2026-11-25T10:00:00Z');
const log = (over: Partial<JourneyInput['calls'][number]['logs'][number]>) => ({
  id: Math.random().toString(36).slice(2),
  at: '2026-11-20T06:00:00Z',
  entry: 'call' as const,
  choice: null,
  reason: null,
  note: null,
  follow_up_at: null,
  event: null,
  by_name: 'Test Coordinator',
  ...over,
});

const base: Omit<JourneyInput, 'calls' | 'payments' | 'presentation' | 'packagePaid' | 'status'> = { coordinatorName: 'Test Coordinator', slotLabel };

describe('journey: a finished journey', () => {
  const input: JourneyInput = {
    ...base,
    status: 'paid',
    payments: [
      { status: 'failed', provider: 'razorpay', method: null, amount_paise: 350000, currency: 'INR', paid_at: null, created_at: '2026-11-20T05:00:00Z', refund_status: null, recorded_by_name: null, attempt: null },
      {
        status: 'paid', provider: 'razorpay', method: 'upi', amount_paise: 350000, currency: 'INR', paid_at: '2026-11-20T07:00:00Z', created_at: '2026-11-20T06:50:00Z',
        refund_status: null, recorded_by_name: null, attempt: { started_at: '2026-11-20T08:00:00Z', completed_at: '2026-11-20T09:00:00Z' },
      },
    ],
    calls: [
      // Called once (Not picked), then the client paid: done.
      { id: 'p', kind: 'payment', status: 'closed', outcome: 'paid', due_at: '2026-11-20T07:30:00Z', closed_at: '2026-11-20T07:00:00Z', closed_note: null, prior_calls: 1,
        logs: [log({ at: '2026-11-20T05:30:00Z', choice: 'not_picked', note: 'Rang twice', follow_up_at: '2026-11-20T08:00:00Z' })] },
      // Nobody called: the client completed first → not needed.
      { id: 'a', kind: 'assessment', status: 'closed', outcome: 'assessment_completed', due_at: '2026-11-20T09:00:00Z', closed_at: '2026-11-20T09:00:00Z', closed_note: null, prior_calls: 0, logs: [] },
      { id: 'b', kind: 'booking', status: 'closed', outcome: 'booked', due_at: '2026-11-20T11:00:00Z', closed_at: '2026-11-20T10:00:00Z', closed_note: null, prior_calls: 0, logs: [] },
      // Called (Client agreed – will pay), then the package was bought in the app: done.
      { id: 'k', kind: 'package', status: 'closed', outcome: 'package_paid', due_at: '2026-11-24T09:00:00Z', closed_at: '2026-11-24T10:00:00Z', closed_note: null, prior_calls: 1,
        logs: [log({ at: '2026-11-24T06:00:00Z', choice: 'agreed', follow_up_at: '2026-11-24T09:00:00Z' })] },
    ],
    presentation: { counsellor_name: 'Test Counsellor', on_date: '2026-11-23', start_time: '10:00:00', booked_at: '2026-11-20T10:00:00Z', booked_by_name: 'Test Coordinator', done_at: '2026-11-23T05:00:00Z', done_by_name: 'Test Counsellor' },
    packagePaid: { amount_paise: 3150000, paid_at: '2026-11-24T10:00:00Z', provider: 'razorpay', method: 'netbanking', recorded_by_name: null },
  };
  const j = buildJourney(input, NOW);

  it('five tasks in order, with who', () => {
    expect(j.map((t) => t.title)).toEqual(['Payment call', 'Assessment call', 'Booking call', 'Report presentation', 'Package call']);
    expect(j.map((t) => `${t.whoRole}: ${t.who}`)).toEqual([
      'Coordinator: Test Coordinator', 'Coordinator: Test Coordinator', 'Coordinator: Test Coordinator', 'Counsellor: Test Counsellor', 'Coordinator: Test Coordinator',
    ]);
  });

  it('statuses: called then paid = done; completed before any call = not needed; package bought after a call = done', () => {
    expect(j.map((t) => t.status)).toEqual(['done', 'not_needed', 'done', 'done', 'done']);
    expect(j[1].notNeeded).toEqual({ what: 'client completed the assessment', at: '2026-11-20T09:00:00Z' });
    expect(j[1].planned).toBeNull();
    expect(j[4].actual).toBe('2026-11-24T10:00:00Z');
    // Done after the follow-up due time: shown late.
    expect(j[4].actualLate).toBe(true);
  });

  it('nested lines in time order: tries, call attempts with note and follow-up, client steps', () => {
    expect(j[0].items.map((i) => i.title)).toEqual(['Tried to pay · failed', 'Not picked', 'Client paid']);
    expect(j[0].items[1]).toMatchObject({ note: 'Rang twice', by: 'Test Coordinator', followUp: '2026-11-20T08:00:00Z' });
    expect(j[0].items[2].detail).toBe('Razorpay · UPI · ₹3,500');
    expect(j[1].items.map((i) => i.title)).toEqual(['Assessment started', 'Assessment completed']);
    expect(j[2].items[0]).toMatchObject({ title: 'Presentation booked', detail: 'Test Counsellor · 2026-11-23 10:00', by: 'Test Coordinator' });
    expect(j[3].items[0]).toMatchObject({ title: 'Marked done', by: 'Test Counsellor' });
    expect(j[4].items.map((i) => i.title)).toEqual(['Client agreed – will pay', 'Package paid in the app']);
  });
});

describe('journey: in progress', () => {
  it('paid directly with no Payment call = not needed; Assessment call open and late; the rest upcoming', () => {
    const j = buildJourney(
      {
        ...base,
        status: 'paid',
        payments: [{ status: 'paid', provider: 'razorpay', method: 'card', amount_paise: 350000, currency: 'INR', paid_at: '2026-11-24T05:00:00Z', created_at: '2026-11-24T04:55:00Z', refund_status: null, recorded_by_name: null, attempt: { started_at: '2026-11-24T06:00:00Z', completed_at: null } }],
        calls: [{ id: 'a', kind: 'assessment', status: 'open', outcome: null, due_at: '2026-11-24T07:00:00Z', closed_at: null, closed_note: null, prior_calls: 0, logs: [] }],
        presentation: null,
        packagePaid: null,
      },
      NOW
    );
    expect(j.map((t) => t.status)).toEqual(['not_needed', 'open', 'upcoming', 'upcoming', 'upcoming']);
    expect(j[0].notNeeded).toEqual({ what: 'client paid directly', at: '2026-11-24T05:00:00Z' });
    expect(j[1]).toMatchObject({ late: true, callId: 'a', planned: '2026-11-24T07:00:00Z' });
    expect(j[1].items.map((i) => i.title)).toEqual(['Assessment started']);
  });

  it('Not interested on the Payment call shows ✕; later tasks stay upcoming', () => {
    const j = buildJourney(
      {
        ...base,
        status: 'not_paid',
        payments: [{ status: 'failed', provider: 'razorpay', method: null, amount_paise: 350000, currency: 'INR', paid_at: null, created_at: '2026-11-24T05:00:00Z', refund_status: null, recorded_by_name: null, attempt: null }],
        calls: [{ id: 'p', kind: 'payment', status: 'closed', outcome: 'not_interested', due_at: '2026-11-24T07:00:00Z', closed_at: '2026-11-24T08:00:00Z', closed_note: null, prior_calls: 2,
          logs: [log({ at: '2026-11-24T06:00:00Z', choice: 'not_picked', follow_up_at: '2026-11-24T07:00:00Z' }), log({ at: '2026-11-24T08:00:00Z', choice: 'not_interested', reason: 'too_costly', note: 'Maybe next month' })] }],
        presentation: null,
        packagePaid: null,
      },
      NOW
    );
    expect(j[0].status).toBe('not_interested');
    expect(j[0].items.map((i) => i.title)).toEqual(['Tried to pay · failed', 'Not picked', 'Not interested · Too costly']);
    expect(j.slice(1).every((t) => t.status === 'upcoming')).toBe(true);
  });

  it('a manual package payment recorded by the coordinator is done, never "not needed"', () => {
    const j = buildJourney(
      {
        ...base,
        status: 'paid',
        payments: [],
        calls: [{ id: 'k', kind: 'package', status: 'closed', outcome: 'package_paid', due_at: '2026-11-24T07:00:00Z', closed_at: '2026-11-24T06:00:00Z', closed_note: null, prior_calls: 0, logs: [] }],
        presentation: null,
        packagePaid: { amount_paise: 3150000, paid_at: '2026-11-24T06:00:00Z', provider: 'offline', method: 'bank_transfer', recorded_by_name: 'Test Coordinator' },
      },
      NOW
    );
    expect(j[4]).toMatchObject({ status: 'done', actual: '2026-11-24T06:00:00Z', actualLate: false });
    expect(j[4].items[0]).toMatchObject({ title: 'Package paid · manual payment', detail: 'Bank transfer · ₹31,500', by: 'Test Coordinator' });
  });
});
