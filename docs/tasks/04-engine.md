# Task 04 — Generic assessment engine

Prerequisite: Task 03 SQL applied on the testing database (migration, IA-1.1 and MA-1.0 loaded and
published, `03-verify.sql` passed). Work autonomously. Stop only where a step says **STOP**.

## Goal

One pure TypeScript engine that takes a published (or draft) question-bank version plus a client's answers
and returns: which question comes next, scores, bands, plan, format, flags and the report content.
It must contain **zero** question IDs, thresholds, scores or report sentences. Everything comes from the
`VersionConfig` loaded from the database. All 11 Worked Examples must pass.

## Out of scope

Client assessment screens and storing attempts (Task 06), the admin editor / rule builder / preview (Task 05),
payments, PDFs. Renflair hook: do not touch or flag.

---

## Step 0 — Repository fix (single repo)

Task 03 found that `admin/` and `clients/` are nested git repos inside the root repo, so a fresh clone
(and Vercel) gets empty app folders.

1. Report for each of root, `admin/`, `clients/`: current branch, unpushed commits, remotes.
2. **STOP** and show me this report plus the plan below. Continue only after I confirm.
3. Plan: merge `task-02-foundation` and `task-03-question-bank` into `main` in each repo (task-01 is
   already in task-02's history; confirm). Move `admin/.git` and `clients/.git` to `../git-backups/` (not
   deleted). In the root repo remove any gitlink entries (`git rm --cached admin clients` if needed), then
   `git add admin clients` so their files are tracked by the root repo. Commit
   `chore: merge apps into a single repository`. Confirm `.gitignore` covers `node_modules`, `.next`,
   `.env*` (except `.env.example`) at every level.
4. Verify: clone the root repo into a temp folder, `npm install`, `npm run build` — both apps build.
5. Update `docs/deploy/vercel.md` to the single-repo setup.
6. Create `task-04-engine` from the updated `main`.

## Step 1 — Package

Create `packages/engine` (`@mfb/engine`), TypeScript source, depends on `@mfb/questionbank` for types.
Add to both apps and to `transpilePackages`. Vitest for tests. Export `ENGINE_VERSION` (semver string);
bump it whenever results could change.

The engine is **pure**: no Supabase, no fetch, no `Date.now()` inside logic, no randomness. Same input →
same output, on server and in tests.

## Step 2 — Inputs and outputs

```ts
type EngineContext = {
  sex: 'Male' | 'Female' | 'Prefer not to say';
  age: number;                 // exact years from registration
  mode: 'initial' | 'progress';
  firstResult?: AssessmentResult; // required for progress mode
};
type Answers = Record<string, string | string[]>; // qid -> option_code(s)
```

Main functions:

- `evaluateCondition(cond, facts)` — every condition type in `docs/questionbank/rules-reference.md`.
  Unknown fact or operator → throw (never silently false).
- `buildFacts(config, context, answers, partial?)` — answers, raw values, scored values, sex, age,
  age_band, path, chosen modules (in the order chosen), chosen kinds, module %, bands, primary/second/core,
  fired flags. Facts that are not yet knowable return "unknown"; conditions that need them evaluate false
  for visibility and are not evaluated for flags until complete.
- `getFlow(config, context, answers)` → ordered list of visible questions and, for each, its visible
  options in display order. Order by module kind: intake → gate → core (CORE / SOLO_CORE / MCORE via
  `qb_scoring.core_module`) → chosen modules in the order chosen → dose → flag; inside a module by `sort`.
  Applies visibility rules, path, option hide/order rules, gate `max_choices`. In progress mode, only the
  items listed in `qb_scoring.progress`.
- `nextQuestion(config, context, answers)` → next unanswered visible question, or `null` when complete.
- `pruneAnswers(config, context, answers)` → removes answers to questions no longer visible (e.g. the
  path or the gate changed). Returns the pruned answers and the removed qids.
- `checkInterrupts(config, context, answers)` → flags with `interrupt` or `stop` effects that have fired
  so far (CRISIS support screen, AGE_STOP). Must be callable after every answer.
- `score(config, context, answers)` → `AssessmentResult` (requires a complete flow; else throws
  `IncompleteAssessmentError` listing missing qids).
