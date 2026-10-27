import { describe, expect, it } from 'vitest';
import {
  CRISIS_QUESTION_ID,
  HOME_SAFETY_QUESTION_ID,
  YES,
  NO,
  DETAIL_MAX_LENGTH,
  buildReport,
  checkAnswer,
  checkDetailAnswer,
  parseClientDetails,
  counsellorView,
  describeShowWhen,
  nextQuestion,
  parseDefinition,
  prune,
  score,
  visibleQuestions,
  withSafety,
  type Definition,
} from '../src';

const likert = (reverse = false) => [
  { id: 'o_never', text: { en: 'Never', hi: 'कभी नहीं' }, value: reverse ? 3 : 0 },
  { id: 'o_rarely', text: { en: 'Rarely', hi: 'कभी-कभार' }, value: reverse ? 2 : 1 },
  { id: 'o_sometimes', text: { en: 'Sometimes', hi: 'कभी-कभी' }, value: reverse ? 1 : 2 },
  { id: 'o_often', text: { en: 'Often', hi: 'अक्सर' }, value: reverse ? 0 : 3 },
];

const raw = {
  title: { en: 'Test', hi: 'टेस्ट' },
  closing: { en: 'See you soon.', hi: 'जल्द मिलते हैं।' },
  plan: [
    { range: 1, name: { en: 'Clarity', hi: 'स्पष्टता' }, sessions: 4, pace: { en: 'weekly', hi: 'हर हफ्ते' } },
    { range: 4, name: { en: 'Transformation', hi: 'परिवर्तन' }, sessions: 12, pace: { en: 'weekly', hi: 'हर हफ्ते' } },
  ],
  sections: [
    {
      id: 's_about',
      title: { en: 'About you', hi: 'आपके बारे में' },
      scored: false,
      questions: [
        {
          id: 'q_partner',
          text: { en: 'Do you have a partner?', hi: 'क्या आपका कोई साथी है?' },
          options: [
            { id: 'o_yes', text: { en: 'Yes', hi: 'हाँ' }, value: null },
            { id: 'o_no', text: { en: 'No', hi: 'नहीं' }, value: null },
          ],
        },
        {
          id: 'q_health',
          text: { en: 'Any of these?', hi: 'इनमें से कुछ?' },
          multiple: true,
          max_choices: 2,
          options: [
            { id: 'o_diabetes', text: { en: 'Diabetes', hi: 'डायबिटीज़' }, value: null, note: 'Diabetes: keep in view.' },
            { id: 'o_none', text: { en: 'None', hi: 'कोई नहीं' }, value: null },
          ],
        },
      ],
    },
    {
      id: 's_couple',
      title: { en: 'Relationship', hi: 'रिश्ता' },
      show_when: { question: 'q_partner', is: ['o_yes'] },
      report: {
        meaning: [{ en: 'Low meaning' }, { en: 'Mild meaning' }, { en: 'Moderate meaning' }, { en: 'High meaning' }],
        focus: [{ en: 'Focus one', hi: 'फ़ोकस एक' }, { en: 'Focus two' }],
      },
      questions: [
        { id: 'q_c1', text: { en: 'We fight.', hi: 'हम झगड़ते हैं।' }, options: likert() },
        { id: 'q_c2', text: { en: 'I feel happy.', hi: 'मैं खुश हूँ।' }, options: likert(true) },
        { id: 'q_c3', text: { en: 'Only when fighting a lot.' }, show_when: { question: 'q_c1', is: ['o_often'] }, options: likert() },
      ],
    },
    {
      id: 's_solo',
      title: { en: 'On your own', hi: 'अकेले' },
      show_when: { question: 'q_partner', is_not: ['o_yes'] },
      questions: [{ id: 'q_s1', text: { en: 'I feel lonely.' }, options: [...likert(), { id: 'o_na', text: { en: 'N/A' }, value: null }] }],
    },
    {
      id: 's_deep',
      title: { en: 'Deeper' },
      show_when: { section: 's_couple', score_at_least: 50 },
      questions: [{ id: 'q_d1', text: { en: 'Deep question.' }, options: likert() }],
    },
  ],
};

