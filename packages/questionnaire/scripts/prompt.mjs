// Regenerates src/ai-prompt.ts from docs/questionnaires/ai-prompt.md (one source of truth).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const md = fs.readFileSync(path.join(here, '../../../docs/questionnaires/ai-prompt.md'), 'utf8');
const body =
  '// GENERATED from docs/questionnaires/ai-prompt.md — edit the .md and run: npm run prompt -w @mfb/questionnaire\n' +
  '// The test ai-prompt.test.ts fails when the two differ.\n\n' +
  `export const AI_PROMPT = ${JSON.stringify(md)};\n`;
fs.writeFileSync(path.join(here, '../src/ai-prompt.ts'), body);
console.log('ai-prompt.ts regenerated');
