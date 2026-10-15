# Task 06 — Client assessment flow (end to end, payment stubbed)

Prerequisites: Task 04 merged into `main`, `04-apply.sql` applied, all test cases of IA 1.2 and MA 1.1 run
and passing in the admin. Branch `task-06-client-flow` from `main`. Work autonomously; stop only where a
step says **STOP**.

## Goal

A registered client can choose a test, "pay" (testing stub), answer every question one at a time, resume
later, see the crisis support screen when needed, finish, and read a branded web report. Staff can see the
attempt in admin. Everything uses the live question-bank version and `@mfb/engine`; no question, rule or
report sentence in app code.

## Out of scope

Real payments (later task; stub only), report PDF and print layout (Task 07), crisis/safety notifications
and the crisis queue (Task 08 — this task only records the events), progress re-tests, the admin editor.
Renflair hook: do not touch or flag.

---

## Step 1 — Database

Migration `supabase/migrations/20261018000000_attempts.sql` (also copy to `docs/tasks/06-apply.sql`):

- `attempts` — `id uuid`, `report_id text unique null` (set on payment), `client_id → clients`,
  `test_code → qb_tests`, `version_id → qb_versions` (the live version at payment time, never changes),
  `kind` (`initial`; `progress` reserved), `parent_attempt_id null`, `status`
  (`paid` | `in_progress` | `completed` | `stopped`), `report_language` (`en` | `hi` | `both`, null until
  chosen), `consent_at`, `payment_mode` (`stub` | `live`), `payment_ref`, `paid_at`, `started_at`,
  `completed_at`, `engine_version`, timestamps.
- `attempt_answers` — `attempt_id`, `qid`, `value jsonb` (option code or array), `source`
  (`client` | `profile`), `answered_at`. PK `(attempt_id, qid)`. No free text, ever.
- `attempt_results` — `attempt_id pk`, `result jsonb` (full `AssessmentResult`), `report jsonb` (resolved
  texts for the chosen language(s)), `created_at`. **Immutable**: trigger rejects UPDATE/DELETE.
- `attempt_events` — `id`, `attempt_id`, `kind` (`crisis` | `safety` | `age_stop`), `flag_key`,
  `notify jsonb`, `created_at`, `handled_at null`, `handled_by null`. Read by Task 08.
- Report IDs: table `report_counters (test_code, year, last_number)` and function
  `next_report_id(test_code)` → `MFB-IA-2026-00001` (prefix from `qb_tests.report_id_prefix`, 5 digits,
  per test per year, concurrency-safe).
- Answers and results are locked once `status = completed` (trigger).
- RLS: clients SELECT only their own attempts, answers, results (via `clients.auth_user_id = auth.uid()`);
  no client INSERT/UPDATE/DELETE — all writes go through server actions using the service role after
  checking ownership. Staff (`is_active_staff()`) SELECT all. `attempt_events`: staff only.

Apply locally if a stack is running; if linked to remote, `--dry-run` and **STOP**; otherwise I run the SQL.

## Step 2 — Server layer (`clients/`)

All in Server Actions / server-only modules. Every action re-loads the attempt, checks it belongs to the
signed-in client, and uses the attempt's **pinned** `version_id` (never "current live").

- `startPurchase(testCode)` — stub only when `PAYMENTS_MODE=stub` (env; default off; never `stub` in
  production builds — fail closed if `VERCEL_ENV=production`). Creates the attempt with status `paid`,
  pinned live version, `report_id` from `next_report_id`, `payment_mode: stub`.
- `setLanguage(attemptId, lang)` and `giveConsent(attemptId)` → status `in_progress`.
- Profile prefill on start: write `source: profile` answers for the age-band question (from exact age),
  the sex question (from gender) and, for Intimacy, relationship status — matched by option code using the
  version's options, with the qids identified from config (questions flagged in `qb_scoring.registration`
  or equivalent from Task 03), not hard-coded. Prefilled questions are not shown to the client.
- `getStep(attemptId)` → engine `getFlow` + `nextQuestion`: current question (text EN/HI, options in order,
  type, min/max for multi, exclusive option), progress (answered / visible total), and whether the flow
  is complete.
- `saveAnswer(attemptId, qid, value)` — validate the qid is currently visible and the value is valid for it
  (option codes, gate min/max, exclusive rule); upsert; run `pruneAnswers` and delete removed answers;
  run `checkInterrupts`; for each newly fired interrupt/stop flag insert one `attempt_events` row
  (no duplicates). Return the next step plus any interrupt to show.
- `goBack(attemptId)` → previous visible question with its saved answer.
- `submit(attemptId)` — flow must be complete; `score` with the pinned version; store `attempt_results`
  (result + resolved texts in the chosen language(s)) and `engine_version`; status `completed`. Idempotent.
