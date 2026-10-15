import { describe, expect, it } from 'vitest';
import { slug } from '../src/parse-excel';
import { parseBank } from './helpers';

describe('parseWorkbook — real question banks', async () => {
  const ia = await parseBank('IA');
  const ma = await parseBank('MA');

  it('parses both workbooks without errors', () => {
    expect(ia.errors).toEqual([]);
    expect(ma.errors).toEqual([]);
    expect(ia.payload).not.toBeNull();
    expect(ma.payload).not.toBeNull();
  });

  it('detects test and version from the README title', () => {
    expect(ia.payload!.test_code).toBe('IA');
    expect(ia.payload!.version_label).toBe('1.1');
    expect(ma.payload!.test_code).toBe('MA');
    expect(ma.payload!.version_label).toBe('1.0');
  });

  it('has 99 Intimacy and 58 Mind questions', () => {
    expect(ia.payload!.questions).toHaveLength(99);
    expect(ma.payload!.questions).toHaveLength(58);
  });

  it('every label and text has EN and HI', () => {
    for (const p of [ia.payload!, ma.payload!]) {
      for (const m of p.modules) expect(m.name_en && m.name_hi, m.code).toBeTruthy();
      for (const q of p.questions) expect(q.text_en && q.text_hi, q.qid).toBeTruthy();
      for (const o of p.options) expect(o.label_en && o.label_hi, `${o.qid}.${o.option_code}`).toBeTruthy();
      for (const t of p.texts) expect(t.text_en && t.text_hi, t.key).toBeTruthy();
      for (const t of p.item_texts) expect(t.text_en && t.text_hi, t.qid).toBeTruthy();
      for (const t of p.tiers) expect(t.plan_en && t.plan_hi && t.pace_en && t.pace_hi).toBeTruthy();
    }
  });

  it('every likert question has 4 options valued 0–3 with stable codes', () => {
    for (const p of [ia.payload!, ma.payload!]) {
      for (const q of p.questions.filter((x) => x.type === 'likert')) {
        const opts = p.options.filter((o) => o.qid === q.qid);
        expect(opts.map((o) => [o.option_code, o.value]), q.qid).toEqual([
          ['never', 0], ['rarely', 1], ['sometimes', 2], ['often', 3],
        ]);
      }
    }
  });

  it('yn questions are no = 0, yes = 3', () => {
    for (const p of [ia.payload!, ma.payload!]) {
      for (const q of p.questions.filter((x) => x.type === 'yn')) {
        expect(p.options.filter((o) => o.qid === q.qid).map((o) => [o.option_code, o.value]), q.qid).toEqual([
          ['no', 0], ['yes', 3],
        ]);
      }
    }
  });

  it('I1 is stored as single, split on " / ", with age-band codes and no values', () => {
    const p = ia.payload!;
    expect(p.questions.find((q) => q.qid === 'I1')!.type).toBe('single');
    expect(p.options.filter((o) => o.qid === 'I1').map((o) => [o.option_code, o.value])).toEqual([
      ['under_18', null], ['18_24', null], ['25_34', null], ['35_44', null], ['45_54', null], ['55_plus', null],
    ]);
    expect(p.options.find((o) => o.qid === 'I1' && o.option_code === 'under_18')!.label_hi).toBe('18 से कम');
    expect(ma.payload!.options.filter((o) => o.qid === 'MI1')).toHaveLength(6);
  });

  it('" / " inside a label is kept when options use " | "', () => {
    const o = ma.payload!.options.find((x) => x.qid === 'MI3' && x.option_code === 'self_employed_business')!;
    expect(o.label_en).toBe('Self-employed / business');
    expect(o.label_hi).toBe('स्वरोज़गार / व्यवसाय');
  });

  it('Reverse mixes TRUE/True/FALSE/False and booleans', () => {
    const p = ia.payload!;
    const reverse = (qid: string) => p.questions.find((q) => q.qid === qid)!.reverse;
    expect(reverse('C1')).toBe(true); // "TRUE" string
    expect(reverse('C4')).toBe(false); // "FALSE" string
    expect(reverse('CS1')).toBe(true); // boolean true
    expect(reverse('CS2')).toBe(false); // boolean false
    expect(ma.payload!.questions.filter((q) => q.reverse).map((q) => q.qid)).toEqual([
      'MC1', 'MC2', 'MC6', 'MC7', 'MC9', 'MC10', 'W8', 'K8',
    ]);
  });

  it('Scored is yes / no / points; Points only on D1–D3 and MD1–MD3', () => {
    expect(ia.payload!.questions.filter((q) => q.scored === 'points').map((q) => q.qid)).toEqual(['D1', 'D2', 'D3']);
    expect(ma.payload!.questions.filter((q) => q.scored === 'points').map((q) => q.qid)).toEqual(['MD1', 'MD2', 'MD3']);
  });

  it('extracts embedded scores and strips them from EN and HI labels', () => {
    const d1 = ia.payload!.options.filter((o) => o.qid === 'D1');
    expect(d1.map((o) => [o.option_code, o.value, o.label_en])).toEqual([
      ['less_than_3_months', 0, 'Less than 3 months'],
      ['3_12_months', 1, '3–12 months'],
      ['1_3_years', 2, '1–3 years'],
      ['more_than_3_years', 3, 'More than 3 years'],
    ]);
    expect(d1[0].label_hi).toBe('3 महीने से कम');
    for (const qid of ['D4', 'R1', 'I2', 'I6', 'M10']) {
      expect(ia.payload!.options.filter((o) => o.qid === qid).every((o) => o.value === null), qid).toBe(true);
    }
    expect(ma.payload!.options.filter((o) => o.qid === 'MD4').every((o) => o.value === null)).toBe(true);
  });

  it('gate options take their letter as the code, in both languages', () => {
    const g1 = ia.payload!.options.filter((o) => o.qid === 'G1');
    expect(g1.map((o) => o.option_code)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(g1[0].label_en.startsWith('Fights')).toBe(true);
    expect(g1[0].label_hi.startsWith('A:')).toBe(false);
    expect(ma.payload!.options.filter((o) => o.qid === 'MG1').map((o) => o.option_code)).toEqual(['H', 'L', 'W', 'K']);
  });

  it('R1 / MR1 have a none_of_these option', () => {
    expect(ia.payload!.options.some((o) => o.qid === 'R1' && o.option_code === 'none_of_these')).toBe(true);
    expect(ma.payload!.options.some((o) => o.qid === 'MR1' && o.option_code === 'none_of_these')).toBe(true);
  });

  it('paths: Intimacy uses the Path column; Mind (no column) is all', () => {
    const count = (path: string) => ia.payload!.questions.filter((q) => q.path === path).length;
    expect([count('all'), count('partner'), count('solo')]).toEqual([50, 39, 10]);
    expect(ma.payload!.questions.every((q) => q.path === 'all')).toBe(true);
  });

  it('Strengths & Stuck triggers map to the three forms', () => {
    const triggers = (p: typeof ia) => [...new Set(p.payload!.item_texts.map((t) => `${t.kind}:${t.trigger}`))].sort();
    expect(triggers(ia)).toEqual(['strength:often', 'stuck:often_or_sometimes', 'stuck:often_sometimes_or_yes']);
    expect(triggers(ma)).toEqual(['strength:often', 'stuck:often_or_sometimes']);
  });

  it('report texts and flag texts share one key space', () => {
    const keys = ia.payload!.texts.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['INTERP_CORE_LOW', 'PLAN_LINE', 'CRISIS', 'SAFETY', 'AGE_STOP', 'MED_MALE']));
    expect(ia.payload!.texts).toHaveLength(63 + 6);
    expect(ma.payload!.texts).toHaveLength(44 + 7);
  });

  it('tiers and band rows are read from Session Tiers', () => {
    expect(ia.payload!.tiers.map((t) => t.sessions)).toEqual([4, 6, 8, 12]);
    expect(ia.payload!.sheet_bands.map((b) => `${b.min}-${b.max} ${b.name_en}`)).toEqual([
      '0-25 Low', '26-50 Mild', '51-75 Moderate', '76-100 High',
    ]);
  });

  it('Worked Examples: only the literal Expected tier and Format are read', () => {
    expect(ia.payload!.sheet_worked_examples.map((w) => `${w.case}:${w.expected_tier}`)).toEqual([
      'A:4', 'B:6', 'C:8', 'D:12', 'E:6', 'F:12',
    ]);
    expect(ma.payload!.sheet_worked_examples.map((w) => `${w.case}:${w.expected_tier}`)).toEqual([
      'A:6', 'B:12', 'C:4', 'D:12', 'E:8',
    ]);
  });
});

describe('slug', () => {
  it('makes stable snake_case option codes', () => {
    expect(slug('Under 18')).toBe('under_18');
    expect(slug('18–24')).toBe('18_24');
    expect(slug('55+')).toBe('55_plus');
    expect(slug('None of these')).toBe('none_of_these');
    expect(slug('Self-help: videos, books, articles')).toBe('self_help_videos_books_articles');
  });
});
