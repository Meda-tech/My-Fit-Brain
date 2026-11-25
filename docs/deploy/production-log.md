# Production database log

Which files from `supabase/migrations/` are on the **production** database (`tmifixelvfdtutsakwor`).
Claude never connects to production to change anything. The owner pastes each new file into the
production **SQL Editor** and then it is added here. One exception: the go-live of 2026-11-21, which Claude ran on
production with the owner's permission for that go-live only (rows 24–42 below); the rule applies again after it.

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
| 24 | `20261120100000_purchases.sql` | 2026-11-21, 5:52:46 pm IST (go-live, run by Claude with the owner's permission) |
| 25 | `20261120110000_payment_attempts.sql` | 2026-11-21, 5:52:49 pm IST (go-live, run by Claude with the owner's permission) |
| 26 | `20261120120000_calls.sql` | 2026-11-21, 5:52:54 pm IST (go-live, run by Claude with the owner's permission) |
| 27 | `20261120130000_calls_go_live.sql` | 2026-11-21, 5:52:57 pm — **go-live = 5:52:58 pm** IST (go-live, run by Claude with the owner's permission) |
| 28 | `20261121000000_calls_cleanup.sql` | 2026-11-21, 5:52:59 pm IST (go-live, run by Claude with the owner's permission) |
| 29 | `20261121000001_counsellor_availability.sql` | 2026-11-21, 5:53:02 pm IST (go-live, run by Claude with the owner's permission) |
| 30 | `20261121100000_presentation_booking.sql` | 2026-11-21, 5:53:06 pm IST (go-live, run by Claude with the owner's permission) |
| 31 | `20261121200000_presentation_done.sql` | 2026-11-21, 5:54:19 pm IST (go-live, run by Claude with the owner's permission) |
| 32 | `20261121300000_packages.sql` | 2026-11-21, 5:54:22 pm IST (go-live, run by Claude with the owner's permission) |
| 33 | `20261121400000_presentation_label_12h.sql` | 2026-11-21, 5:54:28 pm IST (go-live, run by Claude with the owner's permission) |
| 34 | `20261121400001_presentation_label_range.sql` | 2026-11-21, 5:54:29 pm IST (go-live, run by Claude with the owner's permission) |
| 35 | `20261121500000_booking_three_working_days.sql` | 2026-11-21, 5:54:32 pm IST (go-live, run by Claude with the owner's permission) |
| 36 | `20261121600000_counsellor_clients.sql` | 2026-11-21, 5:54:35 pm IST (go-live, run by Claude with the owner's permission) |
| 37 | `20261121700000_before_system.sql` | 2026-11-21, 5:54:39 pm IST (go-live, run by Claude with the owner's permission) |
| 38 | `20261121700001_before_system_planned.sql` | 2026-11-21, 5:55:32 pm IST (go-live, run by Claude with the owner's permission) |
| 39 | `20261121800000_admin_presentation_done.sql` | 2026-11-21, 5:55:34 pm IST (go-live, run by Claude with the owner's permission) |
| 40 | `20261121900000_old_purchases_bookable.sql` | 2026-11-21, 5:55:36 pm IST (go-live, run by Claude with the owner's permission) |
| 41 | `20261122000000_payment_calls_go_live.sql` | 2026-11-21, 5:55:39 pm IST (go-live, run by Claude with the owner's permission) |
| 42 | **One-time go-live step** `supabase/go-live/assign-old-clients.sql` (not a migration; never run it again) | 2026-11-21, 5:55:43 pm IST — result: coordinator Reetu, counsellor Preeti, 1 phone added, 0 purchases changed, 18 clients assigned to the counsellor |
| 43 | `20261123000000_repeat_payments.sql` (repeat tries and payments: one open purchase per phone and assessment, blocked tries as history, safety net "Refund needed"; one-time fix of extra unpaid rows) | 2026-11-23, 3:37 pm IST (run by Claude with the owner's permission for this go-live only). Check 34: 8 true, 0 false. The one-time fix closed 3 extra unpaid rows as "Not needed" (Tarnjit Singh's 22 Nov try, "already paid on 17 Nov"; one try of 14 Nov and one of 22 Nov by two other clients who had paid the same day) |
| 44 | `20261123300000_purchase_finished.sql` (a purchase is also finished when its Assessment, Booking or Package call is closed as Not interested) | 2026-11-23, 3:38 pm IST (same go-live). Check 35: 4 true, 0 false |
| 45 | `20261123400000_call_choices.sql` ("Mark as call done" on every call: Talked to client · Not picked / Call later · Not interested after at least 2 calls; no Done) | 2026-11-23, 4:58:49 pm IST (run by Claude with the owner's permission for this go-live only). Check 36: 4 true, 0 false. Branch `step-assessment-payment-button` (with `step-call-choices`) merged and pushed right after (`6b1ce4d`) |

## One-time data fixes (not migrations)

| File | Status |
|---|---|
| `docs/tasks/17-launch-cleanup.sql` | owner request 2026-10-31; never rerun |
| `docs/tasks/19-fix-payment-order_TuZmscuEiO1eG3.sql` | run on production 2026-11-04 — marked one missed Razorpay payment paid |

## To paste later, in order

| # | File | On staging since | Checks |
|---|---|---|---|
| 46 | `20261124000000_package_part_payments_crm.sql` (package part payments, handover to CRM, CRM role; branch `step-package-part-payments-crm`). REMOVES NOTHING: no row, table or column is deleted and no existing access rule is dropped or changed. WIDER allowed-values lists (standing permission): `profiles.role` + `crm`, `calls.outcome` + `package_started`, `call_logs.event` + `package_part_paid`, `package_started`, the `package_payments` amount rule (a part amount is allowed). New columns: `packages.first_min_paise / start_paise / milestones` (₹1,000 / ₹10,000 / 10,000-15,000-25,000-31,500), `package_payments.counted_at / after_handover` (existing paid package payments get `counted_at` filled), `purchases.crm_id`. New tables `crm_round_robin`, `client_crms`, `crm_client_moves`. New RESTRICTIVE rules: a CRM login reads no client, assessment, answer, result, client detail, conclusion, safety alert or questionnaire version; Package purchase rows are for super admins; package payments made after the handover are hidden from coordinators. New bodies for `package_offer()`, `package_settle()`, `package_payment_manual()`, `call_mark()`. **Paste it together with the deploy of the branch** (the admin app of the branch needs it, and the admin app on `main` does not know the new "Package started" result). **After it runs:** add the CRM staff in Admin → Team (packages that started before a CRM exists wait and are assigned to the first CRM added), and check the amounts in Admin → Settings. | 2026-11-25 | `docs/tasks/37-package-part-payments-crm-verify.sql` (20 rows); then `27-packages-verify.sql` and `21-purchases-verify.sql` (both updated for this file), and 23, 30, 34, 35, 36 again |
| 47 | `20261125000000_package_pending_payment_call.sql` (the Pending payment call after a package part payment; the start amount in at most 2 payments; branch `step-package-pending-payment-call`). Paste right after row 46, together with the deploy of this branch. REMOVES NOTHING: no row, table, column or rule is deleted. WIDER allowed-values lists (standing permission): `calls.kind` + `pending_payment`, `calls.outcome` + `part_paid`. New column `package_payments.follow_up_at`; new function `pending_follow_up_last()`; a second `package_payment_add()` with a follow-up (the older one stays and calls it). New bodies for `package_settle()`, `package_start_if_due()`, `call_mark()`, `purchase_is_open()`. One-time step: a package already part paid gets the new flow (its open Package call closes as "Part payment received", a Pending payment call is made); on production none exists yet, so it changes nothing there. | 2026-11-25 | `docs/tasks/38-package-pending-payment-call-verify.sql` (12 rows); then 37, 27, 21, 23, 36 again |

(Row 45 went live on 2026-11-23, 4:58 pm IST.)

Earlier: (Rows 43–44 went live on 2026-11-23; the two staging-only files `20261123100000_close_purchase.sql` and
`20261123200000_package_after_close.sql` were removed before production and never ran there.)

(The 18 files and the go-live step of 2026-11-21 are listed above as rows 24–42.)

### Go-live of 2026-11-21: what each file did, and its checks

Run on production by Claude (owner's permission, this go-live only), after a fresh backup
(`D:\Tech\Meda\backups\prod-2026-11-21-1751\`, full.dump 641,279 bytes, data for 55 tables). Each file was its own
transaction; each group was checked with `supabase/prod-readonly.ps1 -Check` (read-only).

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
| 9 | `20261121300000_packages.sql` (step 6: package settings (seeded: 8 sessions, 1 session every week, ₹35,000), `package_payments` (its own table; the `payments` table is not touched), Package purchases (`purchases.parent_purchase_id`, one paid package per assessment purchase), offer / Razorpay / manual / settle functions; WIDER allowed values, standing permission: `purchases.kind` + `package`, `calls.outcome` + `package_paid`, `call_logs.choice` + `agreed` (needs a follow-up), `call_logs.event` + four `package_*`; new bodies for `call_mark()` and `calls_sync()`; removes no rows). **Before go-live:** set the package name and price in Admin → Settings, and make sure the Razorpay webhook (same URL as today) is on. | 2026-11-21 | `docs/tasks/27-packages-verify.sql`; then 21, 21b, 23, 24, 25, 26 again |
| 10 | `20261121400000_presentation_label_12h.sql` (12-hour times: new body for `presentation_label()` only; removes nothing) | 2026-11-21 | `docs/tasks/28-presentation-label-verify.sql` (after row 11) |
| 11 | `20261121400001_presentation_label_range.sql` (the booking line in the call history shows the whole slot, "9:00–9:30 pm"; new body for `presentation_label()` only; removes nothing) | 2026-11-21 | `docs/tasks/28-presentation-label-verify.sql` |
| 12 | `20261121500000_booking_three_working_days.sql` (Book presentation shows and allows only the next 3 working days: new `booking_last_day()`, new bodies for `free_presentation_slots()` and `presentation_book()`; existing bookings untouched; removes nothing) | 2026-11-21 | `docs/tasks/29-booking-window-verify.sql`; then 25 again |
| 13 | `20261121600000_counsellor_clients.sql` (counsellors see only their own clients: new `client_counsellors` (filled from the bookings so far) and `counsellor_client_moves`; new RESTRICTIVE rules on clients, attempts and the report tables, for counsellors only, no existing rule dropped; Move clients and the clash list; new body for `presentation_bookings_keep_trigger()`; no Make inactive while a counsellor has clients; removes nothing). **Note:** from this file on, a counsellor sees no client until one is assigned: row 19 assigns the old clients at go-live. | 2026-11-21 | `docs/tasks/30-counsellor-clients-verify.sql`; then 25, 26 again |
| 14 | `20261121700000_before_system.sql` (purchases paid, or last tried, more than 7 days before go-live: `before_system()`, no call of any kind (trigger on `calls`), their open calls closed with a note, not bookable (new body for `presentation_book()`); removes nothing) | 2026-11-21 | (after row 15) |
| 15 | `20261121700001_before_system_planned.sql` (before-the-system purchases: steps not done lose their planned time; removes no rows) | 2026-11-21 | `docs/tasks/31-before-system-verify.sql`; then 23 again |
| 16 | `20261121800000_admin_presentation_done.sql` (old purchases: "Mark report presentation done" by a super admin without a slot (`presentation_mark_done_admin()`), then the normal package flow; adds the function `go_live_assign_old_clients()`. WIDER rules, standing permission: `presentation_bookings.start_time / end_time` may be empty (only for an admin-marked presentation; new column `marked_by_admin`), `client_counsellors` may be assigned at go-live (new column `at_go_live`, CHECK replaced by a wider one), the no-calls trigger lets the Package call through; removes nothing) | 2026-11-21 | `docs/tasks/32-admin-presentation-verify.sql` (its three GO-LIVE STEP rows turn true after row 19); then 25, 31 again |
| 17 | `20261121900000_old_purchases_bookable.sql` (old purchases can be booked into a slot by hand: new body for `presentation_book()` only; removes nothing) | 2026-11-21 | `docs/tasks/31-before-system-verify.sql` |
| 18 | `20261122000000_payment_calls_go_live.sql` (Payment calls for unpaid tries in the 7 days before go-live start at go-live, due 2 working hours later, like the other calls: new trigger `calls_start_at_go_live`, open Payment calls not yet worked get that start and due time; removes nothing) | 2026-11-21 | `docs/tasks/33-payment-calls-go-live-verify.sql`; then 23 again |
| 19 | **One-time go-live step, not a migration:** `supabase/go-live/assign-old-clients.sql` (all existing clients get the only active coordinator; all existing clients with a paid assessment are assigned to the only active counsellor). It STOPS and changes nothing unless there is exactly one active coordinator and one active counsellor: then fix that in Admin → Team and paste it again. | 2026-11-21 | `docs/tasks/32-admin-presentation-verify.sql`: every row true |

**Checks on production.** After the files: 21 (16/16), 21b (9/9), 23 (19/19), 24 (8/8), 26 (7/7), 27 (14/14),
28 (1/1), 29 (3/3), 30 (7/7), 25 (11/11, after file 14), 31 (3/3, after file 17), 33 (3/3), 23 again (19/19).
After the go-live step, all 13 check files again: **110 true, 0 false**.

**Two stops on the way, both from check order, not from production** (the owner said continue each time):
check 25 was first run after file 7 but now uses `before_system()` from file 14 (error, nothing changed); check 31
was then run after file 14 but one row tests file 17. The runbook now runs 25 after file 14 and 31 after file 17.

**Production right after go-live (read-only counts):** 24 assessment purchases and tries (14 before the system, 10 in
the flow), 19 clients, 25 payments; open calls: 9 Booking and 1 Payment, all due Mon 23 Nov 10:52 am IST, none late;
18 clients assigned to the counsellor.

## Backups and rehearsals

| Date | What | Result |
|---|---|---|
| 2026-11-23, 4:58 pm IST | Full production backup before row 45 (`supabase/prod-readonly.ps1 -Backup`) into `D:TechMedaackupsprod-2026-11-23-1658` | full.dump (pg_dump -Fc) 894,967 bytes; schema.sql 570,168; data.sql 1,106,849 (restored from the dump without error) |
| 2026-11-23, 3:37 pm IST | Full production backup before rows 43–44 (`supabase/prod-readonly.ps1 -Backup`) into `D:TechMedaackupsprod-2026-11-23-1537` | full.dump (pg_dump -Fc) 877,673 bytes; schema.sql 555,938; data.sql 1,104,705 (restored from the dump without error) |
| 2026-11-21, 5:22 pm IST | **Full backup of production** (read-only, `pg_dump` 17.11 = production's Postgres 17.11), asked for by the owner. Outside the project, never in git: `D:\Tech\Meda\backups\prod-2026-11-21\` → `full.dump` (custom format, all schemas incl. auth and storage), `schema.sql`, `data.sql` (both written from `full.dump`, so the same moment). Storage: no buckets, no files. | Restored into a temporary local database (Docker, no ports open): no errors; 58 tables, row counts equal on 57. The one difference, `net._http_response` (1 vs 0), is an extension's temporary log that `pg_dump` never includes. |
| 2026-11-21 | **Dress rehearsal** in that temporary local database (never production, never staging): rows 1–17 of "To paste later, in order", every check file, then the go-live step (row 18). The temporary database was deleted afterwards. | All 17 files ran with no error or warning. Checks: all true (107), the last one after the go-live step. Go-live step: exactly one active coordinator and one active counsellor found; 18 clients assigned to the counsellor, 1 phone added to the coordinator, 0 purchases changed (they already had the coordinator). At go-live: 24 rows in Purchases (18 purchases, 6 unpaid tries), 14 before the system, 10 in the flow; open calls: 8 Booking, 1 Assessment (all due 2 working hours after go-live), 1 Payment call that is **late at once** (an unpaid try from 7 days before go-live keeps its own due time). |
| 2026-11-21, 5:37 pm IST | **Second dress rehearsal** on a fresh temporary local copy of the same backup: rows 1–18 (now including `20261122000000_payment_calls_go_live.sql`), every check file, the go-live step (row 19). Temporary database deleted afterwards. | All 18 files OK, no error or warning. Checks: 110 true, 0 false after the go-live step (one false before it, as designed). Go-live step: 18 clients to the counsellor, 1 phone, 0 purchases. Open calls at go-live: 8 Booking, 1 Assessment, 1 Payment, all due 2 working hours after go-live, **none late** (the Payment call that was late in the first rehearsal now starts at go-live). |

The owner runs production with `docs/deploy/go-live-runbook.md`; backups and check files on production with the read-only `supabase/prod-readonly.ps1`.