- AGE_STOP from the engine (should not happen after registration, but handle it): status `stopped`, delete
  all answers for the attempt, record an `age_stop` event, show the AGE_STOP text, refund note for staff.

## Step 3 — Client screens (`clients/`)

Follow CLAUDE.md brand and copy rules. URLs and titles must never contain the test name
(use `/assessment/[attemptId]`, `/report/[attemptId]`; tab title "My Fit Brain").

1. **Home** — "Start an assessment" with one card per test: name, "Designed by Dr. Neha Mehta" line, and
   the SUBTITLE text from the live version. "Your assessments": in-progress (Continue) and completed
   (View report), newest first.
2. **Payment (stub)** — shows the test name and ₹3,500 (the only place a price appears) and, only when
   `PAYMENTS_MODE=stub`, a clearly labelled "Mark as paid (testing)" button. Endorsed logo.
3. **Report language** — English / हिंदी / Both.
4. **Consent** — one line plus one primary button. Use the consent wording from the developer spec in
   `docs/spec/`. If the spec has no consent line, use: "Your answers are private and used only to prepare
   your report and your sessions." and log it in `docs/questionbank/decisions.md` as pending review.
   No marketing opt-in.
5. **Question screen** (max 640px column, sticky 56px header with EN | हिं toggle):
   - Progress bar (teal on sand) with "Question n of m"; m can change as routing changes.
   - Likert and single: large option cards (min 56px), tap selects and auto-advances after 400 ms;
     selected state mist + teal border. Yes/No: two cards, same behaviour.
   - Multi (gate, R1/MR1): checkboxes, "Continue" enabled only within min/max; selecting the exclusive
     option clears the others and vice versa; gate shows "Choose up to 2".
   - Back link (secondary). Answers save on every tap; refresh or return resumes at the same place.
   - Keyboard accessible, visible focus (coral), screen-reader labels, no timers, no streaks or confetti.
6. **Crisis support screen** — appears immediately after the crisis answer, full screen, calm: CRISIS text
   from the version, Tele-MANAS `tel:14416` and `tel:18008914416` as large buttons, and "Continue the
   assessment" (secondary). No red, no alarm icons.
7. **Finish** — "Thank you" screen, then a short "Preparing your report" state while `submit` runs, then
   redirect to the report.
8. **Report (web)** — max 760px, printable later. Sections in the spec order, every sentence from
   `attempt_results.report`:
   crisis block first (crisis layout only) → header (endorsed logo, TITLE, SUBTITLE, DESIGNED_BY, report
   ID, date) → snapshot (H_SNAPSHOT, one bar per area with % and band name, SNAPSHOT_NOTE) → strengths
   → stuck points → what it means → plan (PLAN_LINE with placeholders filled; hidden in crisis layout) →
   focus (hidden in crisis layout) → medical / safety blocks (flag order) → next step (CRISIS_NEXT in crisis
   layout) → NRI line if flagged → disclaimer → founder seal in the footer.
   Band bar colours use the `band-*` tokens. "Both" language shows EN then HI per section.
   Counsellor-only tags never appear.

## Step 4 — Admin (minimal, read-only)

- Client detail page: list of the client's attempts (report ID, test, version, status, dates).
- `/attempts/[id]`: the client-facing report exactly as the client sees it, plus a "Counsellor view" panel:
  module %/bands, points breakdown, tier before/after overrides, format, all flags including dashboard
  tags, readiness, raw answers with question text, `attempt_events`. Visible to active staff.
- Dashboard: "Assessments completed" and "In progress" counts.

## Step 5 — Tests and verification

1. Unit tests for the server layer with the engine and real configs (no network): prefill mapping,
   answer validation (invisible qid, bad option, gate min/max, exclusive), pruning on path/gate change,
   interrupt events written once, submit idempotency, pinned version used after a new version goes live.
2. A scripted run per test that plays a full answer set from the IA 1.2 and MA 1.1 test cases through the
   server layer (against a local DB if available) and checks the stored result equals the test case's
   expected result.
3. `npm test`, `npm run lint`, `npm run build` pass.
4. Write `docs/tasks/06-manual-check.md`: a click-through script for me (log in, register, start Intimacy,
   stub pay, answer partner path with G + A, go back and change I6 to no partner, finish, read report;
   start Mind, answer MR5 = Yes, see the support screen, finish, check crisis layout; check admin views).

## Step 6 — Finish

1. Update `CLAUDE.md`: attempts model, pinned versions, payment stub rule (`PAYMENTS_MODE`), report built
   only from stored results; Status: Task 06 done, next Task 07 (report PDF + polish).
2. Commit in chunks (migration, server layer, screens, report, admin, tests, docs). Do not merge to `main`.
3. Print a short summary: SQL to run, env vars to set (`PAYMENTS_MODE=stub` locally), anything not done,
   any copy logged as pending review.
