import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_PROMPT, parseDefinition } from '../src';

const md = fs.readFileSync(path.join(__dirname, '../../../docs/questionnaires/ai-prompt.md'), 'utf8');

describe('AI prompt', () => {
  it('matches docs/questionnaires/ai-prompt.md (run: npm run prompt -w @mfb/questionnaire)', () => {
    expect(AI_PROMPT).toBe(md);
  });

  it('contains a complete example that imports without errors', () => {
    const start = md.indexOf('A SMALL COMPLETE EXAMPLE');
    const json = md.slice(md.indexOf('{', start));
    const r = parseDefinition(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.filter((w) => !w.message.includes('Hindi'))).toEqual([]);
  });

  it('never includes the built-in safety questions or forbidden words', () => {
    for (const word of ['licensed', 'clinically validated', 'cure', 'guaranteed', 'diagnosis names']) {
      // Each forbidden word appears only in the "words to avoid" line.
      expect(md.split(word).length - 1).toBe(1);
    }
  });
});