- `compareProgress(config, first, progress)` → per-area change (now % − first %), classification from
  `qb_scoring.progress` thresholds, text keys.
- `runTestCase(config, testCase)` → `{ passed, actual, diffs[] }`.

`AssessmentResult` (will be stored as a JSON snapshot with each attempt in Task 06):

```ts
{
  engineVersion, versionId, testCode, mode,
  path, coreModule, chosenModules: string[],
  modules: { [code]: { scoredItems, shownItems, sum, max, percent, band } },
  primary, second,
  points: { total, breakdown: { key, label, points }[] },
  tierBeforeOverrides, overridesApplied: { key, from, to }[], tier,
  format: { type, split?, addTextKeys: string[] } | null,
  flags: { key, effects }[],
  layout: 'standard' | 'crisis',
  report: {
    language-independent keys only: interpretation, strengths[], stuck[], focus[], tone,
    blocks[] (medical/safety/crisis), nextStep, plan (hidden when layout = crisis)
  },
  counsellor: { readiness, tags[], rawAnswers },
  warnings: { code, message }[],
  trace: { step, detail }[]   // human-readable explanation of every decision
}
```

`resolveReportTexts(config, result, lang: 'en' | 'hi' | 'both')` turns keys into sentences from
`qb_texts` / `qb_item_texts`. A missing key → `null` plus a warning. **Never** generate or fill in text.

## Step 3 — Scoring rules (all values from config)

Implement generically, reading `qb_scoring`, `qb_point_rules`, `qb_overrides`, `qb_format_rules`,
`qb_flags`, `qb_report_rules`:

1. Item score: likert/yn value from the option; reverse → `scaleMax − value`. Only `scored = yes` items
   count toward module %. `scored = points` items are read by point rules (`answer_value`).
2. Module % = sum ÷ (scaleMax × scored items actually shown) × 100, rounded per `qb_scoring.rounding`
   (`half_up`: 25.5 → 26). Computed for the core and each chosen module.
3. Band from `qb_scoring.bands`; band order from that list.
4. Primary: highest band among chosen modules, tie → first chosen; none chosen → core.
   Second: the other chosen module (if any).
5. Points: every `qb_point_rules` row in `sort` order (`primary_band_severity`, `answer_value`, `fixed` when
   its condition is true). Record each in the breakdown and trace.
6. Tier from `tier_thresholds`; then every override in `sort` order (`cap` = min, `floor` = max).
7. Format: first matching `qb_format_rules` row; flags with `force_format` win over format rules.
   No match → `format: null` + warning `NO_FORMAT_RULE` (do not invent a default).
8. Flags: evaluate in `sort` order so a flag condition can reference earlier flags. Flags never change
   the tier. Any flag with `layout: crisis` → `layout = 'crisis'` (tier still computed and stored).
9. Report keys per `qb_report_rules`: strengths (reverse items answered with the top raw value, in
   priority order, max count; fewer → print fewer), stuck (non-reverse items, answer order then module
   order, max count), focus (primary lines, plus one from second when its band ≥ the configured minimum),
   tone (condition → ready / gentle key). Interpretation key per module and band.
10. Progress mode: same item scoring and module %; no tier; change classification only.

If a rule in the config cannot be evaluated (bad reference), throw a clear error — the config is invalid,
not the client.

## Step 4 — Tests (offline, no database)

Build `VersionConfig` in tests from the real workbooks + seed rule files using the Task 03 parser and
`attach-rules` (same payload as the import), so tests match the database content.

Required:
1. **Worked Examples:** run all 11 test cases (Intimacy A–F, Mind A–E). Each must match expected tier and
   format, plus the bands and points breakdown in its notes. If one fails, find whether the answer set,
   the seed rule or the engine is wrong. Fix the answer set or the engine. If you believe a **seed rule** is
   wrong, do not change it silently: list it in `docs/tasks/04-findings.md` and **STOP**.
