import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEED_TESTS } from '../seeds/index';
import { prepareImport } from '../src/import';
import { parseWorkbook } from '../src/parse-excel';

const bankDir = fileURLToPath(new URL('../../../docs/questionbank/', import.meta.url));

export const FILES = {
  IA: 'MFB_Intimacy_Assessment_QuestionBank_v1.1_1.xlsx',
  MA: 'MFB_Mind_Assessment_QuestionBank_v1.0_1.xlsx',
} as const;

export function readBank(test: keyof typeof FILES): Buffer {
  return readFileSync(bankDir + FILES[test]);
}

export function parseBank(test: keyof typeof FILES) {
  return parseWorkbook(readBank(test), { fileName: FILES[test], tests: SEED_TESTS });
}

export function prepareBank(test: keyof typeof FILES) {
  return prepareImport(readBank(test), { fileName: FILES[test], tests: SEED_TESTS });
}
