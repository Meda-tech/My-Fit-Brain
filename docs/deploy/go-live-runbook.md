# Go-live runbook

> **Used on 2026-11-21: production went live at 5:52:58 pm IST** (rows 24–42 of `docs/deploy/production-log.md`).
> Kept for reference and for a new environment. The check order below is the corrected one: on the day, check 25
> was first run after file 7 and check 31 after file 14, which stopped the run twice (no harm done).

For the owner. You run every step on production yourself; nothing here is run by Claude. Every SQL file below
was rehearsed on a restored copy of the production backup of 21 Nov 2026: all 18 files ran without an error or a
warning, and all 110 checks came back true (`docs/deploy/production-log.md`, "Backups and rehearsals").

Plan about **90 minutes**, on a working day, in one sitting. Steps 3 and 4 must be done the same day: the
moment file 4 runs becomes **go-live**, and the "7 days before go-live" rules count from it.

| Step | What | Time |
|---|---|---|
| 0 | Decide the repository question (public repo safety) | before the day |
| 1 | Fresh production backup | 5 min |
| 2 | Supabase dashboard checks | 10 min |
| 3 | Paste the SQL files 1–18, with their checks | 40 min |
| 4 | The one-time go-live step (file 19) | 5 min |
| 5 | Repository public, push `main` | 10 min |
| 6 | Vercel: environment variables, deploy | 15 min |
| 7 | 5-minute live check | 5 min |
| — | If something fails | — |

**Golden rules**
- One file at a time, in order. Never skip a file, never paste a file twice.
- Every migration file is one transaction (`BEGIN … COMMIT`). **If a file shows an error, nothing from it was
  saved.** Stop there, do not paste the next file, and send the error text to Claude.
- Paste the database files (step 3–4) **before** pushing the new code (step 5–6): the new code needs the new
  tables. Meanwhile the old code keeps running. **Not tested: the old code against the new database.** The files
  only add tables, rules and triggers, and the new triggers on payments never block a payment (tested on staging).
  One visible effect: from file 13 until step 4, a counsellor in the old admin sees no clients (file 13 narrows
  counsellor access; step 4 assigns the old clients). Keep steps 3–4 short and in one sitting.

---

## 0. Before the day: the public repository

Do not make the repository public until the findings of the safety check are settled (the summary Claude gave
on 21 Nov 2026: a Renflair SMS key and two real phone numbers are in the git history already on GitHub). The
recommended way is a **new repository with one clean commit**; Vercel is then connected to that repository.
Rotate the Renflair API key in any case (step 2).

---

## 1. Fresh production backup (5 min)

Docker Desktop running. PowerShell, in `D:\Tech\Meda\MyFitBrain`:

```powershell
powershell -File supabase/prod-readonly.ps1 -Backup
```

It is read-only (it can not change production). It writes `full.dump`, `schema.sql` and `data.sql` into
`D:\Tech\Meda\backups\prod-<date>-<time>\` and prints their sizes.

**OK looks like:** three files, `full.dump` around 0.6 MB or more (21 Nov: 639,570 bytes), and `done: …`.
Copy that folder to a second place (an encrypted drive or private cloud folder). It holds real client data:
never put it in the repository, never send it to anyone.

Also: Supabase → **Database → Backups**: note the time of the latest automatic backup (and whether
point-in-time recovery is on). That is the fastest way back if needed (see "If something fails").

---

## 2. Supabase dashboard checks (10 min)

Project `tmifixelvfdtutsakwor`.

- [ ] **Extensions** (Database → Extensions): `pg_net` **on** (the SMS hook uses it), `pgcrypto` on.
      **`pg_cron` is not needed**: nothing is scheduled; the timed call rules run when My tasks or Purchases opens.
- [ ] **Phone login** (Authentication → Sign In / Providers → Phone): enabled. Test phone numbers: none, or only
      the ones you really use for testing.
- [ ] **SMS hook** (Authentication → Auth Hooks): Send SMS hook → Postgres → `public.custom_send_sms` → **enabled**.
- [ ] **Renflair key** in Vault: rotate it with Renflair first (the old key is in the old git history), then in
      the SQL Editor (do not save this query):
      `select vault.update_secret((select id from vault.secrets where name = 'renflair_api_key'), '<new key>');`
      Then send yourself a login code to a real number to confirm SMS still arrives.
- [ ] **JWT keys** (Project Settings → JWT Keys): asymmetric (ECC) signing keys in use.
- [ ] **URL configuration** (Authentication → URL Configuration): Site URL `https://www.myfitbrain.app`; Redirect
      URLs include `https://www.myfitbrain.app/**` and `https://admin.myfitbrain.app/**`.
- [ ] **Email sign-ups**: Email provider on (staff sign in with it), *Allow new users to sign up* **off**.
- [ ] **Team** (in the current admin, Team page): exactly **one active coordinator and one active counsellor**.
      The go-live step (4) refuses to run otherwise.
- [ ] **Storage**: no buckets. Nothing to do.

---

## 3. Paste the SQL files (40 min)

