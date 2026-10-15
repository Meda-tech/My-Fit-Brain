# Task 03 — Question bank data model (versioned content + rules as data)

Prerequisites: Tasks 01 and 02 merged into `main`. Work autonomously. Stop only where a step says
**STOP**, or if something would delete real data or break auth or the build.

## Goal

Every question, option, report sentence and scoring/routing/flag rule of both tests lives in the
database as **versioned data**, managed from the **admin app**. No question ID, score, threshold or report
text may appear in application code. Published versions are frozen forever; every assessment will pin the
version it used.

## Out of scope

- The scoring engine (Task 04). The admin editor, rule builder, diff, preview and test-case gate on publish
  (Task 05). Client assessment screens (Task 06).
- The Renflair SMS hook and its key (testing-phase item, do not touch or flag).

## Sources (read first)

- `CLAUDE.md`
- `docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v1_1_1.xlsx` — tabs: README, Questions,
  Scoring Rules, Session Tiers, Report Text, Strengths & Stuck, Flags & Safety, Worked Examples,
  Progress Assessment, Change Log
- `docs/questionbank/MFB_Mind_Assessment_QuestionBank_v1_0_1.xlsx` — same tabs (no Path column)
- `docs/spec/` developer spec v1.1

Expected counts: Intimacy 99 questions, Mind 58 questions.

---

## Step 0 — Prepare

1. `git checkout -b task-03-question-bank`.
2. Read every tab of both workbooks with a script and write `docs/tasks/03-findings.md`: column headers,
   row counts per tab, every distinct value of Module, Type, Reverse, Scored, Path, every distinct option
   format, and every Report Text key.

Known data quirks the parser MUST handle (verified in the files):
- Reverse column mixes `TRUE` / `True` / `FALSE` / `False` → boolean.
- Scored column is `Yes` / `No` / `Points` (Points = D1–D3, MD1–MD3: feed plan points, not module %).
- Options are `EN options || HI options`. Separator between options is ` | ` except I1/MI1 which use ` / `.
  EN and HI must have the same number of options.
- Scores are embedded in labels: `Never(0)`, `Yes(3)`, `Less than 3 months (0)` → extract the number,
  strip it from the label. Options without a number (D4, MD4, R1, MR1, I-questions) have value `null`.
- Gate options start with a code: `A: Fights…`, `H: Worry…` → that letter is the option code.
- I1 is typed `number` but is an age-band choice → store as `single`.
- Mind has no Path column → every Mind question is `all`.
- Strengths & Stuck triggers have three forms → `often` | `often_or_sometimes` | `often_sometimes_or_yes`.
- Worked Examples Total/Tier columns are formulas with no cached values. Only "Expected tier" and
  "Format" are literal.

## Step 1 — Monorepo workspace

1. Root `package.json` with npm workspaces: `["clients", "admin", "packages/*"]`. One root lockfile;
   remove per-app lockfiles. Keep each app's own scripts working (`npm run dev -w clients`, etc.) and add
   root scripts: `dev:clients`, `dev:admin`, `build`, `lint`, `test`.
2. Create `packages/questionbank` (name `@mfb/questionbank`), TypeScript source only (no build step),
   `exports` pointing at `src/index.ts`. Add it to both apps as a workspace dependency and to
   `transpilePackages` in both `next.config.*`. If Turbopack cannot resolve it, set `turbopack.root` to the
   repo root.
3. Add Vitest to the package (`npm test -w @mfb/questionbank`).
4. Add `docs/deploy/vercel.md`: two Vercel projects (Root Directory `clients` and `admin`), "Include files
   outside the root directory" ON, install from repo root, env vars per project.
5. Confirm `npm run build` passes for both apps before continuing.

## Step 2 — Migration: tables

Create `supabase/migrations/20261016000000_question_bank.sql`. All tables in `public`, prefixed `qb_`,
RLS enabled in the same file, `created_at`/`updated_at` with the existing `handle_updated_at()` trigger.

