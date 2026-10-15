// Import a question bank workbook as a new draft — the same code path as the admin import screen.
//
//   npm run qb:import -- <file.xlsx>                     # parse + validate only, print the preview
//   npm run qb:import -- <file.xlsx> --sql <out.sql>     # write SQL for the Supabase SQL Editor
//   npm run qb:import -- <file.xlsx> --env admin/.env.local --apply
//                                                         # call qb_import_version with the service role
//   add --publish "<change note>" to also submit and publish (testing databases only, never production)
//
// Paths are relative to the repo root when run through the root `npm run qb:import`.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { SEED_TESTS } from '../seeds/index';
import { prepareImport, toImportSql } from '../src/import';
import { loadLatestRules } from '../src/loader';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const has = (name: string) => args.includes(name);
// npm runs workspace scripts inside the package folder; INIT_CWD is where the command was typed.
const cwd = process.env.INIT_CWD ?? process.cwd();
const file = args.find((a, i) => !a.startsWith('--') && !['--sql', '--env', '--publish'].includes(args[i - 1] ?? ''));

if (!file) {
  console.error('Usage: npm run qb:import -- <file.xlsx> [--sql out.sql] [--env path/.env.local --apply] [--publish "note"]');
  process.exit(1);
}

const envPath = flag('--env');
if (envPath) {
  for (const line of readFileSync(resolve(cwd, envPath), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const apply = has('--apply');
const publishNote = flag('--publish');
const supabase =
  apply && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;
if (apply && !supabase) {
  console.error('--apply needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (pass --env admin/.env.local).');
  process.exit(1);
}

const tests = supabase
  ? ((await supabase.from('qb_tests').select('code, name_en')).data ?? SEED_TESTS)
  : SEED_TESTS;

const path = resolve(cwd, file);
const prepared = await prepareImport(readFileSync(path), {
  fileName: basename(path),
  tests,
  loadLatest: supabase ? (code) => loadLatestRules(supabase, code) : undefined,
});

for (const w of prepared.warnings) console.warn(`warning: ${w}`);
for (const e of prepared.errors) console.error(`error: ${e}`);
for (const i of prepared.issues) console[i.severity === 'error' ? 'error' : 'warn'](`${i.severity}: [${i.code}] ${i.message}`);
if (prepared.preview) {
  const p = prepared.preview;
  console.log(`\n${p.test_code} ${p.version_label} from ${p.source_file_name}`);
  console.log('tabs:', JSON.stringify(p.tab_counts));
  console.log('rows:', JSON.stringify(p.counts));
  console.log('rules:', prepared.source?.kind === 'seed' ? `seed ${prepared.source.file}` : JSON.stringify(prepared.source));
}
if (!prepared.ok || !prepared.payload) {
  console.error('\nNot imported: fix the errors above.');
  process.exit(1);
}
const payload = prepared.payload;

const sqlOut = flag('--sql');
if (sqlOut) {
  let sql = toImportSql(payload);
  if (publishNote) {
    const note = publishNote.replace(/'/g, "''");
    sql = sql.replace(
      /^select public\.qb_import_version\((.*)\) as version_id;$/m,
      [
        'do $qbdo$',
        'declare v uuid;',
        'begin',
        '  v := public.qb_import_version($1);',
        '  perform public.qb_submit_for_review(v);',
        `  perform public.qb_publish(v, '${note}');`,
        "  raise notice 'Published % as live', v;",
        'end',
        '$qbdo$;',
      ].join('\n')
    );
    sql = sql.replace('as a new draft.', 'and publish it (testing databases only).');
  }
  writeFileSync(resolve(cwd, sqlOut), sql);
  console.log(`\nWrote ${sqlOut} (${(sql.length / 1024).toFixed(0)} KB).`);
}

if (supabase) {
  const { data: id, error } = await supabase.rpc('qb_import_version', { payload });
  if (error) {
    console.error(`\nqb_import_version failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`\nImported draft ${id}.`);
  const { data: issues } = await supabase.rpc('qb_validate_version', { p_version_id: id });
  console.log(`qb_validate_version: ${(issues ?? []).length} issue(s).`);
  for (const i of issues ?? []) console.log(`  ${i.severity}: [${i.code}] ${i.message}`);
  if (publishNote) {
    for (const [fn, params] of [
      ['qb_submit_for_review', { p_version_id: id }],
      ['qb_publish', { p_version_id: id, p_change_note: publishNote }],
    ] as const) {
      const { error: e } = await supabase.rpc(fn, params);
      if (e) {
        console.error(`${fn} failed: ${e.message}`);
        process.exit(1);
      }
    }
    console.log('Submitted and published (live).');
  }
}
