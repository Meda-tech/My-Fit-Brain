import { describe, expect, it } from 'vitest';
import {
  PACKAGE_PAYMENT_STATE_LABELS,
  milestoneLabel,
  minPaymentPaise,
  neededToStart,
  nextMilestone,
  packagePaymentState,
  paidToStartText,
  parsePackageAmount,
  parsePackageAmounts,
  parsePackageSettings,
  readMilestones,
  rupees,
} from '../lib/package';

const MILESTONES = [
  { session: 1, paid_paise: 1_000_000 },
  { session: 2, paid_paise: 1_500_000 },
  { session: 3, paid_paise: 2_500_000 },
  { session: 4, paid_paise: 3_150_000 },
];
const TOTAL = 3_150_000;

describe('package part payments', () => {
  const fresh = { paid_paise: 0, remaining_paise: TOTAL, first_min_paise: 100_000 };
  const partPaid = { paid_paise: 400_000, remaining_paise: 2_750_000, first_min_paise: 100_000 };

  it('the first payment is at least ₹1,000; later payments can be any amount', () => {
    expect(parsePackageAmount('999', fresh)).toEqual({ ok: false, error: 'The first payment must be at least ₹1,000.' });
    expect(parsePackageAmount('1,000', fresh)).toEqual({ ok: true, paise: 100_000 });
    expect(parsePackageAmount('500', partPaid)).toEqual({ ok: true, paise: 50_000 });
    expect(minPaymentPaise(fresh)).toBe(100_000);
    expect(minPaymentPaise(partPaid)).toBe(100);
  });

  it('never more than the remaining balance; whole rupees only; nothing once paid in full', () => {
    expect(parsePackageAmount('31500', fresh)).toEqual({ ok: true, paise: TOTAL });
    expect(parsePackageAmount('31501', fresh)).toEqual({ ok: false, error: 'The amount is more than the remaining balance (₹31,500).' });
    expect(parsePackageAmount('27,501', partPaid)).toEqual({ ok: false, error: 'The amount is more than the remaining balance (₹27,500).' });
    expect(parsePackageAmount('100.50', partPaid).ok).toBe(false);
    expect(parsePackageAmount('', partPaid)).toEqual({ ok: false, error: 'Enter the amount in whole rupees.' });
    expect(parsePackageAmount('0', partPaid).ok).toBe(false);
    expect(parsePackageAmount('100', { paid_paise: TOTAL, remaining_paise: 0, first_min_paise: 100_000 })).toEqual({ ok: false, error: 'This package is already paid in full.' });
  });

  it('a small balance left: the first minimum is never more than what remains', () => {
    expect(parsePackageAmount('500', { paid_paise: 0, remaining_paise: 50_000, first_min_paise: 100_000 })).toEqual({ ok: true, paise: 50_000 });
  });

  it('"₹X more needed to start sessions" and the Package call line', () => {
    expect(neededToStart(400_000, 1_000_000)).toBe(600_000);
    expect(neededToStart(1_200_000, 1_000_000)).toBe(0);
    expect(paidToStartText(400_000, 1_000_000)).toBe('Paid ₹4,000 of ₹10,000 to start');
    expect(rupees(3_150_000)).toBe('₹31,500');
  });

  it('next milestone: a milestone already paid counts as met', () => {
    expect(milestoneLabel(nextMilestone(MILESTONES, 400_000, TOTAL))).toBe('₹10,000 before session 1');
    expect(milestoneLabel(nextMilestone(MILESTONES, 1_000_000, TOTAL))).toBe('₹15,000 before session 2');
    expect(milestoneLabel(nextMilestone(MILESTONES, 2_600_000, TOTAL))).toBe('₹31,500 before session 4');
    expect(milestoneLabel(nextMilestone(MILESTONES, TOTAL, TOTAL))).toBe('Fully paid');
    // Past the last milestone but not paid in full (the milestones do not reach the package amount).
    expect(milestoneLabel(nextMilestone(MILESTONES.slice(0, 2), 2_000_000, TOTAL))).toBe('₹31,500 in full');
    // A milestone above the package amount counts as the package amount.
    expect(nextMilestone([{ session: 2, paid_paise: 9_000_000 }], 0, TOTAL)).toEqual({ session: 2, paid_paise: TOTAL });
  });
});