**Versions**
- `qb_tests` — `code text pk` (`IA`, `MA`), `name_en`, `name_hi`, `report_id_prefix` (`MFB-IA`, `MFB-MA`),
  `sort`. Seed both rows (names: "MFB Intimacy Assessment", "MFB Mind Assessment"; Hindi from the README
  tab if present, else leave Hindi NULL and list it in findings).
- `qb_versions` — `id uuid pk`, `test_code fk`, `version_label text` (e.g. `1.1`), `status`
  (`draft` | `in_review` | `live` | `retired`), `based_on_version_id`, `change_note`, `source_file_name`,
  `source_checksum`, `created_by`, `submitted_by/at`, `approved_by/at`, `published_at`, `retired_at`.
  Unique partial indexes: at most one `live` per test; at most one `draft` or `in_review` per test;
  `(test_code, version_label)` unique.

**Content** (every table has `version_id uuid fk → qb_versions on delete cascade`)
- `qb_modules` — `code`, `name_en`, `name_hi`, `kind` (`intake` | `gate` | `core` | `solo_core` | `couple`
  | `individual` | `dose` | `flag`), `sort`. PK `(version_id, code)`.
  Couple modules: A, B, G. Individual: C, D, E, F. Mind modules H, L, W, K: `individual`.
- `qb_questions` — `qid`, `module_code`, `type` (`likert` | `yn` | `single` | `multi`), `text_en`, `text_hi`,
  `reverse bool`, `scored` (`yes` | `no` | `points`), `path` (`all` | `partner` | `solo`), `sort`,
  `is_protected bool`, `source_note text` (the Excel "Routing / Dev note", kept for reference only).
  PK `(version_id, qid)`. Protected: I1, MI1, G1, MG1, R5, R6, MR5, MR6.
- `qb_options` — `qid`, `option_code`, `label_en`, `label_hi`, `value int null`, `sort`.
  PK `(version_id, qid, option_code)`. Option codes are stable slugs: likert `never|rarely|sometimes|often`,
  yn `no|yes`, gate letters `A`…, others snake_case of the English label (e.g. `under_18`, `18_24`,
  `none_of_these`).
- `qb_texts` — `key`, `module_code null`, `band null`, `text_en`, `text_hi`. PK `(version_id, key)`.
  All Report Text rows plus all Flags & Safety texts (key = flag name).
- `qb_item_texts` — `qid`, `kind` (`strength` | `stuck`), `trigger`, `text_en`, `text_hi`.
  PK `(version_id, qid, kind)`.
- `qb_tiers` — `sessions int`, `plan_en`, `plan_hi`, `pace_en`, `pace_hi`, `typical_case`.
  PK `(version_id, sessions)`.

**Rules** (all conditions use the JSON format in Step 3)
- `qb_scoring` — PK `version_id`. Columns (jsonb unless noted):
  `scale` (likert and yn values), `bands` (`[{code, min, max, name_en, name_hi, severity_points}]`),
  `rounding text` (`half_up`), `core_module` (conditions choosing CORE vs SOLO_CORE / MCORE),
  `gate` (`{qid, max_choices}`), `primary` (`{tie: "first_chosen", fallback: "core"}`),
  `tier_thresholds` (`[{max_points, sessions}]`, last has `max_points: null`),
  `pace` (per tier), `progress` (`{better_at: -10, worse_at: 10, items: …}`).
- `qb_point_rules` — `key`, `label`, `source` (`primary_band_severity` | `answer_value` | `fixed`),
  `qid null`, `points int null`, `condition jsonb null`, `sort`.
- `qb_overrides` — `key`, `label`, `condition`, `action` (`cap` | `floor`), `sessions int`, `sort`.
- `qb_visibility_rules` — `qid`, `condition` (question is shown only if true). PK `(version_id, qid)`.
- `qb_option_rules` — `qid`, `option_code`, `kind` (`hide` | `order_first`), `condition`, `sort`
  (e.g. gate hides A and B on SOLO path; MG1 orders K first for students, W first for working people).
