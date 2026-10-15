# Task 03 — Loading the two question banks (testing database)

The owner runs SQL in the Supabase SQL Editor. Run these in order, each file once.

| # | Run | What it does |
|---|---|---|
| 1 | `supabase/migrations/20261016000000_question_bank.sql` | Creates the `qb_*` tables, triggers, functions and RLS; gives active super admins edit + approve rights |
| 2 | `supabase/seed/question-bank/IA-1.1.load-and-publish.sql` | Imports MFB Intimacy Assessment v1.1 as a draft, submits it and publishes it (live) |
| 3 | `supabase/seed/question-bank/MA-1.0.load-and-publish.sql` | Same for MFB Mind Assessment v1.0 |
| 4 | `docs/tasks/03-verify.sql` | Row counts, validation, freeze / copy / publish checks and client RLS checks (everything that writes is rolled back) |

Expected after step 3: IA 1.1 live (99 questions, 384 options, 69 texts, 77 item texts, 4 tiers, 6 point
rules, 3 overrides, 2 visibility rules, 4 option rules, 8 flags, 6 format rules, 6 test cases) and MA 1.0
live (58 questions, 227 options, 51 texts, 42 item texts, 4 tiers, 6 point rules, 2 overrides, 1 visibility
rule, 2 option rules, 8 flags, 2 format rules, 5 test cases). If an import has a validation error the whole
step fails and nothing is saved.

**Testing databases only.** Steps 2–3 publish without a review. On a production project, import through the
admin app (Question bank → Import Excel), review the draft, then submit and publish it there.

## Same thing from the command line

The CLI uses the same parser, rules and validation as the admin import screen.

```bash
# Check a workbook (no database)
npm run qb:import -- docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v1.1_1.xlsx

# Regenerate the SQL files (add --publish "<note>" to also submit and publish)
npm run qb:import -- docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v1.1_1.xlsx \
  --sql supabase/seed/question-bank/IA-1.1.load-and-publish.sql --publish "Initial import (testing)"

# Import straight into the database with the service role (testing only)
npm run qb:import -- docs/questionbank/MFB_Mind_Assessment_QuestionBank_v1.0_1.xlsx \
  --env admin/.env.local --apply --publish "Initial import (testing)"
```

## After loading

- Staff → **Question bank** in the admin app lists both tests. Super admins see Import Excel and Start new
  version; coordinators and counsellors see the same pages read-only.
- To give another staff member rights: `update public.profiles set can_edit_content = true where email = '…';`
  (`can_approve_content` for publishing). Only a super admin (or the SQL Editor) can change these.
- A published version never changes. To change anything, start a new version (copy), edit the draft
  (editor arrives in Task 05), submit and publish.
