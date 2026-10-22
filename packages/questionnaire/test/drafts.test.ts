import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextQuestion, parseDefinition, score, withSafety, type Answers } from '../src';

// The starting drafts (docs/questionnaires/*.json) must import without errors and run end to end.

const docs = path.join(__dirname, '../../../docs/questionnaires');

for (const file of ['intimacy.json', 'mind.json']) {
  describe(file, () => {
    const json = fs.readFileSync(path.join(docs, file), 'utf8');
    const parsed = parseDefinition(json);

    it('imports without errors', () => {
      expect(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.errors, null, 1)).toBe(true);
    });

    it('can be answered from start to finish and scored', () => {
      if (!parsed.ok) return;
      const def = withSafety(parsed.definition);
      const answers: Answers = {};
      // Always pick the first option (the "worst" is not needed; this is a flow check).
      for (let guard = 0; guard < 500; guard += 1) {
        const next = nextQuestion(def, answers);
        if (!next) break;
        answers[next.question.id] = [next.question.options[0].id];
      }
      expect(nextQuestion(def, answers)).toBeNull();
      const result = score(def, answers);
      expect(result.sections.filter((s) => s.shown).length).toBeGreaterThan(2);
      expect(result.main).not.toBeNull();
    });
  });
}