- `qb_flags` — `key`, `condition`, `effects jsonb` (any of: `report_block`, `dashboard_tag`,
  `force_format`, `layout: "crisis"`, `interrupt: true`, `stop: true`, `notify: ["coordinator"]`,
  `printed: false`), `is_protected`, `sort`. Protected: AGE_STOP, CRISIS, SAFETY.
- `qb_format_rules` — `key`, `condition`, `format` (`individual` | `couple` | `mixed` |
  `individual_partner_joins`), `split jsonb null` (mixed table: 4 = 3+1, 6 = 4+2, 8 = 5+3, 12 = 7+5),
  `add_text_key null` (e.g. PARENT_LINE), `sort` (first match wins).
- `qb_report_rules` — PK `version_id`: `strengths` (`{count: 2, priority: [qids]}`),
  `stuck` (`{count: 3, module_order: ["primary","second","core"], answer_order: ["often","sometimes"]}`),
  `focus` (`{lines: 3, second_module_min_band: "Moderate"}`), `tone` (`{condition, ready_key, gentle_key}`).

**Test cases**
- `qb_test_cases` — `id`, `version_id`, `name`, `source` (`worked_example` | `manual`), `context jsonb`
  (sex, age, path), `answers jsonb` (`{qid: option_code | [option_codes]}`), `expected jsonb`
  (`{bands, primary, points, tier, format, flags, layout}`), `verified bool default false`, `notes`.

**Audit**
- `qb_audit_log` — `id`, `version_id`, `table_name`, `row_key jsonb`, `action`, `old jsonb`, `new jsonb`,
  `changed_by`, `changed_at`. Generic trigger on every content, rule and test-case table.

**Permissions**
- Add to `profiles`: `can_edit_content bool default false`, `can_approve_content bool default false`.
  Set both `true` for existing active super admins.
- Helper functions (STABLE SECURITY DEFINER, same pattern as `is_super_admin()`): `can_edit_content()`,
  `can_approve_content()`.

## Step 3 — Condition format (one shape everywhere)

Define in `packages/questionbank/src/conditions.ts` with a zod schema, and document in
`docs/questionbank/rules-reference.md`.

```ts
type Condition =
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { fact: 'answer'; q: string; op: 'eq' | 'neq' | 'in' | 'not_in'; value: string | string[] }   // option codes
  | { fact: 'answer_value'; q: string; op: 'eq'|'gte'|'lte'|'gt'|'lt'; value: number }            // raw value
  | { fact: 'answered_any_except'; q: string; value: string[] }        // e.g. R1 has any condition
  | { fact: 'sex'; op: 'eq' | 'in'; value: string | string[] }
  | { fact: 'age'; op: 'gte'|'lte'|'gt'|'lt'|'eq'; value: number }     // exact age from registration
  | { fact: 'age_band'; op: 'eq' | 'in'; value: string | string[] }
  | { fact: 'path'; op: 'eq'; value: 'partner' | 'solo' }
  | { fact: 'module_chosen'; value: string }
  | { fact: 'chosen_count'; op: 'eq'|'gte'|'lte'; value: number }
  | { fact: 'chosen_kinds'; op: 'only' | 'includes'; value: ('couple' | 'individual')[] }
  | { fact: 'band'; module: string | 'primary' | 'second' | 'core'; op: 'eq'|'gte'|'lte'; value: 'Low'|'Mild'|'Moderate'|'High' }
  | { fact: 'all_bands'; scope: 'core_and_chosen' | 'chosen'; op: 'lte' | 'gte'; value: 'Low'|'Mild'|'Moderate'|'High' }
  | { fact: 'count_bands'; scope: 'chosen'; op: 'gte'; value: 'Moderate'|'High'; count: number }
  | { fact: 'flag'; key: string };
```

Band order is Low < Mild < Moderate < High. Add facts only if a source rule truly cannot be expressed;
document every addition.

