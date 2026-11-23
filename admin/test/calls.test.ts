import { describe, expect, it } from 'vitest';
import {
  CALL_CHOICES,
  CALL_CHOICE_LABELS,
  CALL_KIND_LABELS,
  CALL_REASON_LABELS,
  addWorkingHours,
  choiceLabel,
  choicesFor,
  packageContext,
  packageInformContext,
  assessmentContext,
  fromIstInput,
  needsFollowUp,
  paymentContext,
  TASK_SHOWS,
  TASK_SHOW_LABELS,
  dueLabel,
  isCallLate,
  isTaskShow,
  toIstInput,
} from '../lib/calls';

const ist = (s: string) => new Date(`${s}+05:30`);

describe('working hours (same cases as the database check)', () => {
  it('Fri 17:30 + 2 h = Sat 10:30', () => {
    expect(addWorkingHours(ist('2026-11-20T17:30:00'), 2)).toEqual(ist('2026-11-21T10:30:00'));
  });
  it('Sat 17:00 + 2 h = Mon 10:00 (Sunday off)', () => {
    expect(addWorkingHours(ist('2026-11-21T17:00:00'), 2)).toEqual(ist('2026-11-23T10:00:00'));
  });
  it('before opening and on Sunday count from 9:00', () => {
    expect(addWorkingHours(ist('2026-11-23T07:00:00'), 2)).toEqual(ist('2026-11-23T11:00:00'));
    expect(addWorkingHours(ist('2026-11-22T11:00:00'), 1)).toEqual(ist('2026-11-23T10:00:00'));
  });
  it('9 h = one full day; 2 working days = 18 h', () => {
    expect(addWorkingHours(ist('2026-11-23T09:00:00'), 9)).toEqual(ist('2026-11-23T18:00:00'));
    expect(addWorkingHours(ist('2026-11-23T09:00:00'), 10)).toEqual(ist('2026-11-24T10:00:00'));
    expect(addWorkingHours(ist('2026-11-20T16:49:00'), 18)).toEqual(ist('2026-11-23T16:49:00'));
  });
});

describe('calls', () => {
  it('uses the team words', () => {
    expect(CALL_KIND_LABELS).toEqual({
      payment: 'Payment call',
      assessment: 'Assessment call',
      booking: 'Booking call',
      package: 'Package call',
      package_inform: 'Package paid – inform the team',
    });
    // A package paid after the purchase was closed: a short task, Done only (owner, 2026-11-23).
    expect(choicesFor('package_inform').map((c) => choiceLabel('package_inform', c))).toEqual(['Done']);
    expect(packageInformContext('2026-11-24T06:00:00Z')).toBe('Package paid 24 Nov, after the purchase was closed');
    expect(choiceLabel('package', 'done')).toBe('Client agreed');
    expect(choicesFor('package').map((c) => choiceLabel('package', c))).toEqual(['Client agreed – will pay', 'Call later', 'Not picked', 'Not interested']);
    expect(choicesFor('booking')).toEqual(CALL_CHOICES);
    expect(needsFollowUp('agreed')).toBe(true);
    expect(choiceLabel('booking', 'done')).toBe('Done');
    expect(packageContext('2026-11-21T06:00:00Z', 'Test Counsellor')).toBe('Presentation done 21 Nov by Test Counsellor');
    expect(CALL_CHOICES.map((c) => CALL_CHOICE_LABELS[c])).toEqual(['Done', 'Call later', 'Not picked', 'Not interested']);
    expect(Object.values(CALL_REASON_LABELS)).toEqual(['Too costly', 'Not now', 'Wrong number', 'Other']);
    expect(needsFollowUp('call_later') && needsFollowUp('not_picked') && !needsFollowUp('done')).toBe(true);
  });

  it('filters All · Late only · Upcoming; due labels in India time', () => {
    expect(TASK_SHOWS.map((s) => TASK_SHOW_LABELS[s])).toEqual(['All', 'Late only', 'Upcoming']);
    expect(isTaskShow('late') && !isTaskShow('overdue')).toBe(true);
    const now = ist('2026-11-20T16:00:00');
    expect(isCallLate(ist('2026-11-20T15:59:00').toISOString(), now)).toBe(true);
    expect(dueLabel(ist('2026-11-20T23:30:00').toISOString(), now)).toBe('Today, 11:30 pm');
    expect(dueLabel(ist('2026-11-21T09:49:00').toISOString(), now)).toBe('Tomorrow, 9:49 am');
    expect(dueLabel(ist('2026-11-23T10:00:00').toISOString(), now)).toBe('Mon, 23 Nov, 10:00 am');
  });

  it('follow-up field reads and writes India time', () => {
    const d = ist('2026-11-21T10:30:00');
    expect(toIstInput(d)).toBe('2026-11-21T10:30');
    expect(fromIstInput('2026-11-21T10:30')).toEqual(d);
    expect(fromIstInput('nonsense')).toBeNull();
  });

  it('context lines', () => {
    const now = ist('2026-11-20T18:00:00');
    expect(paymentContext(2, ist('2026-11-20T16:19:00').toISOString(), false, now)).toBe('2 tries, last 4:19 pm');
    expect(paymentContext(1, ist('2026-11-19T16:19:00').toISOString(), true, now)).toBe('1 try, last 19 Nov, 4:19 pm · payment failed');
    expect(assessmentContext(ist('2026-11-19T12:00:00').toISOString(), 'not_started')).toBe('Paid 19 Nov · assessment not started');
  });
});