describe('package amounts (Settings)', () => {
  const pkg = { totalPaise: TOTAL, sessions: 8 };
  const rows = [
    { session: '1', amount: '10,000' },
    { session: '2', amount: '15000' },
    { session: '3', amount: '25000' },
    { session: '4', amount: '31500' },
  ];

  it('accepts the owner\'s amounts, typed in rupees; an empty milestone row is dropped', () => {
    expect(parsePackageAmounts({ firstMin: '1,000', start: '10000', milestones: [...rows, { session: '', amount: '' }] }, pkg)).toEqual({
      ok: true,
      value: { first_min_paise: 100_000, start_paise: 1_000_000, milestones: MILESTONES },
    });
  });

  it('refuses a start amount below the first minimum or above the package amount', () => {
    expect(parsePackageAmounts({ firstMin: '2000', start: '1000', milestones: rows }, pkg).ok).toBe(false);
    expect(parsePackageAmounts({ firstMin: '1000', start: '31501', milestones: rows }, pkg).ok).toBe(false);
    expect(parsePackageAmounts({ firstMin: '0', start: '10000', milestones: rows }, pkg).ok).toBe(false);
  });

  it('refuses milestones that do not go up, a session above the number of sessions, and an amount above the package amount', () => {
    const bad = (milestones: { session: string; amount: string }[]) => parsePackageAmounts({ firstMin: '1000', start: '10000', milestones }, pkg).ok;
    expect(bad([{ session: '2', amount: '10000' }, { session: '2', amount: '15000' }])).toBe(false);
    expect(bad([{ session: '1', amount: '15000' }, { session: '2', amount: '10000' }])).toBe(false);
    expect(bad([{ session: '9', amount: '10000' }])).toBe(false);
    expect(bad([{ session: '1', amount: '31501' }])).toBe(false);
    expect(bad([{ session: '1', amount: '' }])).toBe(false);
    expect(bad([])).toBe(true);
  });

  it('reads stored milestones safely', () => {
    expect(readMilestones([{ session: 1, paid_paise: 1_000_000 }, { session: 'x' }, null])).toEqual([{ session: 1, paid_paise: 1_000_000 }]);
    expect(readMilestones('nope')).toEqual([]);
  });
});

describe('package settings', () => {
  it('accepts the default package; the price is typed in rupees', () => {
    expect(parsePackageSettings({ name: ' Counselling package ', sessions: '8', frequency: '1 session every week', price: '35,000' })).toEqual({
      ok: true,
      value: { name: 'Counselling package', sessions: 8, frequency: '1 session every week', price_paise: 3_500_000 },
    });
  });

  it('refuses a missing name, bad sessions, and a price not above the assessment price', () => {
    const base = { name: 'Plan', sessions: '8', frequency: 'weekly', price: '35000' };
    expect(parsePackageSettings({ ...base, name: ' ' }).ok).toBe(false);
    expect(parsePackageSettings({ ...base, sessions: '0' }).ok).toBe(false);
    expect(parsePackageSettings({ ...base, sessions: '2.5' }).ok).toBe(false);
    expect(parsePackageSettings({ ...base, frequency: '' }).ok).toBe(false);
    expect(parsePackageSettings({ ...base, price: '3500' }).ok).toBe(false);
    expect(parsePackageSettings({ ...base, price: 'abc' }).ok).toBe(false);
  });
});

describe('package payment state', () => {
  it('shows a second paid payment as Refund needed', () => {
    expect(packagePaymentState({ status: 'paid', refund_status: null })).toBe('paid');
    expect(packagePaymentState({ status: 'paid', refund_status: 'needed' })).toBe('refund_needed');
    expect(packagePaymentState({ status: 'created', refund_status: null })).toBe('not_completed');
    expect(packagePaymentState({ status: 'failed', refund_status: null })).toBe('failed');
    expect(PACKAGE_PAYMENT_STATE_LABELS.refund_needed).toBe('Refund needed');
  });
});