## Step 4 — Seed rules (Excel prose → data)

The Excel files express rules in English. Convert them ONCE into seed files:
`packages/questionbank/seeds/IA-1.1.rules.json` and `MA-1.0.rules.json` (scoring, point rules, overrides,
visibility, option rules, flags, format rules, report rules).

Sources to cover completely: the Scoring Rules tab (every step), the Flags & Safety tab (every flag), the
"Routing / Dev note" column of every question, the Session Tiers band names, and the Progress Assessment
tab.

Write `docs/tasks/03-rules-mapping.md`: a table with one row per source rule → the stored rule (key + JSON
summary). Encode literally; do not "improve" clinical rules. Where the source is ambiguous, encode the most
literal reading AND list it under **Open questions** with the exact Excel wording. Known ones to list:
- MED_MALE "age ≥ 40" → use exact `age` from registration, not the age band.
- "R1 / MR1 has any condition" → any option except `none_of_these`.
- Rounding of module % at band edges (half up: 25.5 → 26 → Mild).

## Step 5 — Worked Examples as test cases

For each Worked Example (Intimacy A–F, Mind A–E), build a full `answers` set that produces exactly the
profile described (bands per module, D1–D3/MD1–MD3, partner status, chosen modules, flags such as R5 = Yes
in Intimacy F, MC7 = Never in Mind C). Include all intake, gate, dose and flag answers. Set `expected`
from the Expected tier and Format columns plus the described bands. Store as `source: worked_example`,
`verified: false` (Task 04 verifies them). Show the module % you intend each answer set to produce in
`notes`.

## Step 6 — Database safety (functions and triggers)

1. **Freeze trigger** on every content, rule and test-case table: reject INSERT/UPDATE/DELETE when the
   row's version status is not `draft`. Applies to everyone, including the service role.
2. **Status changes only through functions** (SECURITY DEFINER, permission-checked):
   - `qb_start_new_version(test_code, version_label)` — copies the current live version (or latest
     version if none is live) into a new `draft`, all tables, in one transaction. Requires
     `can_edit_content()`.
   - `qb_submit_for_review(version_id)` — draft → in_review. Requires `can_edit_content()` and
     `qb_validate_version()` returning no errors.
   - `qb_return_to_draft(version_id)` — in_review → draft.
   - `qb_publish(version_id, change_note)` — in_review → live; previous live → retired; one transaction.
     Requires `can_approve_content()`. Re-runs validation. (Task 05 adds the test-case gate.)
   - `qb_delete_draft(version_id)` — drafts only.
   Block direct UPDATE of `qb_versions.status` with a trigger.
3. **`qb_validate_version(version_id)`** returns a list of `{severity, code, message, ref}`:
   missing Hindi on any text/label; likert question without exactly 4 options valued 0–3; yn without
   `no=0, yes=3`; duplicate or unknown module codes; rule or item text pointing to a missing qid,
   option_code, module or text key; protected questions/flags missing or structurally changed vs the
   version it was based on; missing `qb_scoring` or `qb_report_rules` row.
4. **Import function** `qb_import_version(payload jsonb)` — creates a new draft version with all content
   and rules from one payload in one transaction. Requires `can_edit_content()`. Fails whole if anything is
   invalid.

## Step 7 — RLS

- Staff (`is_active_staff()`): SELECT on all `qb_*` tables.
- Editors (`can_edit_content()`): INSERT/UPDATE/DELETE on content, rule and test-case rows (the freeze
  trigger still limits them to drafts).
- Clients (authenticated, not staff): SELECT only on `qb_tests`, `qb_versions` (live rows),
  `qb_modules`, `qb_questions`, `qb_options` of live versions. Never rules, flags, texts, test cases or
  audit log.
- `qb_audit_log`: staff SELECT only; written only by the trigger.

Apply the migration as in Task 02: local `supabase migration up` (never `db reset`); if linked to a remote
project, show `supabase db push --dry-run` output and **STOP** before the real push. Regenerate Supabase
types if the project uses them.

