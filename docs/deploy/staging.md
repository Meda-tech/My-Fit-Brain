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
| `superadmin@example.com`, `coordinator@example.com`, `counsellor@example.com` | Admin app, password = `STAGING_STAFF_PASSWORD` in `supabase/.env.db` |
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
