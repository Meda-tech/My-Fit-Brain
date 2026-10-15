# Task 03b — Rule decisions → Intimacy 1.2 and Mind 1.1

Prerequisite: Task 04 Step 0 done (single repo, branch `task-04-engine`). Work on a new branch
`task-03b-rule-decisions` from `main`; merge it into `main` at the end and rebase/recreate
`task-04-engine` on top. Work autonomously; stop only where a step says **STOP**.

## Goal

Apply the owner's decisions on the 20 open questions from `docs/tasks/03-rules-mapping.md`. Published
versions are frozen, so the result is two NEW versions created from the live ones: **IA 1.2** and
**MA 1.1**. Record every decision so anyone can see what changed versus the Excel files and why.

Out of scope: the engine (Task 04), the editor UI (Task 05). Renflair hook: do not touch or flag.

---

## Step 1 — Decisions log

Create `docs/questionbank/decisions.md`. One row per decision:
`ID · Item · Source wording (exact Excel text) · Decision · How it is stored · Reason · Clinical confirmation pending (yes/no) · Applies to (IA/MA) · Version`.
Use the decisions below verbatim. Mark "Clinical confirmation pending = yes" for D4, D5, D6, D8, D10, D12, D13.
Add a header note: "Decided by the product owner on 2026-10-15 in place of clinical sign-off. Any change is
made as a new question-bank version."

| ID | Item | Decision |
|---|---|---|
| D1 | MED_MALE "age ≥ 40" | Exact age from registration (unchanged). |
| D2 | "R1 / MR1 has any condition" | Any option except `none_of_these`. "None of these" is **exclusive**: it cannot be combined with other options. |
| D3 | Rounding | Half up; band from the rounded whole number (unchanged). |
| D4 | C11 "I have thought about separation or ending the relationship." | Raw **Often** → counsellor tag `SEPARATION_THOUGHTS`. No points, nothing printed. C11 is already a scored CORE item; adding Impact would double-count it. |
| D5 | T7 "I feel safe in my current relationship." (reverse) | Raw **Never or Rarely** → flag `RELATIONSHIP_SAFETY_CHECK`: format forced to **individual**, counsellor tag, nothing printed (the SAFETY block is not used; the client did not say they are unsafe at home). Couple sessions are not offered until the counsellor has checked safety privately. |
| D6 | T8 "I want to repair this relationship." (reverse) | Raw **Never or Rarely** → flag `LOW_REPAIR_MOTIVATION`: format forced to **individual**, counsellor tag, nothing printed. |
| D7 | Dev-note vs Flags tab conflicts | The Scoring Rules and Flags & Safety tabs are the authority; the Routing / Dev note column is guidance only. |
| D8 | R2 sudden onset with no gender-specific medical flag | Intimacy gets flag `MED_ONSET`: `R2 = yes AND not MED_MALE AND not MED_FEMALE` → report block + counsellor tag. Text copied **exactly** (EN and HI) from MA 1.0 `MED_ONSET`. |
| D9 | NRI | Unchanged: Outside India → tag `NRI` + `NRI_LINE` block. |
| D10 | M5 "The problem happens mostly with my partner, much less when I am alone." | Unchanged: raw **Often** → counsellor tag `MIND_LED_PATTERN`, not printed. |
| D11 | PARENT_LINE 18–24 | Unchanged (age band). |
| D12 | No module chosen | Gate requires **at least 1** choice (`min_choices: 1`, `max_choices: 2`) in both tests. Intimacy also gets a final catch-all format rule `DEFAULT_INDIVIDUAL` (condition `all: []`) so the format is never empty. |
| D13 | No interpretation text for a chosen module with band Low | Interpretation falls back to the **core** module's interpretation for the core's band (`INTERP_CORE_*`, `INTERP_SOLO_*` or `INTERP_MCORE_*`). No new text. |
| D14 | DESIGNED_BY "Designed by Dr. Neha Mehta, Consultant Psychologist" | Keep. The brand guidelines use this exact line. |
| D15 | Hindi test names | Taken from each version's Hindi `TITLE` text, the part before " —" (expected "MFB इंटिमेसी असेसमेंट"; read the Mind one from its TITLE). |
| D16 | Intimacy R2–R6 "Scored = Yes" | Set to `no` in IA 1.2 (flag items never count toward a module %; no behaviour change). |
| D17 | Progress assessment names | Store on `qb_tests`: EN "MFB Intimacy Progress Assessment" / "MFB Mind Progress Assessment"; HI "MFB इंटिमेसी प्रोग्रेस असेसमेंट" / "MFB माइंड प्रोग्रेस असेसमेंट" (Hindi marked for review in the log). |
| D18 | Tier mix target 30/30/25/15 | Not a rule; becomes an admin report later. |
| D19 | SAFETY / CRISIS "team notified" | `notify: ["coordinator", "counsellor"]` for CRISIS and SAFETY in both tests. |
| D20 | MED_PHYSICAL "top of the medical section" | Unchanged: medical blocks print in flag `sort` order. |