## Step 8 — `@mfb/questionbank` package

- `types.ts` — types for every table and the full `VersionConfig` object.
- `conditions.ts` — zod schemas (Step 3).
- `parse-excel.ts` — parses a workbook into an import payload (content only), handling every quirk in
  Step 0. Use `exceljs` (not the npm `xlsx` package). Reads the version label from the README title
  (e.g. "v1.1"), not the file name. Detects the test from the README title (Intimacy → IA, Mind → MA).
- `attach-rules.ts` — adds rules to the payload: from the matching seed file (`IA-1.1`, `MA-1.0`) if one
  exists, else copied from the latest version of that test.
- `loader.ts` — `getLiveVersionId(supabase, testCode)` (never cached) and
  `getVersionConfig(supabase, versionId)` (cache by version id when status is live or retired; never cache
  drafts).
- Tests (Vitest), using the real Excel files in `docs/questionbank/`:
  - Intimacy parses to 99 questions, Mind to 58; every label and text has EN and HI.
  - Every likert question has 4 options valued 0–3; quirks above handled.
  - Both seed rule files pass the zod schema; every qid, option code, module and text key they reference
    exists in the parsed content.
  - A deliberately broken workbook fixture is rejected with readable errors.

## Step 9 — Admin screens (`admin/`)

Navigation item "Question bank" for active staff. Styling per CLAUDE.md.

1. `/question-bank` — both tests: live version, draft/in-review version, last change (who, when).
   Buttons by permission: Start new version, Import Excel.
2. `/question-bank/import` — upload `.xlsx` (Server Action, max 5 MB) → parse → validate → preview:
   detected test and version, counts per tab, rules source (seed file or copied), errors and warnings.
   "Create draft" calls `qb_import_version`. Errors block creation. Clear message if a draft already exists
   for that test.
3. `/question-bank/[versionId]` — read-only tabs:
   **Questions** (grouped by module, EN | HI side by side, badges: reverse, scored/points, path,
   protected), **Report texts**, **Strengths & stuck**, **Plans & bands**, **Rules** (scoring, points,
   overrides, visibility, option rules, flags, format, report rules — shown as readable sentences generated
   from the JSON, with the raw JSON in a collapsible), **Test cases**, **Validation** (results of
   `qb_validate_version`), **History** (audit log).
   Status actions by permission: Submit for review, Return to draft, Publish (approvers, requires change
   note), Delete draft.
4. Coordinators and counsellors without edit rights see the same pages read-only, with no action buttons.

## Step 10 — Load the two banks (testing database)

Using the same code path as the admin import (a script `npm run qb:import -- <file>` that calls the parser
and `qb_import_version` with the service role is fine for local/testing):
1. Import Intimacy v1.1 and Mind v1.0 as drafts. Report counts.
2. Run `qb_validate_version` on both; fix the seed/parser until zero errors.
3. Submit and publish both on the **local/testing** database only so later tasks can read a live version.
   Never publish on a production project.

## Step 11 — Verify

- `npm run lint`, `npm run build` (both apps) and `npm test -w @mfb/questionbank` pass.
- SQL checks: editing a row of a live version fails; `qb_start_new_version` creates a full copy (same row
  counts per table); publishing a second version retires the first; an authenticated client can read live
  questions but not `qb_flags`, `qb_texts` or `qb_test_cases`.
- Grep both apps: no question IDs (`C1`, `MR5`…), thresholds or report sentences hard-coded in app code.

## Step 12 — Finish

1. Update `CLAUDE.md`: repository layout (`packages/questionbank`, root workspaces, `docs/deploy`),
   a "Question bank" section (versions, statuses, freeze rule, rules-as-data, condition format pointer),
   Status (Task 03 done; next Task 04 — generic engine).
2. Commit in chunks: workspace, migration, package, seeds, admin screens, docs.
3. Print a short summary: row counts per version, validation result, open questions from
   `03-rules-mapping.md`, test cases created, anything not done.