function parsed(): Definition {
  const r = parseDefinition(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return withSafety(r.definition);
}

describe('parseDefinition', () => {
  it('accepts the example and warns about missing Hindi', () => {
    const r = parseDefinition(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definition.ranges).toHaveLength(4);
    expect(r.definition.disclaimer.en).toContain('counselling assessment');
    expect(r.warnings.some((w) => w.message.includes('No Hindi'))).toBe(true);
  });

  it('blocks invalid JSON, no questions, duplicate ids and unknown references only', () => {
    expect(parseDefinition('{ not json').ok).toBe(false);
    expect(parseDefinition({ title: { en: 'x' }, sections: [] }).ok).toBe(false);
    const dup = structuredClone(raw);
    dup.sections[1].questions[1].id = 'q_c1';
    const r = parseDefinition(dup);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain('used by another question');
    const bad = structuredClone(raw);
    bad.sections[1].show_when = { question: 'q_missing', is: ['o_yes'] };
    const b = parseDefinition(bad);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors[0].message).toContain('does not exist');
    const badOption = structuredClone(raw);
    badOption.sections[1].show_when = { question: 'q_partner', is: ['o_maybe'] };
    expect(parseDefinition(badOption).ok).toBe(false);
  });

  it('warns, never blocks, for rules that read later questions and ranges that stop short', () => {
    const later = structuredClone(raw) as typeof raw & { ranges?: unknown };
    (later.sections[0].questions[0] as { show_when?: unknown }).show_when = { question: 'q_c1', is: ['o_often'] };
    later.ranges = [{ up_to: 50, en: 'Low' }];
    const r = parseDefinition(later);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => w.message.includes('comes later'))).toBe(true);
    expect(r.warnings.some((w) => w.message.includes('do not reach 100'))).toBe(true);
    expect(r.definition.ranges).toHaveLength(4);
  });

  it('reads the optional client details: null when absent, blocked only for duplicate or missing ids and text', () => {
    const none = parseDefinition(raw);
    expect(none.ok && none.definition.client_details).toBeNull();
    const withDetails = { ...structuredClone(raw), client_details: [{ id: 'd_meds', text: { en: ' Any medicines? ', hi: 'कोई दवाई?' } }, { id: 'd_goal', text: 'Your goal?' }] };
    const r = parseDefinition(withDetails);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.definition.client_details).toEqual([
      { id: 'd_meds', text: { en: 'Any medicines?', hi: 'कोई दवाई?' } },
      { id: 'd_goal', text: { en: 'Your goal?', hi: null } },
    ]);
    expect(r.warnings.some((w) => w.where === 'client_details, question 2' && w.message.includes('No Hindi'))).toBe(true);
    expect(parseDefinition({ ...structuredClone(raw), client_details: [{ id: 'd_a', text: { en: 'A' } }, { id: 'd_a', text: { en: 'B' } }] }).ok).toBe(false);
    expect(parseDefinition({ ...structuredClone(raw), client_details: [{ id: 'd_a', text: { en: ' ' } }] }).ok).toBe(false);
    expect(parseDefinition({ ...structuredClone(raw), client_details: 'nope' }).ok).toBe(false);
    expect(parseClientDetails([]).ok).toBe(true);
  });
});

describe('client detail answers', () => {
  it('trims, requires text, caps the length and drops control characters', () => {
    expect(checkDetailAnswer('  Sugar since 2020 \r\n and BP ')).toEqual({ ok: true, answer: 'Sugar since 2020 \n and BP' });
    expect(checkDetailAnswer('a\u0000b')).toEqual({ ok: true, answer: 'ab' });
    expect(checkDetailAnswer('   ').ok).toBe(false);
    expect(checkDetailAnswer(42).ok).toBe(false);
    expect(checkDetailAnswer('x'.repeat(DETAIL_MAX_LENGTH)).ok).toBe(true);
    expect(checkDetailAnswer('x'.repeat(DETAIL_MAX_LENGTH + 1)).ok).toBe(false);
  });
});

