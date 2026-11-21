# Production database log

Which files from `supabase/migrations/` are on the **production** database (`tmifixelvfdtutsakwor`).
Claude never connects to production to change anything. The owner pastes each new file into the
production **SQL Editor** and then it is added here.

How to add a line: after pasting file X into production and seeing it succeed, add a row with the date.

## Already on production

**Checked again on 2026-11-20** with a new schema-only export of production (read only, no data): production
has exactly the 23 files below and nothing else. None of the Task 12 / Task 13 files (`20261118…`,
`20261120…`) was ever pasted into production; that work was set aside on 2026-11-20 (local branch
`archive/fms-2026-11-20`) and is not in `supabase/migrations/`.

Confirmed on 2026-11-04 from a schema-only export (`supabase/baseline/production-schema-2026-11-04.sql`):
the export contains every change of the files below (offline payments, `pay_code` removed, no Google Drive
token table).

| # | File | On production since |
|---|---|---|
| 1 | `20261013000000_phase1_init.sql` | before 2026-11-04 |
| 2 | `20261013000001_renflair_sms_hook.sql` | before 2026-11-04 |
| 3 | `20261015000000_mfb_foundation.sql` | before 2026-11-04 |
| 4 | `20261016000000_question_bank.sql` | before 2026-11-04 |
| 5 | `20261016100000_qb_rule_decisions.sql` | before 2026-11-04 |
| 6 | `20261017000000_qb_test_runs.sql` | before 2026-11-04 |
| 7 | `20261018000000_attempts.sql` | before 2026-11-04 |
| 8 | `20261019000000_attempt_privacy.sql` | before 2026-11-04 |
| 9 | `20261020000000_payments.sql` | before 2026-11-04 |
| 10 | `20261021000000_paid_attempt_atomic.sql` | before 2026-11-04 |
| 11 | `20261022000000_payments_access.sql` | before 2026-11-04 |
| 12 | `20261023000000_sms_hook_v2.sql` | before 2026-11-04 |
| 13 | `20261026000000_reset_question_bank.sql` | before 2026-11-04 (one-time reset, never again) |
| 14 | `20261026000001_questionnaires.sql` | before 2026-11-04 |
| 15 | `20261027000000_client_details.sql` | before 2026-11-04 |
| 16 | `20261031000000_pay_first.sql` | before 2026-11-04 |
| 17 | `20261031000001_drop_pay_code.sql` | before 2026-11-04 |
| 18 | `20261031000002_questionnaire_active.sql` | before 2026-11-04 |
| 19 | `20261031000003_link_registered_purchases.sql` | before 2026-11-04 |
| 20 | `20261031000004_age_stops.sql` | before 2026-11-04 |
| 21 | `20261103000000_offline_payments.sql` | before 2026-11-04 |
| 22 | `20261103000001_drop_google_drive_connection.sql` | before 2026-11-04 |
| 23 | `20261105000000_attempt_conclusions.sql` | 2026-11-05 (owner confirmed) |

## One-time data fixes (not migrations)

| File | Status |
|---|---|
| `docs/tasks/17-launch-cleanup.sql` | owner request 2026-10-31; never rerun |
| `docs/tasks/19-fix-payment-order_TuZmscuEiO1eG3.sql` | run on production 2026-11-04 — marked one missed Razorpay payment paid |

## To paste later, in order

Owner decision 2026-11-20: production stays untouched until the whole flow (purchases, calls and the next steps)
works on staging. Each step adds its files here. When the owner says so, paste ALL of them into the production SQL
Editor in this order, one at a time, then run the checks. Do not paste a step on its own.

| # | File | On staging since | Checks |
|---|---|---|---|
| 1 | `20261120100000_purchases.sql` (step 1: purchases, purchase journey, coordinator per client, working hours; new tables and functions, two triggers; changes no existing table and removes nothing) | 2026-11-20 | `docs/tasks/21-purchases-verify.sql` |
| 2 | `20261120110000_payment_attempts.sql` (step 1 adjustment: unpaid tries are payment attempts, one open per phone and assessment; one paid payment per purchase; `payment_attempts` view; Move clients; no Make inactive while a coordinator has clients; adds a column to `purchases`, one table, one trigger on `profiles`; removes nothing) | 2026-11-20 | `docs/tasks/21b-payment-attempts-verify.sql`, then `docs/tasks/21-purchases-verify.sql` again |
| 3 | `20261120120000_calls.sql` (step 2: Payment and Assessment calls, call history, Mark as call done; adds `purchases.closed_reason`, two tables, functions; new bodies for the two purchase triggers and the `payment_attempts` view; removes nothing. Makes calls for existing purchases: every paid purchase whose assessment is not completed gets an Assessment call, due 2 working hours after its payment, so older ones start as Overdue; file 4 then applies the go-live rule) | 2026-11-20 | (see row 4) |
| 4 | `20261120130000_calls_go_live.sql` (step 2 answers: go-live = when this file runs. Paid in the 7 days before go-live → Assessment call due 2 working hours after go-live; paid earlier → no automatic call (closed with a note). A new failed / 30-minute-unpaid try reopens the same Payment call, also after Done or Not interested. Adds `call_settings` and `calls.closed_note`; new bodies for three functions; removes nothing). **Paste right after file 3, in the same session, at the moment of go-live.** | 2026-11-20 | `docs/tasks/23-calls-go-live-verify.sql` (replaces 22; run after file 5) |
| 5 | `20261121000000_calls_cleanup.sql` (step 2 cleanup: WIDER allowed-values lists, standing permission: `calls.outcome` + `before_go_live`, `call_logs.event` + `reopened`; the go-live-closed calls get outcome `before_go_live` (owner asked); a reopen writes a "reopened" line; removes no rows) | 2026-11-21 | `docs/tasks/23-calls-go-live-verify.sql` |
| 6 | `20261121000001_counsellor_availability.sql` (step 3: availability default stored once, Mark off / custom slots with history, `counsellor_slots()`; new tables and functions; removes nothing) | 2026-11-21 | `docs/tasks/24-availability-verify.sql` |
| 7 | `20261121100000_presentation_booking.sql` (step 4: Booking call, `presentation_bookings` (database refuses double booking), book / cancel functions; WIDER allowed values, standing permission: `calls.kind` + `booking`, `calls.outcome` + `booked`, `call_logs.event` + `presentation_booked`, `booking_cancelled`; new bodies for `calls_sync_purchase()`, `calls_sync()`, `availability_booked()`; removes no rows. Makes Booking calls for assessments completed at most 7 days before go-live or later) | 2026-11-21 | `docs/tasks/25-booking-verify.sql` |
| 8 | `20261121200000_presentation_done.sql` (step 5: Report presentation done → Package call; adds `done_at / done_by / done_by_name` to `presentation_bookings`; WIDER allowed values, standing permission: `calls.kind` + `package`; new bodies for the bookings keep-trigger and `presentation_cancel()`; one new trigger on `calls`; removes no rows) | 2026-11-21 | `docs/tasks/26-presentation-done-verify.sql` |
