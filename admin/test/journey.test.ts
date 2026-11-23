import { describe, expect, it } from 'vitest';
import { buildJourney, type JourneyInput } from '../lib/journey';

const slotLabel = (d: string, s: string | null) => (s ? `${d} ${s.slice(0, 5)}` : d);
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
    presentation: { counsellor_name: 'Test Counsellor', on_date: '2026-11-23', start_time: '10:00:00', end_time: '10:30:00', booked_at: '2026-11-20T10:00:00Z', booked_by_name: 'Test Coordinator', done_at: '2026-11-23T05:00:00Z', done_by_name: 'Test Counsellor' },
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
    expect(j[0].items.map((i) => i.title)).toEqual(['Tried to pay · failed', 'Not picked / Call later', 'Client paid']);
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
    expect(j[0].items.map((i) => i.title)).toEqual(['Tried to pay · failed', 'Not picked / Call later', 'Not interested · Too costly']);
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

describe('journey: a purchase from before the system (owner, 2026-11-21)', () => {
  const old: JourneyInput = {
    ...base,
    status: 'paid',
    beforeSystem: true,
    payments: [
      {
        status: 'paid', provider: 'razorpay', method: 'upi', amount_paise: 350000, currency: 'INR', paid_at: '2026-11-01T07:00:00Z', created_at: '2026-11-01T06:50:00Z',
        refund_status: null, recorded_by_name: null, attempt: { started_at: '2026-11-01T08:00:00Z', completed_at: '2026-11-01T09:00:00Z' },
      },
    ],
    // The Assessment call the go-live rule closed.
    calls: [{ id: 'a', kind: 'assessment', status: 'closed', outcome: 'before_go_live', due_at: '2026-11-01T09:00:00Z', closed_at: '2026-11-20T13:00:00Z', closed_note: 'Before the system: no automatic call.', prior_calls: 0, logs: [] }],
    presentation: null,
    packagePaid: null,
  };

  it('tasks 1–3 say "Before the system": nothing planned, nothing late, no call to mark; the presentation waits for the admin', () => {
    const j = buildJourney(old, NOW);
    expect(j.map((t) => t.status)).toEqual(['before_system', 'before_system', 'before_system', 'upcoming', 'upcoming']);
    expect(j.slice(0, 3).every((t) => t.planned === null && !t.late && t.callId === null)).toBe(true);
    expect(j.some((t) => t.late)).toBe(false);
  });

  it('booked into a slot by hand: the Booking task is done as usual, the presentation is open with its slot', () => {
    const j = buildJourney(
      {
        ...old,
        presentation: {
          counsellor_name: 'Test Counsellor', on_date: '2026-11-26', start_time: '10:00:00', end_time: '10:30:00', marked_by_admin: false,
          booked_at: '2026-11-25T06:00:00Z', booked_by_name: 'Test Coordinator', done_at: null, done_by_name: null,
        },
      },
      NOW
    );
    expect(j.map((t) => t.status)).toEqual(['before_system', 'before_system', 'done', 'open', 'upcoming']);
    expect(j[2].items).toEqual([expect.objectContaining({ title: 'Presentation booked', by: 'Test Coordinator' })]);
    expect(j[3]).toMatchObject({ plannedLabel: '2026-11-26 10:00', late: false });
  });

  it('marked done by an admin: Report presentation done, "Marked by admin", no slot; the Package call runs as usual', () => {
    const j = buildJourney(
      {
        ...old,
        presentation: {
          counsellor_name: 'Test Counsellor', on_date: '2026-11-18', start_time: null, end_time: null, marked_by_admin: true,
          booked_at: '2026-11-25T06:00:00Z', booked_by_name: 'Test Super Admin', done_at: '2026-11-25T06:00:00Z', done_by_name: 'Test Super Admin',
        },
        calls: [...old.calls, { id: 'k', kind: 'package', status: 'open', outcome: null, due_at: '2026-11-25T08:00:00Z', closed_at: null, closed_note: null, prior_calls: 0, logs: [] }],
      },
      NOW
    );
    expect(j.map((t) => t.status)).toEqual(['before_system', 'before_system', 'before_system', 'done', 'open']);
    expect(j[3]).toMatchObject({ who: 'Test Counsellor', statusNote: 'Marked by admin', planned: null, actual: '2026-11-25T06:00:00Z' });
    expect(j[3].items).toEqual([expect.objectContaining({ title: 'Marked done by admin', detail: 'Happened on 2026-11-18 · Test Counsellor', by: 'Test Super Admin' })]);
    // No "Presentation booked" line: nothing was booked.
    expect(j[2].items).toEqual([]);
    expect(j[4]).toMatchObject({ status: 'open', callId: 'k', planned: '2026-11-25T08:00:00Z' });
  });
});