describe('flow', () => {
  it('asks sections and questions in order and opens what the rules say', () => {
    const def = parsed();
    expect(nextQuestion(def, {})?.question.id).toBe('q_partner');
    const solo = { q_partner: ['o_no'], q_health: ['o_none'] };
    expect(visibleQuestions(def, solo).map((q) => q.id)).toEqual(['q_partner', 'q_health', 'q_s1', CRISIS_QUESTION_ID, HOME_SAFETY_QUESTION_ID]);
    const couple = { q_partner: ['o_yes'], q_health: ['o_none'], q_c1: ['o_often'], q_c2: ['o_never'] };
    expect(visibleQuestions(def, couple).map((q) => q.id)).toEqual(['q_partner', 'q_health', 'q_c1', 'q_c2', 'q_c3', 'q_d1', CRISIS_QUESTION_ID, HOME_SAFETY_QUESTION_ID]);
    const n = nextQuestion(def, couple)!;
    expect(n.question.id).toBe('q_c3');
    expect(n.position).toBe(5);
    expect(n.total).toBe(8);
  });

  it('prunes answers that are no longer shown', () => {
    const def = parsed();
    const answers = { q_partner: ['o_yes'], q_c1: ['o_often'], q_c3: ['o_never'], q_c2: ['o_never'], q_d1: ['o_often'] };
    const switched = prune(def, { ...answers, q_partner: ['o_no'] });
    expect(Object.keys(switched)).toEqual(['q_partner']);
    const calmer = prune(def, { ...answers, q_c1: ['o_never'], q_c2: ['o_often'] });
    expect(calmer.q_c3).toBeUndefined();
    expect(calmer.q_d1).toBeUndefined(); // the section score dropped to 0, under 50
  });

  it('checks an answer against the question as shown', () => {
    const def = parsed();
    const health = def.sections[0].questions[1];
    expect(checkAnswer(health, ['o_none', 'o_diabetes']).ok).toBe(true);
    expect(checkAnswer(health, ['o_none', 'o_diabetes', 'o_x']).ok).toBe(false);
    expect(checkAnswer(def.sections[0].questions[0], ['o_yes', 'o_no']).ok).toBe(false);
    expect(checkAnswer(def.sections[0].questions[0], 'o_yes')).toEqual({ ok: true, chosen: ['o_yes'] });
  });
});

describe('score', () => {
  it('scores each answer as a % of its question range and averages per section', () => {
    const def = parsed();
    const answers = {
      q_partner: ['o_yes'],
      q_health: ['o_diabetes'],
      q_c1: ['o_often'], // 100
      q_c2: ['o_rarely'], // reverse: value 2 → 67
      q_c3: ['o_never'], // 0
      q_d1: ['o_sometimes'], // 67
      [CRISIS_QUESTION_ID]: [NO],
      [HOME_SAFETY_QUESTION_ID]: [NO],
    };
    const r = score(def, answers);
    const couple = r.sections.find((s) => s.id === 's_couple')!;
    expect(couple.score).toBe(56); // (100 + 67 + 0) / 3
    expect(couple.range?.label.en).toBe('Moderate');
    expect(r.main).toBe('s_deep'); // 67 > 56
    expect(r.plan).toBeNull(); // no plan row for range 3
    expect(r.notes).toEqual([{ questionId: 'q_health', optionId: 'o_diabetes', note: 'Diabetes: keep in view.' }]);
    expect(r.valued[0]).toMatchObject({ questionId: 'q_c1', percent: 100 });
    expect(r.crisis).toBe(false);
    const about = r.sections.find((s) => s.id === 's_about')!;
    expect(about.scored).toBe(false);
    expect(about.score).toBeNull();
  });

  it('needs at least half of the shown questions answered with a value', () => {
    const def = parsed();
    const r = score(def, { q_partner: ['o_no'], q_s1: ['o_na'] });
    expect(r.sections.find((s) => s.id === 's_solo')!.score).toBeNull();
    const ok = score(def, { q_partner: ['o_no'], q_s1: ['o_often'] });
    expect(ok.sections.find((s) => s.id === 's_solo')!.score).toBe(100);
    expect(ok.plan?.sessions).toBe(12);
  });

  it('raises crisis and home-safety from the built-in questions', () => {
    const r = score(parsed(), { q_partner: ['o_no'], [CRISIS_QUESTION_ID]: [YES], [HOME_SAFETY_QUESTION_ID]: [YES] });
    expect(r.crisis).toBe(true);
    expect(r.homeSafety).toBe(true);
  });
});