2. Band edges: 25 → Low, 26 → Mild (including a 25.5 rounding case), 50/51, 75/76.
3. SOLO path: partner items never shown, smaller divisor, gate hides A and B, format individual.
4. "Prefer not to say": sees both C- and D-related items per visibility rules.
5. Gate: max 2 choices enforced; chosen order drives primary tie-break and module order.
6. MG1 option ordering rules (student / working).
7. `pruneAnswers` after changing I6 (partner ↔ solo) and after changing the gate.
8. CRISIS: `checkInterrupts` fires immediately after R5/MR5 = Yes; layout crisis; plan hidden; tier stored.
9. SAFETY: format forced to individual.
10. AGE_STOP: fires on Under 18; `score` refuses to produce a result.
11. Each override fires in isolation (all mild cap, severe + long floor, G High floor).
12. Mixed format split table; PARENT_LINE for Mind K + 18–24.
13. Progress: better / same / worse at −10, −9, +9, +10.
14. Missing report text → `null` + warning, never invented text.
15. Determinism: same input twice → identical JSON.
16. A config-free guard: a test that greps `packages/engine/src` and fails if it finds any qid pattern
    (e.g. `/\b(I|G|C|CS|M|A|B|D|E|F|T|R|MI|MG|MC|MD|MR|H|L|W|K)\d{1,2}\b/`) or report sentence.

## Step 5 — Test-case runs (results stored outside the frozen version)

Published versions are frozen, test cases included, so results live in a separate table.

Migration `supabase/migrations/20261017000000_qb_test_runs.sql`:
- `qb_test_runs` — `id`, `version_id`, `test_case_id`, `engine_version`, `passed bool`, `actual jsonb`,
  `diffs jsonb`, `run_by`, `run_at`. Not covered by the freeze trigger. RLS: staff read; insert only via
  function `qb_record_test_runs(version_id, runs jsonb)` (requires `can_edit_content()` or
  `can_approve_content()`).
- Add `qb_versions.content_changed_at` maintained by the existing audit trigger (any content/rule/test-case
  change on a draft updates it).
- Change `qb_publish`: refuse unless every test case of that version has a passing run with
  `run_at > content_changed_at` and the current `engine_version`. Return a clear error listing failing or
  missing cases.
- Drop use of `qb_test_cases.verified` (keep the column, mark deprecated in a comment).

Admin (`/question-bank/[versionId]`, Test cases tab):
- "Run all test cases" (Server Action): load the version config, run the engine on every case, record
  runs, show pass/fail per case with expected vs actual and the trace.
- Show the latest run per case and whether it is still current (after last content change, same engine
  version).
- Publish button disabled with a reason when runs are missing, failing or stale.

Apply the migration as before: local `supabase migration up`; if remote, show `--dry-run` and **STOP**.
Also write the SQL to `docs/tasks/04-apply.sql` so I can run it in the Supabase SQL Editor.

## Step 6 — Server helpers (no UI yet)

In `@mfb/engine` add thin server-side helpers used by both apps:
- `loadConfig(supabase, versionId)` using the Task 03 loader.
- `scoreAttempt(supabase, versionId, context, answers)` → `AssessmentResult` with texts resolved.
These must only run on the server (mark with `import 'server-only'` in the helper file, not the pure core).

## Step 7 — Verify

- `npm test` (both packages), `npm run lint`, `npm run build` (both apps) pass.
- In the admin on the testing DB: run all test cases for IA 1.1 and MA 1.0 → all 11 pass and are recorded.
- The engine source has no qids, thresholds or sentences (test 16 passes).

## Step 8 — Finish

1. Write `docs/engine/README.md`: inputs, outputs, flow order, every rule type, how to add a test case,
   when to bump `ENGINE_VERSION`.
2. Update `CLAUDE.md`:
   - Layout: `packages/engine`, single repository.
   - Engine rules: pure, config-driven, no qids/thresholds/texts in code; scoring only on the server;
     publishing requires current passing test runs.
   - Copy rules: allow exactly "Dr. Neha Mehta, Consultant Psychologist" (the brand guidelines use this
     line); every other credential still needs approval.
   - Status: Task 04 done; next Task 05 — admin editor, rule builder, preview, review/publish UI.
3. Commit in chunks (repo merge, engine core, tests, test-runs migration, admin test-case tab, docs).
4. Print a short summary: repo merge result, test results (11 Worked Examples + edge cases), any engine
   warnings on the real banks (e.g. `NO_FORMAT_RULE`, missing texts), findings needing a decision.
