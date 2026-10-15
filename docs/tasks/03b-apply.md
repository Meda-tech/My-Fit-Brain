# Task 03b — Applying the rule decisions (IA 1.2, MA 1.1)

Run these in the Supabase SQL Editor (testing database), in this order, each once. Each file is one
transaction: if anything fails, nothing is saved.

| # | Run | What it does |
|---|---|---|
| 1 | `supabase/migrations/20261016100000_qb_rule_decisions.sql` | Adds `qb_options.exclusive` and the test-level Hindi and progress names; updates validation, copying and import |
| 2 | `supabase/seed/question-bank/IA-1.2.patch-and-publish.sql` | Copies live IA 1.1 to a draft 1.2, applies decisions D2, D4, D5, D6, D8, D12, D13, D16, D19, adjusts Worked example D, adds 6 test cases, validates, submits and publishes. IA 1.1 becomes retired |
| 3 | `supabase/seed/question-bank/MA-1.1.patch-and-publish.sql` | Same for MA 1.0 → 1.1 (D2, D12, D13, D19; 2 new test cases) |
| 4 | `docs/tasks/03b-verify.sql` | Versions, row counts, zero validation errors, every decision present, retired versions unchanged and frozen (writes are rolled back) |

Step 2 must run while MA 1.0 (or 1.1) is live: it copies the `MED_ONSET` text from the live Mind version.
The text is the same in both.

**Testing database only.** Steps 2–3 publish straight away. On production the same patches will be
applied through the admin (Task 05), with review before publishing.

## Expected row counts

| Table | IA 1.2 | MA 1.1 |
|---|---|---|
| modules / questions / options | 13 / 99 / 384 | 9 / 58 / 227 |
| texts / item texts / tiers | 70 / 77 / 4 | 51 / 42 / 4 |
| point rules / overrides | 6 / 3 | 6 / 2 |
| visibility / option rules | 2 / 4 | 1 / 2 |
| flags / format rules | 12 / 7 | 8 / 2 |
| scoring / report rules | 1 / 1 | 1 / 1 |
| test cases | 12 (6 worked examples + 6 manual) | 7 (5 worked examples + 2 manual) |

## Regenerating the SQL

```bash
npm run qb:patch -- packages/questionbank/patches/IA-1.2.patch.json \
  --sql supabase/seed/question-bank/IA-1.2.patch-and-publish.sql \
  --publish "IA 1.2: owner decisions D2, D4, D5, D6, D8, D12, D13, D16, D19 (testing)"
npm run qb:patch -- packages/questionbank/patches/MA-1.1.patch.json \
  --sql supabase/seed/question-bank/MA-1.1.patch-and-publish.sql \
  --publish "MA 1.1: owner decisions D2, D12, D13, D19 (testing)"
```

Each command first applies the patch offline to the base version and stops if validation finds an error.
Leave out `--publish` to create the new version as a draft only.