Supabase → **SQL Editor → New query**. For each file: open it in the repository (`supabase/migrations/…`),
copy **everything**, paste, **Run**.

**OK looks like:** "Success" (often "No rows returned"), no red error. Some files end with a small result
(for example a number): that is fine.

Files 5, 7, 8, 9 and 16 make the editor ask **"Potential issue detected: destructive operation"**. They only
replace an allowed-values rule (or a NOT NULL rule) with a wider one; no row is removed (standing permission,
written at the top of each file). Press **Run this query**.

**Check after each group.** The SQL Editor shows only the *last* result of a file with several queries, so run
the check files from PowerShell instead (read-only; it prints every row):

```powershell
powershell -File supabase/prod-readonly.ps1 -Check docs/tasks/21-purchases-verify.sql
```

**OK looks like:** every check line ends in `|t`, and the last line says `result: N true, 0 false`. Lines
without `|t` / `|f` are counts for reading. Any `|f`: stop and send the output to Claude.

| # | File (in `supabase/migrations/`) | Editor asks to confirm | Then check |
|---|---|---|---|
| 1 | `20261120100000_purchases.sql` | | |
| 2 | `20261120110000_payment_attempts.sql` | | `21-purchases-verify.sql`, `21b-payment-attempts-verify.sql` |
| 3 | `20261120120000_calls.sql` | | — (paste 4 straight away) |
| 4 | `20261120130000_calls_go_live.sql` — **this moment becomes go-live** | | |
| 5 | `20261121000000_calls_cleanup.sql` | yes | `23-calls-go-live-verify.sql` |
| 6 | `20261121000001_counsellor_availability.sql` | | `24-availability-verify.sql` |
| 7 | `20261121100000_presentation_booking.sql` | yes | — (check 25 runs after file 14: it uses `before_system()`) |
| 8 | `20261121200000_presentation_done.sql` | yes | `26-presentation-done-verify.sql` |
| 9 | `20261121300000_packages.sql` | yes | `27-packages-verify.sql` |
| 10 | `20261121400000_presentation_label_12h.sql` | | |
| 11 | `20261121400001_presentation_label_range.sql` | | `28-presentation-label-verify.sql` |
| 12 | `20261121500000_booking_three_working_days.sql` | | `29-booking-window-verify.sql` |
| 13 | `20261121600000_counsellor_clients.sql` | | `30-counsellor-clients-verify.sql` |
| 14 | `20261121700000_before_system.sql` | | `25-booking-verify.sql` |
| 15 | `20261121700001_before_system_planned.sql` | | |
| 16 | `20261121800000_admin_presentation_done.sql` | yes | |
| 17 | `20261121900000_old_purchases_bookable.sql` | | `31-before-system-verify.sql` (not earlier: one row tests file 17) |
| 18 | `20261122000000_payment_calls_go_live.sql` | | `33-payment-calls-go-live-verify.sql`, then `23-calls-go-live-verify.sql` again |

(The check files are in `docs/tasks/`; give the path as `docs/tasks/<name>`.)

**One expected false, until step 4:** `32-admin-presentation-verify.sql` run now shows exactly one false line,
"GO-LIVE STEP: every client with a paid assessment is assigned to an active counsellor". That is what step 4 does.

After each group, tick the file in `docs/deploy/production-log.md` (move it to "Already on production" with
the date), or tell Claude to do it.

---

## 4. The one-time go-live step (5 min)

SQL Editor → paste all of `supabase/go-live/assign-old-clients.sql` → Run. Paste it **once**.

**OK looks like:** one result row like
`{"coordinator": "<name>", "counsellor": "<name>", "phones": 1, "purchases": 0, "clients_to_counsellor": 18}`
(the rehearsal on 21 Nov gave exactly these numbers; a little more if clients registered since).

If it says **"Stopped, nothing was changed: this step needs exactly one active coordinator and one active
counsellor…"**: fix that on the Team page, then paste it again.

Then run every check once more; all must be true now, with no false line at all:

```powershell
foreach ($f in '21-purchases','21b-payment-attempts','23-calls-go-live','24-availability','25-booking','26-presentation-done','27-packages','28-presentation-label','29-booking-window','30-counsellor-clients','31-before-system','32-admin-presentation','33-payment-calls-go-live') {
  powershell -File supabase/prod-readonly.ps1 -Check "docs/tasks/$f-verify.sql" | Select-String 'checking|result:'
}
```

Rehearsal result on 21 Nov: 110 true, 0 false. Open calls right after go-live: 8 Booking, 1 Assessment and
1 Payment, all due 2 working hours after go-live, none late.

---

## 5. Repository public, push `main` (10 min)

Only after step 0 is settled.

1. Make the (clean) repository public: GitHub → the repository → Settings → General → Danger Zone → Change
   visibility → Public.
2. Push `main` (it holds every step, merged locally, with tests, lint and both builds passing):
   ```powershell
   git checkout main
   git status                      # nothing to commit; docs/n8n and supabase/staging/20261110_n8n_* stay untracked
   git ls-files | Select-String "\.env"   # only admin/.env.example and clients/.env.example
   git push origin main
   ```
