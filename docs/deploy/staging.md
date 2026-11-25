# Staging database

Staging is a second Supabase project with **fake data only**. Every database change is tried there first.

| | Production | Staging |
|---|---|---|
| Project | `tmifixelvfdtutsakwor` | `ndlqjmcpmkkulpinwbxe` |
| Who changes it | the owner, by pasting a file into the SQL Editor | Claude, with `supabase/staging-migrate.ps1` |
| Data | real | fake (`supabase/seed-staging.sql`) |

Connection strings live in `supabase/.env.db` (`PROD_DB_URL`, `STAGING_DB_URL`, `STAGING_STAFF_PASSWORD`).
That file is ignored by git and its values are never printed. `PROD_DB_URL` is used only for read-only,
schema-only exports.

## How staging was built (2026-11-04)

1. Schema-only export of production (no data) → `supabase/baseline/production-schema-2026-11-04.sql`.
   No secrets inside: the SMS hook reads the Renflair key from Vault at run time.
2. That file applied to the empty staging project.
3. All 22 migration files recorded as applied on staging (`staging-migrate.ps1 -MarkAllApplied`).
4. Fake data loaded: `staging-migrate.ps1 -Run supabase/seed-staging.sql`.

## Reset to production (2026-11-20)

All Task 12 (Gold journey FMS) and Task 13 (coordinator orders) changes were removed from staging on 2026-11-20
(owner request): their tables, functions, triggers, access rules, the pg_cron timer, the Program Manager and
Accounts test logins and four demo payments. A schema-only export of staging was then compared with one of
production: same tables, functions, triggers, access rules and grants. Two things exist on staging only, on
purpose:

- the owner's **n8n payment webhook** (`notify_n8n_payment_paid` and the triggers `payments_paid_notify_insert`
  / `_update`; SQL in `supabase/staging/20261110_n8n_payment_webhook.sql`, never for production);
- `supabase_migrations.schema_migrations`, the record `staging-migrate.ps1` keeps of applied files.

## Commands (PowerShell, from the repo root, Docker running)

```powershell
powershell -File supabase/staging-migrate.ps1 -List      # new migration files staging does not have yet
powershell -File supabase/staging-migrate.ps1            # apply them to staging
powershell -File supabase/staging-migrate.ps1 -Run docs/tasks/18-offline-payments-verify.sql   # run one file
```

The script reads only `STAGING_DB_URL` and refuses to run if it does not point to `ndlqjmcpmkkulpinwbxe`.

## Fake test data

| Login | How |
|---|---|
| `superadmin@example.com`, `coordinator@example.com`, `counsellor@example.com` (also `coordinator2@`, `counsellor2@`) | Admin app, password = `STAGING_STAFF_PASSWORD` in `supabase/.env.db` |
| `crm@example.com`, `crm2@example.com` (role CRM, since 2026-11-25) | Admin app, same password. Added by `supabase/staging/staging-add-crm-logins.sql` |
| Riya, Sana, Tara, Uma, Veda, Zoya Test `+91 99999 00061` … `00066` | at the Package call stage (paid IA, completed, presentation done), for package part payments and the CRM page. Added by `supabase/staging/staging-part-payments-setup.sql` |
| Asha Test `+91 99999 00001` | paid IA, not started (Home shows Start) |
| Rahul Test `+91 99999 00002` | one failed MA payment, one offline UPI MA payment (paid, not started) |
| Meera Test `+91 99999 00003` | registered, nothing bought |
| `+91 99999 00005` | paid IA on the pay link, never logged in (claimed at the first login) |

Clients log in with phone OTP. Use the test numbers below so no SMS is sent.
To change the staff password: edit `STAGING_STAFF_PASSWORD`, then
`staging-migrate.ps1 -Run supabase/staging-reset-staff-password.sql`.

## Dashboard settings to copy by hand (staging project)

Open https://supabase.com/dashboard/project/ndlqjmcpmkkulpinwbxe and do each step.

- [ ] **Phone login on** — Authentication → Sign In / Providers → **Phone** → Enable. Under
      *Test Phone Numbers and OTPs* add `919999900001=123456, 919999900002=123456, 919999900003=123456,
      919999900005=123456` (no SMS is sent to these; code `123456`). Save.
- [ ] **SMS hook** — Authentication → Auth Hooks → **Add hook → Send SMS hook** → Postgres, schema
      `public`, function `custom_send_sms` → Enable. (Needed only for real numbers.)
- [ ] **Vault secret** (only if you want real SMS on staging) — SQL Editor, run once and do not save the query:
      `select vault.create_secret('<renflair key>', 'renflair_api_key', 'Renflair OTP API key');`
      Without it, real numbers get "SMS is not available right now"; the test numbers above still work.
- [ ] **JWT keys** — Project Settings → JWT Keys → use the asymmetric (ECC) signing keys, as on production.
- [ ] **URLs** — Authentication → URL Configuration → Site URL = the staging clients URL, e.g.
      `https://mfb-clients-staging.vercel.app`. Redirect URLs: add
      `https://<staging-clients-url>/**`, `https://<staging-admin-url>/**`, `http://localhost:3000/**`,
      `http://localhost:3001/**`, and for Vercel preview links `https://*-<your-vercel-team>.vercel.app/**`.
- [ ] **Email sign-ups off** (as on production, if set there) — Authentication → Sign In / Providers →
      Email: keep Email enabled (staff sign in with it), turn off *Allow new users to sign up* if production has it off.
- [ ] **Storage buckets** — none on production. Nothing to do.
- [ ] **Cron jobs** — none on production (`pg_cron` not installed). Nothing to do.

## Staging on Vercel (branch `staging`)

Same two Vercel projects. **Production** env vars = production; **Preview** env vars = staging, for every
branch, so no preview can ever touch real data. The `staging` branch gets fixed addresses:
`staging.myfitbrain.app` (mfb-clients) and `staging-admin.myfitbrain.app` (mfb-admin), each added under
Settings → Domains → Add → Git branch `staging` (DNS: CNAME `staging` / `staging-admin` → `cname.vercel-dns.com`).
Update: merge or push into `staging` → both staging sites redeploy. Release: merge `staging` into `main`.

Vercel staging projects (env vars, same names as production; values from staging):
`NEXT_PUBLIC_SUPABASE_URL=https://ndlqjmcpmkkulpinwbxe.supabase.co`, the staging publishable/anon key,
the staging `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API Keys), `NEXT_PUBLIC_CLIENTS_URL` /
`NEXT_PUBLIC_ADMIN_URL` = the staging URLs, **Razorpay Test Mode** keys only, and a separate Google Drive
test folder for offline-payment proofs.
