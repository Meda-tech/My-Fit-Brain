import { describe, expect, it, vi } from 'vitest';
import type { CounsellorView, Report } from '@mfb/questionnaire';
import { CONCLUSION_SYSTEM_PROMPT, MAX_NOTABLE, buildConclusionInput, conclusionFromAi } from '../lib/ai/conclusion-prompt';
import { conclusionBlocks } from '../lib/conclusion';

vi.mock('server-only', () => ({}));

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
    expect(text).not.toContain('Write in');
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
});

describe('conclusionFromAi', () => {
  it('builds summary, the support plan with labels, and the closing', () => {
    const out = conclusionFromAi(
      JSON.stringify({
        summary: 'Your responses indicate  stress\nat work.',
        support: [
          { label: 'CBT-Based Support:', text: 'Manage pressure.' },
          { label: 'Relaxation Techniques', text: 'Calm the body.' },
        ],
        closing: 'Progress will be reviewed across the eight weekly sessions.',
      })
    );
    expect(out).toEqual({
      ok: true,
      body: [
        'Your responses indicate stress at work.',
        '',
        'Suggested Support Plan',
        '• CBT-Based Support: Manage pressure.',
        '• Relaxation Techniques: Calm the body.',
        '',
        'Progress will be reviewed across the eight weekly sessions.',
      ].join('\n'),
    });
  });

  it('accepts a fenced answer and refuses a broken one', () => {
    expect(conclusionFromAi('```json\n{"summary":"a","support":["- b"],"closing":""}\n```')).toEqual({
      ok: true,
      body: 'a\n\nSuggested Support Plan\n• b',
    });
    expect(conclusionFromAi('not json').ok).toBe(false);
    expect(conclusionFromAi({ summary: 'a', support: [] }).ok).toBe(false);
  });
});

describe('conclusionBlocks', () => {
  it('reads paragraphs, a heading above a list, and bold labels', () => {
    const body = ['Para one.', '', 'Suggested Support Plan', '● CBT-Based Support: Manage pressure.', '• Plain point', '', 'Closing.'].join('\n');
    expect(conclusionBlocks(body)).toEqual([
      { kind: 'text', text: 'Para one.' },
      { kind: 'heading', text: 'Suggested Support Plan' },
      { kind: 'bullets', items: [{ label: 'CBT-Based Support', text: 'Manage pressure.' }, { label: null, text: 'Plain point' }] },
      { kind: 'text', text: 'Closing.' },
    ]);
  });

  it('keeps a full sentence above a list as text, and "Your sessions will focus on:" as a heading', () => {
    expect(conclusionBlocks('A sentence.\n• x')[0]).toEqual({ kind: 'text', text: 'A sentence.' });
    expect(conclusionBlocks('Your sessions will focus on:\n• x')[0]).toEqual({ kind: 'heading', text: 'Your sessions will focus on' });
  });
});


describe('prompt', () => {
  it('keeps the copy rules', () => {
    for (const word of ['diagnosis', 'cure', 'guaranteed', 'Dr. Neha Mehta', '"you"']) expect(CONCLUSION_SYSTEM_PROMPT).toContain(word);
  });
});

describe('interactionText', () => {
  it('reads only the model_output text steps', async () => {
    const { interactionText } = await import('../lib/ai/gemini');
    const data = {
      status: 'completed',
      steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] }],
    };
    expect(interactionText(data)).toBe('{"a":1}');
    expect(interactionText({})).toBe('');
  });
});
