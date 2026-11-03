import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_PRICE_PAISE,
  PROOF_MAX_BYTES,
  detectProofType,
  indiaToday,
  paidAtFor,
  parseCancelReason,
  parseOfflinePayment,
  proofFileName,
  proofProblem,
} from '../lib/offline-payments';

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(32).fill(0)]);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);

describe('price', () => {
  it('matches the online price in the clients app', () => {
    const source = readFileSync(path.join(__dirname, '../../clients/lib/payments/service.ts'), 'utf8');
    const m = /export const ASSESSMENT_PRICE_PAISE = ([\d_]+);/.exec(source);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ''))).toBe(ASSESSMENT_PRICE_PAISE);
  });
});

describe('proof file', () => {
  it('detects the type from the bytes', () => {
    expect(detectProofType(JPG)).toBe('image/jpeg');
    expect(detectProofType(PNG)).toBe('image/png');
    expect(detectProofType(WEBP)).toBe('image/webp');
    expect(detectProofType(PDF)).toBe('application/pdf');
    expect(detectProofType(bytes(0x3c, 0x73, 0x76, 0x67))).toBeNull(); // <svg
    expect(detectProofType(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull(); // GIF
  });

  it('refuses missing, too large and other files', () => {
    expect(proofProblem(null)).toMatch(/Add the payment proof/);
    expect(proofProblem(new Uint8Array())).toMatch(/Add the payment proof/);
    const big = new Uint8Array(PROOF_MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(proofProblem(big)).toMatch(/larger than 4 MB/);
    expect(proofProblem(bytes(0x50, 0x4b, 3, 4))).toMatch(/JPG, PNG, WebP image or a PDF/);
    expect(proofProblem(PDF)).toBeNull();
  });

  it('names the file by payment ID and date, never the client', () => {
    expect(proofFileName('7c1e0b6a-0000-4000-8000-000000000001', '2026-11-03', 'image/png')).toBe(
      '7c1e0b6a-0000-4000-8000-000000000001_2026-11-03.png'
    );
  });
});

describe('date paid', () => {
  // 2026-11-03 10:00 in India.
  const now = new Date('2026-11-03T04:30:00Z');

  it('uses India dates', () => {
    expect(indiaToday(new Date('2026-11-02T19:00:00Z'))).toBe('2026-11-03');
  });

  it('today is now; an earlier day is noon India time', () => {
    expect(paidAtFor('2026-11-03', now)).toEqual({ ok: true, paidAt: now.toISOString() });
    expect(paidAtFor('2026-11-01', now)).toEqual({ ok: true, paidAt: '2026-11-01T06:30:00.000Z' });
  });

  it('refuses the future, very old and impossible dates', () => {
    expect(paidAtFor('2026-11-04', now).ok).toBe(false);
    expect(paidAtFor('2025-10-01', now).ok).toBe(false);
    expect(paidAtFor('2026-02-30', now).ok).toBe(false);
    expect(paidAtFor('', now).ok).toBe(false);
  });
});

describe('form fields', () => {
  const now = new Date('2026-11-03T04:30:00Z');
  const valid = { code: 'IA', method: 'upi', paidOn: '2026-11-02', reference: '  4123  9876 ', note: '' };

  it('accepts a complete form and cleans the reference', () => {
    const r = parseOfflinePayment(valid, now);
    expect(r).toEqual({ ok: true, value: { code: 'IA', method: 'upi', reference: '4123 9876', note: null, paidAt: '2026-11-02T06:30:00.000Z' } });
  });

  it('requires assessment, method and reference', () => {
    expect(parseOfflinePayment({ ...valid, code: '' }, now).ok).toBe(false);
    expect(parseOfflinePayment({ ...valid, method: 'cash' }, now).ok).toBe(false);
    expect(parseOfflinePayment({ ...valid, reference: '   ' }, now).ok).toBe(false);
    expect(parseOfflinePayment({ ...valid, reference: 'x'.repeat(101) }, now).ok).toBe(false);
    expect(parseOfflinePayment({ ...valid, note: 'x'.repeat(501) }, now).ok).toBe(false);
  });

  it('requires a cancel reason', () => {
    expect(parseCancelReason('  ').ok).toBe(false);
    expect(parseCancelReason('x'.repeat(501)).ok).toBe(false);
    expect(parseCancelReason(' Recorded twice ')).toEqual({ ok: true, reason: 'Recorded twice' });
  });
});
