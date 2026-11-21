import { describe, expect, it } from 'vitest';
import { PACKAGE_PAYMENT_STATE_LABELS, packagePaymentState, parsePackageSettings } from '../lib/package';

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
