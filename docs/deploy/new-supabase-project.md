# Setting up a new Supabase project

Use this when moving to a different Supabase account or project. The repository holds everything needed to
rebuild the database structure and the questionnaires. It does **not** hold your data (clients,
assessments, payments, staff): see "Moving existing data" at the end.

All SQL runs in the new project's **SQL Editor**, one file at a time, in this exact order. Each file is one
transaction: if something fails, nothing from that file is saved; fix the cause and run it again.

## 1. Run the SQL, in this order

| # | File | Notes |
|---|---|---|
| 1 | `supabase/migrations/20261013000000_phase1_init.sql` | profiles, clients, staff helpers, RLS |
| 2 | `supabase/migrations/20261013000001_renflair_sms_hook.sql` | SMS hook function for phone OTP |
| 3 | `supabase/migrations/20261015000000_mfb_foundation.sql` | roles, gender / relationship values |
| 4 | `supabase/migrations/20261016000000_question_bank.sql` | the old question bank: needed only because files 5–9 reference its tables; file 11 drops it again |
| 5 | `supabase/migrations/20261018000000_attempts.sql` | report_counters (kept), old attempts tables (dropped by 11) |
| 6 | `supabase/migrations/20261019000000_attempt_privacy.sql` | `can_view_reports()` |
| 7 | `supabase/migrations/20261020000000_payments.sql` | payments, webhook events |
| 8 | `supabase/migrations/20261021000000_paid_attempt_atomic.sql` | (replaced by 12; harmless) |
| 9 | `supabase/migrations/20261022000000_payments_access.sql` | `can_view_payments()` |
| 10 | `supabase/migrations/20261023000000_sms_hook_v2.sql` | SMS hook v2: 10-digit numbers, key from Vault. **First** store the key: `select vault.create_secret('<key>', 'renflair_api_key', 'Renflair OTP API key');` (do not save that query) |
| 11 | `supabase/migrations/20261026000000_reset_question_bank.sql` | drops the old question bank and the old attempts tables (empty here) |
| 12 | `supabase/migrations/20261026000001_questionnaires.sql` | questionnaires, versions, attempts, answers, results, alerts; seeds IA and MA |

Skip `20261016100000` and `20261017000000` (old question-bank files; the reset removes what they made anyway).
| 13 | `supabase/migrations/20261027000000_client_details.sql` | client-details list per questionnaire and the typed answers (`attempt_details`) |
| 14 | `supabase/migrations/20261031000000_pay_first.sql` | pay first, log in later: pay link code, purchases owned by a phone, `payment_moves` |

Any migration added later goes after 14, in file-name order.

**Checks** (read-only), after the matching step: `docs/tasks/02-verify.sql` (after 3),
`08-payments-verify.sql` (after 7), `08c-payments-access-verify.sql` (after 9), `09-sms-hook-verify.sql`
(after 10; sends a test SMS), `11-verify.sql` (after 12), `13-pay-first-verify.sql` (after 14).

Then import the starting drafts: Admin → Questionnaires → open **MFB Intimacy Assessment** → paste
`docs/questionnaires/intimacy.json` into **Import JSON** → **Publish**; the same for **MFB Mind Assessment**
with `mind.json`.

## 2. Dashboard settings (not SQL)

| Where (new project) | Set |
|---|---|
| Authentication → Sign In / Providers → Phone | Enabled, as in the current project |
| Authentication → Auth Hooks → Send SMS hook | **Required for OTP.** Type Postgres, schema `public`, function `custom_send_sms`, enabled. The SQL creates the function but does not switch the hook on |
| Project Settings → JWT Keys | Use the asymmetric signing keys (ECC), so sign-in checks run without a network call |
| Authentication → URL Configuration | Site URL `https://app.myfitbrain.app`; Redirect URLs `https://app.myfitbrain.app/**`, `https://admin.myfitbrain.app/**` |

## 3. First super admin

1. Authentication → Users → **Add user** (email + strong password, tick *Auto Confirm User*). Copy the UID.
2. Open `supabase/seed.sql`, fill in the UID, name and email, and run the `INSERT` in the SQL Editor.
3. Sign in to the admin app with that email. Add coordinators and counsellors from **Team**.

## 4. Point the apps at the new project

New values from Project Settings → API (Project URL, `anon` key, `service_role` key):

- `clients/.env.local` and `admin/.env.local` for local work;
- Vercel → both projects → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; then **Redeploy** both.

Razorpay needs no change (its webhook points at the app, not at Supabase). If the new project is in a
different region, set each Vercel project's Function region to match (`docs/deploy/vercel.md`).

## Moving existing data

The steps above give an empty database with the questionnaires. To keep real clients, staff accounts,
assessments and payments, copy the data too, before switching the apps:

- Easiest: Supabase's own guide "Migrating within Supabase" (Dashboard → Database → backups, or
  `pg_dump` / `pg_restore` with the two connection strings). It also moves `auth.users` (sign-ins), which
  plain table copies do not.
- Do it while the old project is quiet (no assessments or payments running), then switch the env vars and
  redeploy straight away.
- If the old project is only test data, skip this: start clean and create the first super admin (step 3).
