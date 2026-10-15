import { describe, expect, it } from 'vitest';
import { SEED_TESTS } from '../seeds/index';
import { prepareImport } from '../src/import';
import { parseWorkbook } from '../src/parse-excel';
import { brokenWorkbook } from './fixtures/broken-workbook';

describe('broken workbook', async () => {
  const data = await brokenWorkbook();
  const result = await parseWorkbook(data, { fileName: 'broken.xlsx', tests: SEED_TESTS });

  it('is rejected with no payload', () => {
    expect(result.payload).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('explains each problem with tab, row and question', () => {
    const expected = [
      /Questions row 2 \(X1\): unknown Type "slider"/,
      /Questions row 2 \(X1\): Reverse must be TRUE or FALSE/,
      /Questions row 2 \(X1\): Scored\? must be Yes, No or Points/,
      /Questions row 3 \(X2\): Question \(HI\) is empty/,
      /Questions row 3 \(X2\): 4 EN options but 2 HI options/,
      /Questions row 4 \(X2\): duplicate ID/,
      /Questions row 4 \(X2\): Path must be ALL, PARTNER or SOLO/,
      /Questions row 5 \(X3\): options must be "EN options \|\| HI options"/,
      /Session Tiers row 2: plan and pace need EN and HI/,
      /Session Tiers: expected 4 band rows, found 0/,
      /Report Text row 2 \(TITLE\): unknown Band "Severe"/,
      /Report Text row 2 \(TITLE\): Text \(HI\) is empty/,
      /Strengths & Stuck row 2 \(X1\): Kind must be STRENGTH or STUCK/,
      /Strengths & Stuck row 2 \(X1\): unknown Trigger/,
      /Flags & Safety: missing column "Text \(HI\)"/,
    ];
    for (const pattern of expected) {
      expect(result.errors.some((e) => pattern.test(e)), `${pattern} in\n${result.errors.join('\n')}`).toBe(true);
    }
  });

  it('a file that is not a workbook is rejected', async () => {
    const r = await parseWorkbook(new TextEncoder().encode('not an excel file'), { fileName: 'x.xlsx', tests: SEED_TESTS });
    expect(r.payload).toBeNull();
    expect(r.errors).toEqual(['The file could not be read as an Excel workbook (.xlsx).']);
  });

  it('a workbook for an unknown test is rejected', async () => {
    const r = await prepareImport(data, { fileName: 'broken.xlsx', tests: [{ code: 'PA', name_en: 'MFB Parenting Assessment' }] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('does not name a known test'))).toBe(true);
  });
});
