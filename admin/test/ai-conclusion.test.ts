import { describe, expect, it } from 'vitest';
import type { CounsellorView, Report } from '@mfb/questionnaire';
import { CONCLUSION_SYSTEM_PROMPT, MAX_NOTABLE, buildConclusionInput, conclusionFromAi } from '../lib/ai/conclusion-prompt';
import { bulletLines } from '../lib/conclusion';

const report: Report = {
  lang: 'en',
  title: 'MFB Mind Assessment',
  subtitle: null,
  designedBy: 'Designed by Dr. Neha Mehta',
  clientName: 'Asha Verma',
  date: '2026-11-05T10:00:00Z',
  reportId: 'MFB-MA-2026-00042',
  disclaimer: 'This is a screening.',
  crisis: false,
  support: null,
  snapshot: {
    heading: 'Your snapshot',
    areas: [
      { title: 'Stress', percent: 72, range: 'High', meaning: 'Stress is taking a lot of your energy.' },
      { title: 'Sleep', percent: null, range: null, meaning: null },
    ],
  },
  plan: { heading: 'Your plan', name: 'Focused support', sessions: 8, pace: 'weekly', note: '' },
  focus: { heading: 'What sessions will work on', title: 'Stress', lines: ['Noticing early signs of stress'] },
  closing: null,
};

const view = (over: Partial<CounsellorView> = {}): CounsellorView => ({
  alerts: [],
  notes: [{ question: 'q', number: '1', answer: 'a', note: 'Ask about work hours.' }],
  main: { title: 'Stress', score: 72, range: 'High' },
  plan: null,
  sections: [],
  notable: Array.from({ length: 20 }, (_, i) => ({ number: String(i + 1), question: `Question ${i + 1}`, answer: `Answer ${i + 1}`, value: 3, percent: 100 - i })),
  answers: [],
  ...over,
});

const input = (over: Partial<Parameters<typeof buildConclusionInput>[0]> = {}) =>
  buildConclusionInput({
    questionnaire: 'MFB Mind Assessment',
    report,
    view: view(),
    client: { age: 31, gender: 'Female', relationship: 'Married' },
    details: [{ question: 'What brings you here?', answer: 'Work pressure\nand poor sleep' }],
    ...over,
  });

describe('buildConclusionInput', () => {
  it('never sends the name or the report ID', () => {
    const text = input();
    expect(text).not.toContain('Asha');
    expect(text).not.toContain('MFB-MA-2026-00042');
  });

  it('sends scores, plan, focus, notes and the typed details on single lines', () => {
    const text = input();
    expect(text).toContain('Write in: English');
    expect(text).toContain('Client: age 31, Female, Married');
    expect(text).toContain('- Stress: 72 High — Stress is taking a lot of your energy.');
    expect(text).toContain('- Sleep: not enough answers');
    expect(text).toContain('Plan: Focused support, 8 sessions, weekly');
    expect(text).toContain('- Ask about work hours.');
    expect(text).toContain('- What brings you here?: Work pressure and poor sleep');
  });

  it('caps the answers it sends', () => {
    const text = input();
    expect(text).toContain(`Question ${MAX_NOTABLE}`);
    expect(text).not.toContain(`Question ${MAX_NOTABLE + 1} `);
  });

  it('marks a crisis without naming it, and home safety only as individual sessions', () => {
    const text = input({
      report: { ...report, crisis: true, plan: null, focus: null },
      view: view({ alerts: [{ kind: 'crisis', title: 'x', detail: 'y' }, { kind: 'home_safety', title: 'x', detail: 'y' }] }),
    });
    expect(text).toContain('Safety: needs support first');
    expect(text).toContain('Sessions: individual only');
    expect(text).not.toMatch(/self-harm|unsafe|home safety/i);
    expect(text).not.toContain('Plan:');
  });

  it('asks for Hindi when the report is in Hindi', () => {
    expect(input({ report: { ...report, lang: 'hi' } })).toContain('Write in: Hindi');
  });
});

describe('conclusionFromAi', () => {
  it('turns the JSON into paragraphs and bullet lines', () => {
    const out = conclusionFromAi(JSON.stringify({ summary: 'You took a step.', approach: 'In  sessions\nwe will talk.', steps: ['Sleep at one time.', '- Walk daily.'] }));
    expect(out).toEqual({ ok: true, body: 'You took a step.\n\nIn sessions we will talk.\n\n• Sleep at one time.\n• Walk daily.' });
  });

  it('accepts a fenced answer and refuses a broken one', () => {
    expect(conclusionFromAi('```json\n{"summary":"a","approach":"b","steps":[]}\n```')).toEqual({ ok: true, body: 'a\n\nb' });
    expect(conclusionFromAi('not json').ok).toBe(false);
    expect(conclusionFromAi({ summary: 'a' }).ok).toBe(false);
  });
});

describe('bulletLines', () => {
  it('reads a list only when every line is a bullet', () => {
    expect(bulletLines('• one\n• two')).toEqual(['one', 'two']);
    expect(bulletLines('text\n• two')).toBeNull();
  });
});

describe('prompt', () => {
  it('keeps the copy rules', () => {
    for (const word of ['diagnosis', 'cure', 'guaranteed', 'Dr. Neha Mehta', '"you"']) expect(CONCLUSION_SYSTEM_PROMPT).toContain(word);
  });
});
