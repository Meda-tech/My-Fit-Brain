# MFB Assessments — Supabase Setup & Deployment Guide

How to connect, configure and host the **My Fit Brain — MFB Assessments** platform (`admin/` and
`clients/`) with Supabase and Vercel. Both apps share one Supabase project.

| App | Folder | Domain | Dev port |
|---|---|---|---|
| Client portal | `clients/` | `https://app.myfitbrain.app` | 3000 |
| Staff portal | `admin/` | `https://admin.myfitbrain.app` | 3001 |

---

## 1. Supabase project

1. Create a project on [Supabase](https://supabase.com/dashboard).
2. Note your **Project URL** and **API keys** from **Project Settings → API**:
   - `Project URL` (e.g. `https://xyzproject.supabase.co`)
   - `anon public key` (safe for browsers)
   - `service_role secret key` (privileged, server-side only — **never expose to the browser**)

---

## 2. Apply database migrations

Open the **SQL Editor** in the Supabase dashboard and run each file in `supabase/migrations/` once, in
file-name order. Never edit a migration that has already been applied; changes go in a new file.

- `20261013000000_phase1_init.sql` — Phase 1 schema:
  - `public.profiles`: staff identity, stable UUIDs, `role`, active flag, link to `auth.users(id)`.
  - `public.clients`: client records, normalised E.164 phone (`phone UNIQUE`), demographics, links to
    `auth.users(id)` and `public.profiles(id)`. Age must be 18–120.
  - Indexes, `is_active_staff()`, `is_super_admin()`, `get_current_staff_profile_id()`,
    `link_client_phone()`, and Row Level Security on both tables.
- `20261015000000_mfb_foundation.sql` — MFB foundation (Task 02):
  - Gender options: `Male`, `Female`, `Prefer not to say` (question I2). Old `Other` → `Prefer not to say`.
  - Relationship status (column `marital_status`): `Single`, `In a relationship`, `Engaged`, `Married`,
    `Separated`, `Divorced`, `Widowed` (question I3). Old `Other` → `Single`.
  - Staff roles: `super_admin`, `coordinator`, `counsellor`; adds `public.is_counsellor()`.
  - Runs in one transaction; row counts appear as NOTICEs. Checks to run afterwards:
    `docs/tasks/02-verify.sql`.

### Roles

| Role | Can do |
|---|---|
| `super_admin` | Everything; manages the team (coordinators and counsellors) |
| `coordinator` | Creates and views client records |
| `counsellor` | Same client screens as coordinators for now; counsellor-only data comes in later tasks |

All active staff pass `is_active_staff()`; only super admins pass `is_super_admin()`.

---

## 3. Create the first super admin

There is no bootstrap page or API. The owner creates the first super admin directly:

1. **Authentication → Users → Add user → Create new user**. Enter the super admin's email and a strong
   password, and tick **Auto Confirm User**.
2. Copy the new user's **User UID**.
3. In the **SQL Editor**, run (replace both placeholders):

```sql
INSERT INTO public.profiles (auth_user_id, email, full_name, role, is_active)
VALUES ('PASTE_USER_UID_HERE', 'super-admin@your-domain', 'Super Admin full name', 'super_admin', true)
ON CONFLICT (email) DO UPDATE
SET role = 'super_admin', is_active = true, auth_user_id = EXCLUDED.auth_user_id;
```

The same template is in `supabase/seed.sql`. After that, the super admin adds coordinators and counsellors
from the **Team** page in the staff portal.

---

## 4. Supabase Auth configuration

### A. Email provider (staff, `admin/`)
- **Authentication → Providers → Email**: enabled.
- Team members are created by the super admin with `supabase.auth.admin.createUser({ email_confirm: true })`,
  so confirmation emails are not needed for staff sign-in.

### B. Phone provider and SMS (clients, `clients/`)
- **Authentication → Providers → Phone**: enabled.
- SMS is sent through a **Send SMS Hook** pointing at the SMS gateway.
- Keep message text discreet. It may only say "MFB Assessment", for example:
  ```text
  Your MFB Assessment verification code is {{ .Code }}. Valid for 10 minutes.
  ```
- Phone auth settings: OTP expiry `600` seconds; a 30–60 s resend cooldown per number.

### C. URL configuration
**Authentication → URL Configuration**:
- Site URL: `https://app.myfitbrain.app` (local: `http://localhost:3000`).
- Redirect URLs: `http://localhost:3000`, `http://localhost:3001`, `https://app.myfitbrain.app`,
  `https://admin.myfitbrain.app`.

---

## 5. Environment variables

Each app has a `.env.example`. Copy it to `.env.local` and fill it in. Never commit real keys.

### Staff portal (`admin/`)
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** service role key (team provisioning) |
| `NEXT_PUBLIC_CLIENTS_URL` | `https://app.myfitbrain.app` (local `http://localhost:3000`) |
| `NEXT_PUBLIC_ADMIN_URL` | `https://admin.myfitbrain.app` (local `http://localhost:3001`) |

### Client portal (`clients/`)
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** service role key (links staff-created records after OTP) |
| `NEXT_PUBLIC_CLIENTS_URL` | `https://app.myfitbrain.app` (local `http://localhost:3000`) |
| `NEXT_PUBLIC_ADMIN_URL` | `https://admin.myfitbrain.app` (local `http://localhost:3001`) |

The URL variables are read in each app's `lib/site.ts` and `next.config.ts`. If they are missing, the
local defaults are used.

---

## 6. Deploying to Vercel

The repository holds two Next.js apps, so create two Vercel projects.

### Staff portal — `admin.myfitbrain.app`
1. **Import Git Repository**, **Root Directory** `admin`.
2. Add the `admin/` variables from Section 5 (production values).
3. Add the custom domain `admin.myfitbrain.app`, then deploy.

### Client portal — `app.myfitbrain.app`
1. **Import Git Repository** again, **Root Directory** `clients`.
2. Add the `clients/` variables from Section 5 (production values).
3. Add the custom domain `app.myfitbrain.app`, then deploy.

---

## 7. Security practices in place
- **No key leakage:** `SUPABASE_SERVICE_ROLE_KEY` never has a `NEXT_PUBLIC_` prefix and is never sent to
  the browser.
- **Roles from the database:** staff roles (`super_admin`, `coordinator`, `counsellor`) are read from
  `public.profiles` by `auth.uid()`, never from client-submitted values or user metadata.
- **Row Level Security** on every table.
- **Phone privacy:** the client login checks whether a number exists without exposing names or other
  personal data to signed-out callers.
- **No raw database errors** are shown to clients; failures show a calm generic message.