describe('report and counsellor view', () => {
  const def = parsed();
  const answers = { q_partner: ['o_yes'], q_health: ['o_none'], q_c1: ['o_never'], q_c2: ['o_often'], [CRISIS_QUESTION_ID]: [NO], [HOME_SAFETY_QUESTION_ID]: [NO] };
  const input = { clientName: 'Asha', reportId: 'MFB-IA-2026-00001', completedAt: '2026-10-22T10:00:00.000Z' };

  it('builds the five parts in the chosen language and leaves empty parts out', () => {
    const r = score(def, answers);
    const en = buildReport(def, r, { ...input, lang: 'en' });
    expect(en.snapshot.areas).toEqual([{ title: 'Relationship', percent: 0, range: 'Low', meaning: 'Low meaning' }]);
    expect(en.plan).toMatchObject({ name: 'Clarity', sessions: 4, note: 'Your counsellor will confirm the format with you.' });
    expect(en.focus?.lines).toEqual(['Focus one', 'Focus two']);
    expect(en.closing?.text).toBe('See you soon.');
    expect(en.support).toBeNull();
    const hi = buildReport(def, r, { ...input, lang: 'hi' });
    expect(hi.title).toBe('टेस्ट');
    expect(hi.focus?.lines).toEqual(['फ़ोकस एक', 'Focus two']); // English fills a missing Hindi line
  });

  it('hides the plan and focus on a crisis report and prints support first', () => {
    const r = score(def, { ...answers, [CRISIS_QUESTION_ID]: [YES] });
    const rep = buildReport(def, r, { ...input, lang: 'en' });
    expect(rep.crisis).toBe(true);
    expect(rep.support).toContain('14416');
    expect(rep.plan).toBeNull();
    expect(rep.focus).toBeNull();
  });

  it('gives the counsellor alerts, notes, scores and every answer by section', () => {
    const r = score(def, { ...answers, q_health: ['o_diabetes'], [HOME_SAFETY_QUESTION_ID]: [YES] });
    const v = counsellorView(def, { ...answers, q_health: ['o_diabetes'], [HOME_SAFETY_QUESTION_ID]: [YES] }, r);
    expect(v.alerts.map((a) => a.kind)).toEqual(['home_safety']);
    expect(v.notes[0]).toMatchObject({ number: '1.2', answer: 'Diabetes' });
    expect(v.sections.map((s) => s.id)).toEqual(['s_about', 's_couple']);
    expect(v.answers.at(-1)?.section).toBe('Two last questions');
    expect(v.notable[0]).toMatchObject({ number: '2.1', percent: 0 });
  });

  it('describes rules in plain words', () => {
    expect(describeShowWhen(def, def.sections[1].show_when)).toBe('Shown when Question 1.1 is ‘Yes’');
    expect(describeShowWhen(def, def.sections[2].show_when)).toBe('Shown when Question 1.1 is not ‘Yes’');
    expect(describeShowWhen(def, def.sections[3].show_when)).toBe('Shown when the score of ‘Relationship’ is at least 50%');
    expect(describeShowWhen(def, null)).toBe('Always shown');
  });
});
