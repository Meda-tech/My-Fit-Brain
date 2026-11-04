# Production database log

Which files from `supabase/migrations/` are on the **production** database (`tmifixelvfdtutsakwor`).
Claude never connects to production to change anything. The owner pastes each new file into the
production **SQL Editor** and then it is added here.

How to add a line: after pasting file X into production and seeing it succeed, add a row with the date.

## Already on production

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

## One-time data fixes (not migrations)

| File | Status |
|---|---|
| `docs/tasks/17-launch-cleanup.sql` | owner request 2026-10-31; never rerun |
| `docs/tasks/19-fix-payment-order_TuZmscuEiO1eG3.sql` | run on production 2026-11-04 — marked one missed Razorpay payment paid |

## Waiting for production

Files that are on staging but not yet on production. Paste them into the production SQL Editor in this order.

_None._