describe('journey: tries after paying (owner, 2026-11-23)', () => {
  const paidOnce = {
    status: 'paid', provider: 'offline' as const, method: 'upi', amount_paise: 350000, currency: 'INR', paid_at: '2026-11-17T09:19:00Z',
    created_at: '2026-11-17T09:19:00Z', refund_status: null, recorded_by_name: 'Reetu', attempt: { started_at: '2026-11-17T10:00:00Z', completed_at: '2026-11-17T11:00:00Z' },
  };
  const j = buildJourney(
    {
      ...base,
      status: 'paid',
      payments: [
        // A second payment that still came through (two tabs): listed first, as the newest.
        { status: 'paid', provider: 'razorpay', method: 'upi', amount_paise: 350000, currency: 'INR', paid_at: '2026-11-22T16:05:00Z', created_at: '2026-11-22T16:04:00Z',
          refund_status: 'needed', recorded_by_name: null, attempt: null, extra_paid: true },
        // A try after paying, moved onto this purchase as history (e.g. 22 Nov, 9:33 pm).
        { status: 'created', provider: 'razorpay', method: null, amount_paise: 350000, currency: 'INR', paid_at: null, created_at: '2026-11-22T16:03:00Z',
          refund_status: null, recorded_by_name: null, attempt: null },
        paidOnce,
        // The try before paying.
        { status: 'created', provider: 'razorpay', method: null, amount_paise: 350000, currency: 'INR', paid_at: null, created_at: '2026-11-17T08:11:00Z',
          refund_status: null, recorded_by_name: null, attempt: null },
      ],
      blockedTries: [{ at: '2026-11-23T05:00:00Z', signed_in: false }],
      calls: [],
      presentation: null,
      packagePaid: null,
    },
    NOW
  );

  it('the purchase speaks with its first payment, never the extra one', () => {
    expect(j[0]).toMatchObject({ status: 'not_needed', notNeeded: { what: 'paid by manual payment', at: '2026-11-17T09:19:00Z' } });
    expect(j[1].notNeeded).toEqual({ what: 'client completed the assessment', at: '2026-11-17T11:00:00Z' });
  });

  it('later tries are history: blocked, not completed, paid a second time (refund needed)', () => {
    expect(j[0].items.map((i) => i.title)).toEqual([
      'Started to pay · not completed',
      'Paid · manual payment',
      'Tried again – not completed, already paid 17 Nov 2026',
      'Paid a second time – refund needed',
      'Tried again – blocked, already paid 17 Nov 2026',
    ]);
    expect(j[0].items[3].detail).toBe('Razorpay · UPI · ₹3,500 · already paid 17 Nov 2026');
    expect(j[0].items[4].detail).toBe('Pay page · no payment made');
  });

  it('a Payment call closed as not needed (an extra row) reads "had already paid"', () => {
    const extra = buildJourney(
      {
        ...base,
        status: 'not_paid',
        payments: [],
        calls: [{ id: 'x', kind: 'payment', status: 'closed', outcome: 'not_needed', due_at: '2026-11-23T05:00:00Z', closed_at: '2026-11-23T06:00:00Z',
          closed_note: 'Not needed – client already paid on 17 Nov 2026.', prior_calls: 0, logs: [] }],
        presentation: null,
        packagePaid: null,
      },
      NOW
    );
    expect(extra[0]).toMatchObject({ status: 'not_needed', notNeeded: { what: 'had already paid for this assessment', at: '2026-11-23T06:00:00Z' } });
  });
});