Format rules in IA 1.2, in this effective order (flags with `force_format` win first):
SAFETY → RELATIONSHIP_SAFETY_CHECK → LOW_REPAIR_MOTIVATION (flags) → SOLO_INDIVIDUAL →
PARTNER_NOT_WILLING → COUPLE_ONLY → INDIVIDUAL_ONLY → MIXED → DEFAULT_INDIVIDUAL.

Note in the log: T7 and T8 belong to module G, so D5 and D6 only apply when G is chosen (those questions are
only shown then).

## Step 2 — Schema and package support

Migration `supabase/migrations/20261016100000_qb_rule_decisions.sql` (sorts before Task 04's migrations):

1. `qb_options.exclusive boolean not null default false` (included in `qb_start_new_version` copying,
   audit, freeze).
2. `qb_tests`: add `progress_name_en text`, `progress_name_hi text`; set `name_hi` and progress names per
   D15 and D17 (these are test-level, not versioned).
3. Update `qb_validate_version`:
   - `exclusive = true` only allowed on `multi` questions; at most one exclusive option per question.
   - `scoring.gate.min_choices` present, ≥ 1 and ≤ `max_choices`.
   - Every flag with `printed` not false must have a text in `qb_texts` (key = flag key, EN and HI).
     Flags with `printed: false` need no text.
   - `notify` values limited to `coordinator`, `counsellor`.
   - `report_rules.interpretation` present with a valid `fallback` (`core` or `none`).
   - Warning (not error) if the last format rule is not a catch-all (`all: []`).
4. Update `qb_import_version` / the payload schema for `exclusive`.

Package `@mfb/questionbank`:
- zod + types: `exclusive` on options; `gate.min_choices`; `notify` enum; `report_rules.interpretation`
  `{ fallback: 'core' | 'none' }`; flags without text when `printed: false`.
- `docs/questionbank/rules-reference.md`: document all of the above.
- Importer guard: importing an Excel file whose version label is **lower than or equal to** the latest
  version of that test shows a blocking error in admin ("This would replace decisions made in later
  versions; start a new version instead"). The CLI needs `--force` to do it.

## Step 3 — Version patches (reusable mechanism)

Build a small, reusable "patch" mechanism (the Task 05 editor will later do the same through the UI):

- `packages/questionbank/patches/IA-1.2.patch.json` and `MA-1.1.patch.json`: an ordered list of operations
  (`set_question`, `set_option`, `add_text`, `add_flag`, `set_flag`, `set_format_rules`, `set_scoring`,
  `set_report_rules`, `add_test_case`, `set_test_case`), each with a `decision` id (D1–D20) for traceability.
- `npm run qb:patch -- <patch.json> --sql <out.sql> [--publish "<note>"]` generates SQL that:
  `qb_start_new_version(test, '1.2')` → applies every operation to the draft → `qb_validate_version` must
  return zero errors (else `RAISE EXCEPTION`, nothing saved) → submit → publish (only with `--publish`).
  All in one transaction. Use the same functions and permissions as the admin.
- Unit tests: applying each patch to the parsed v1.1/v1.0 payload (offline) produces a config that passes
  the zod schemas and `validate` with zero errors.

Patch contents:

**IA-1.2** (D2, D4, D5, D6, D8, D12, D13, D16, D19)
- R1 option `none_of_these` → `exclusive: true`.
- R2–R6 → `scored: no`.
- Flags: add `SEPARATION_THOUGHTS` (`ans(C11 = often)`; `dashboard_tag`, `printed: false`);
  `RELATIONSHIP_SAFETY_CHECK` (`ans(T7 in [never, rarely])`; `force_format: individual`, `dashboard_tag`,
  `printed: false`); `LOW_REPAIR_MOTIVATION` (`ans(T8 in [never, rarely])`; same effects);
  `MED_ONSET` (`all[ans(R2=yes), not flag(MED_MALE), not flag(MED_FEMALE)]`; `report_block`,
  `dashboard_tag`), sorted after MED_FEMALE and before MED_GENERAL.
- Text `MED_ONSET` EN + HI copied exactly from the live MA version's `MED_ONSET` text.
- CRISIS and SAFETY `notify: [coordinator, counsellor]`.
- `scoring.gate`: `min_choices: 1`.
- Format rules: append `DEFAULT_INDIVIDUAL` (`all: []` → individual).
- `report_rules.interpretation: { fallback: 'core' }`.

**MA-1.1** (D2, D12, D13, D19)
- MR1 option `none_of_these` → `exclusive: true`.
- CRISIS and SAFETY `notify: [coordinator, counsellor]`.
- `scoring.gate`: `min_choices: 1`.
- `report_rules.interpretation: { fallback: 'core' }`.

## Step 4 — Test cases

The 11 Worked Example cases are copied into the new versions by `qb_start_new_version`. Check each
answer set against the new rules: if a case now accidentally triggers a new flag (e.g. Intimacy D chose
G and answered T7/T8 Never or Rarely), change only the T7/T8/C11 answers so the case keeps its
**Expected tier and Format** from the workbook. Record any such change in the case notes and in
`decisions.md`. Never change an expected tier or format from the workbook.

Add new test cases (`source: manual`, full answer sets, expected results):

IA 1.2
1. `T7_RARELY` — partner willing, chose G + A, T7 = Rarely → format individual, tag RELATIONSHIP_SAFETY_CHECK, no SAFETY block.
2. `T8_NEVER` — partner willing, chose G only, T8 = Never → format individual, tag LOW_REPAIR_MOTIVATION.
3. `R2_PNS_ONSET` — sex Prefer not to say, chose A only, R2 = Yes → MED_ONSET block; no MED_MALE/MED_FEMALE.
4. `C11_OFTEN` — C11 = Often → tag SEPARATION_THOUGHTS; points and tier identical to the same answers with C11 = Sometimes.
5. `LOW_MODULE_FALLBACK` — chose B, B band Low, core Mild → interpretation key INTERP_CORE_MILD.
6. `SAFETY_BEATS_COUPLE` — partner willing, couple modules only, R6 = Yes → individual.

MA 1.1
7. `LOW_MODULE_FALLBACK` — chose W, W band Low, MCORE Moderate → INTERP_MCORE_MODERATE.
8. `CRISIS_NOTIFY` — MR5 = Yes → crisis layout, notify coordinator + counsellor.

Put the module % each answer set is meant to produce in the notes, as in Task 03.

## Step 5 — Generate and apply

1. Write `supabase/seed/question-bank/IA-1.2.patch-and-publish.sql` and `MA-1.1.patch-and-publish.sql`.
2. Write `docs/tasks/03b-apply.md` with the run order for the Supabase SQL Editor:
   1) `20261016100000_qb_rule_decisions.sql`, 2) `IA-1.2.patch-and-publish.sql`,
   3) `MA-1.1.patch-and-publish.sql`, 4) `docs/tasks/03b-verify.sql`.
