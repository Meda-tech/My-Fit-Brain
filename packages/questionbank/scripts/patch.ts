// Turn a version patch into SQL for the Supabase SQL Editor (copy live → draft, apply, validate,
// optionally submit + publish), after checking it offline against the base version.
//
//   npm run qb:patch -- packages/questionbank/patches/IA-1.2.patch.json --sql out.sql [--publish "<note>"]
//
// Paths are relative to where the command is typed (the repo root for the root script).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_TESTS, SEED_WORKBOOKS } from '../seeds/index';
import { prepareImport } from '../src/import';
import { applyPatch, patchSchema, patchToSql, type VersionPatch } from '../src/patch';
import type { ImportPayload } from '../src/types';
import { validatePayload } from '../src/validate';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const cwd = process.env.INIT_CWD ?? process.cwd();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const patchesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../patches');
const file = args.find((a, i) => !a.startsWith('--') && !['--sql', '--publish'].includes(args[i - 1] ?? ''));
if (!file) {
  console.error('Usage: npm run qb:patch -- <patch.json> --sql <out.sql> [--publish "<note>"]');
  process.exit(1);
}

const allPatches: VersionPatch[] = readdirSync(patchesDir)
  .filter((f) => f.endsWith('.patch.json'))
  .map((f) => patchSchema.parse(JSON.parse(readFileSync(resolve(patchesDir, f), 'utf8'))));

const cache = new Map<string, ImportPayload | null>();
/** Payload of a version: from its seed + workbook, or by applying the patch chain that produces it. */
async function payloadOf(test: string, label: string): Promise<ImportPayload | null> {
  const key = `${test}-${label}`;
  if (cache.has(key)) return cache.get(key)!;
  let result: ImportPayload | null = null;
  if (SEED_WORKBOOKS[key]) {
    const path = resolve(repoRoot, SEED_WORKBOOKS[key]);
    result = (await prepareImport(readFileSync(path), { fileName: basename(path), tests: SEED_TESTS })).payload;
  } else {
    const p = allPatches.find((x) => x.test_code === test && x.version_label === label);
    const base = p ? await payloadOf(test, p.base_version_label) : null;
    if (p && base) result = applyPatch(base, p, await contextFor());
  }
  cache.set(key, result);
  return result;
}

/**
 * Texts for copy_from. In the SQL, copy_from reads the other test's *live* version when it runs. The
 * apply order is IA patch, then MA patch, so the other test is still at its seed version; copied texts
 * are not changed by any patch, so the seed payload gives exactly the same text.
 */
async function contextFor() {
  const byTest = new Map<string, ImportPayload>();
  for (const key of Object.keys(SEED_WORKBOOKS)) {
    const [test, label] = key.split('-');
    const p = await payloadOf(test, label);
    if (p) byTest.set(test, p);
  }
  return { resolveText: (test: string, key: string) => byTest.get(test)?.texts.find((x) => x.key === key) ?? null };
}

const patch = patchSchema.parse(JSON.parse(readFileSync(resolve(cwd, file), 'utf8')));
const base = await payloadOf(patch.test_code, patch.base_version_label);
if (!base) {
  console.error(`No offline copy of ${patch.test_code} ${patch.base_version_label} (no seed workbook or patch chain).`);
  process.exit(1);
}
const result = applyPatch(base, patch, await contextFor());
const issues = validatePayload(result, base);
for (const i of issues) console[i.severity === 'error' ? 'error' : 'warn'](`${i.severity}: [${i.code}] ${i.message}`);
if (issues.some((i) => i.severity === 'error')) {
  console.error('\nThe patched version has errors; no SQL written.');
  process.exit(1);
}
console.log(
  `${patch.test_code} ${patch.base_version_label} → ${patch.version_label}: ${patch.operations.length} operations, ` +
    `${result.questions.length} questions, ${result.options.length} options, ${result.texts.length} texts, ` +
    `${result.flags.length} flags, ${result.format_rules.length} format rules, ${result.test_cases.length} test cases. ` +
    `Offline validation: ${issues.length} issue(s).`
);

const out = flag('--sql');
if (out) {
  writeFileSync(resolve(cwd, out), patchToSql(patch, { publishNote: flag('--publish') }));
  console.log(`Wrote ${out}.`);
}