3. Do not push the other local branches (`archive/fms-2026-11-20`, `task-12-*`, `task-13-*`, old step branches).

---

## 6. Vercel (15 min)

Both projects (`mfb-clients`, `mfb-admin`): Settings → Git → connected to the (new) repository, Production
Branch `main`. Settings → General: Root Directory `clients` / `admin`, *Include files outside the Root
Directory* **on**, Install Command `cd .. && npm ci`, Node 22.x. Settings → Functions: region **Mumbai (bom1)**.

**Environment variables — Production** (names only; values as in `docs/deploy/vercel.md`):

| `mfb-clients` | `mfb-admin` |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| `NEXT_PUBLIC_CLIENTS_URL` = `https://www.myfitbrain.app` | `NEXT_PUBLIC_CLIENTS_URL` = `https://www.myfitbrain.app` |
| `NEXT_PUBLIC_ADMIN_URL` = `https://admin.myfitbrain.app` | `NEXT_PUBLIC_ADMIN_URL` = `https://admin.myfitbrain.app` |
| `RAZORPAY_KEY_ID` (live: `rzp_live_…`) | `GOOGLE_SERVICE_ACCOUNT_EMAIL` |
| `RAZORPAY_KEY_SECRET` | `GOOGLE_PRIVATE_KEY` |
| `RAZORPAY_WEBHOOK_SECRET` | `GOOGLE_DRIVE_FOLDER_ID` |
| | `GOOGLE_SHEETS_SYNC_TOKEN` (64 characters) |
| | `GEMINI_API_KEY` (optional: no key = no "Draft with AI") |
| | `GEMINI_MODEL` (optional) |

Check: the Supabase URL and keys are **production's** (`tmifixelvfdtutsakwor`), not staging's; Razorpay keys are
**live** keys; no secret starts with `NEXT_PUBLIC_`.

**Razorpay dashboard** (live mode): Webhooks → `https://www.myfitbrain.app/api/payments/webhook`, events
`payment.captured`, `order.paid`, `payment.failed`, secret = `RAZORPAY_WEBHOOK_SECRET`. The same URL serves the
package payments.

Then: the push of step 5 starts both production deploys (or Deployments → Redeploy). Wait until both are
**Ready**.

**First settings in the new admin** (super admin): Settings → the package: name, sessions, frequency, price
(seeded: "Counselling package", 8, "1 session every week", ₹35,000). Counsellor availability: the default is
seeded (Mon–Sat 9:00 am–6:00 pm, 30-minute slots, lunch 1:00–1:30 pm).

---

## 7. 5-minute live check

1. `https://www.myfitbrain.app/pay/IA` opens: price ₹3,500 next to ₹7,000 struck through. `/pricing` lists the
   two assessments and the Counselling package.
2. Client login with a real number: the code arrives by SMS; Home loads.
3. `https://admin.myfitbrain.app`: sign in as super admin. **My tasks** shows the calls from go-live (rehearsal:
   10), none marked "Late". **Purchases** opens; an old purchase shows "Before the system".
4. Open one old paid purchase with a completed assessment: the side panel shows **Book presentation** (main
   button) and **Mark report presentation done**. Do not press them now, unless that client is really booked.
5. Sign in as the counsellor (another browser): **Clients** lists the old clients with a paid assessment; one
   report opens and **Download PDF** works.
6. Sign in as the coordinator: My tasks and Purchases show the same calls; Payments opens.
7. Vercel → each project → Logs: no red errors in the last minutes.

Anything wrong: note what and where, take a screenshot, and go to "If something fails".

---

## If something fails

**A SQL file shows an error (step 3 or 4).** Nothing from that file was saved. Production still works with
the old code. Stop, do not paste further files, send the error to Claude. The files already pasted can stay:
they only add things.

**The new site misbehaves after deploy (step 6–7).** Vercel → the project → Deployments → the previous
production deployment → **⋯ → Instant Rollback** (both projects if needed). The old code on the new database is **not tested** (see the
golden rules): payments and client logins should keep working, counsellors see only their assigned clients. Then
tell Claude what happened.

**The database itself must go back to before go-live** (last resort; everything written after the backup —
payments, answers, logins — is lost, so first export what is needed):

1. **Fastest: Supabase's own backups.** Database → Backups → restore the backup from before step 3 (or, with
   point-in-time recovery, the minute before step 3). Supabase restores the whole project, auth included.
2. **From our own backup** (`D:\Tech\Meda\backups\prod-<date>-<time>\full.dump`): restore it into a **new**
   Supabase project (or a local Docker database to look at the data), never over the live database without a
   written plan. Ask Claude for that plan: the restore needs the Supabase roles and a matching database owner
   (both handled in the 21 Nov rehearsal, see `docs/deploy/production-log.md`). To check a backup can be read:
   ```powershell
   docker run --rm -v "D:\Tech\Meda\backups\prod-<date>-<time>:/backup:ro" --entrypoint pg_restore public.ecr.aws/supabase/postgres:17.11.0.011 -l /backup/full.dump | Select-String -Pattern "TABLE DATA" | Measure-Object
   ```
   (OK: a count around 55.)