3. `docs/tasks/03b-verify.sql` (rolls back anything it writes): IA 1.2 and MA 1.1 are live; IA 1.1 and MA 1.0
   are retired and unchanged; row counts of the new versions (list expected numbers); validation returns
   zero errors; the new flags, texts, exclusive options, min_choices and interpretation fallback are present;
   `qb_tests` names filled.
4. If a local Supabase stack is running, apply there too. If linked to a remote project, show
   `--dry-run` and **STOP** before pushing. Otherwise I run the SQL myself.

## Step 6 — Update Task 04 brief

Append a section "Additional requirements from Task 03b" to `docs/tasks/04-engine.md`:
- Reject answers that combine an `exclusive` option with others (validation error in `getFlow` /
  `score`; the UI will also prevent it).
- Enforce `gate.min_choices` and `max_choices`.
- Interpretation fallback per `report_rules.interpretation`.
- Flags with `force_format` are applied in flag `sort` order; first one wins.
- Flags with `printed: false` never appear in the client report; they appear in `counsellor.tags`.
- `notify` recipients are passed through in the result for Task 08.
- The new IA 1.2 / MA 1.1 test cases (Step 4) must pass along with the 11 Worked Examples.

## Step 7 — Verify and finish

1. `npm test`, `npm run lint`, `npm run build` pass.
2. Admin → Question bank shows IA 1.2 and MA 1.1 live (after I run the SQL), the previous versions retired,
   and the version pages show the new flags, rules and test cases.
3. Update `CLAUDE.md`: question-bank section points to `docs/questionbank/decisions.md`; "Excel files are
   the v1.1/v1.0 source; the database is the source of truth from IA 1.2 / MA 1.1 onward"; copy rule allows
   "Dr. Neha Mehta, Consultant Psychologist"; Status: Task 03b done, next Task 04 Step 1.
4. Commit in chunks, merge `task-03b-rule-decisions` into `main` (fast-forward if possible), then update
   `task-04-engine` to start from the new `main`.
5. Print a short summary: files to run (in order), expected row counts, test cases added or adjusted,
   anything not done.
