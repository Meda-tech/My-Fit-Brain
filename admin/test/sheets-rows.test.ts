import { describe, expect, it } from 'vitest';
import { byPaymentTime, indiaTime, latest, replacedTries, type Try } from '../lib/integrations/sheets-rows';

const t = (id: string, status: string, created_at: string, test_code = 'IA', phone = '+919800000010'): Try => ({
  id,
  phone,
  test_code,
  status,
  created_at,
});

describe('replacedTries', () => {
  it('two failed tries then paid → only the paid one stays', () => {
    const tries = [t('a', 'failed', '2026-11-05T04:30:00Z'), t('b', 'failed', '2026-11-05T04:35:00Z'), t('c', 'paid', '2026-11-05T04:42:00Z')];
    expect([...replacedTries(tries)].sort()).toEqual(['a', 'b']);
  });

  it('never paid → the last try stays', () => {
    const tries = [t('a', 'failed', '2026-11-05T04:30:00Z'), t('b', 'created', '2026-11-05T04:35:00Z')];
    expect([...replacedTries(tries)]).toEqual(['a']);
  });

  it('a paid purchase is never left out, even with a later purchase', () => {
    const tries = [t('a', 'paid', '2026-11-05T04:30:00Z'), t('b', 'failed', '2026-11-12T04:30:00Z'), t('c', 'paid', '2026-11-12T04:33:00Z')];
    expect([...replacedTries(tries)]).toEqual(['b']);
  });

  it('another test or another number is a separate purchase', () => {
    const tries = [
      t('a', 'failed', '2026-11-05T04:30:00Z', 'IA'),
      t('b', 'paid', '2026-11-05T04:35:00Z', 'MA'),
      t('c', 'paid', '2026-11-05T04:40:00Z', 'IA', '+919800000011'),
    ];
    expect(replacedTries(tries).size).toBe(0);
  });
});

describe('times and order', () => {
  it('shows India time', () => {
    expect(indiaTime('2026-11-05T04:42:05Z')).toBe('2026-11-05 10:12:05');
    expect(indiaTime('2026-11-05T20:00:00+00:00')).toBe('2026-11-06 01:30:00');
  });

  it('picks the latest time, ignoring empty ones', () => {
    expect(latest('2026-11-05T04:30:00Z', null, '2026-11-06T04:30:00Z', undefined)).toBe('2026-11-06T04:30:00Z');
  });

  it('sorts oldest first, then by id', () => {
    const rows = [
      { id: 'b', time: '2026-11-05T05:00:00Z' },
      { id: 'c', time: '2026-11-04T05:00:00Z' },
      { id: 'a', time: '2026-11-05T05:00:00Z' },
    ];
    expect(rows.sort(byPaymentTime).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});
