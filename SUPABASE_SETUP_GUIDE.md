# Dr Neha Mehta — Phase 1 Supabase Setup & Deployment Guide

This guide details the complete configuration required to connect, configure, and host the **Dr Neha Mehta Assessment System** (`/admin` and `/app`) with Supabase and Vercel.

---

## 1. Supabase Project Setup

1. Create a project on [Supabase](https://supabase.com/dashboard).
2. Note your **Project URL** and **API Keys** from **Project Settings → API**:
   - `Project URL` (e.g. `https://xyzproject.supabase.co`)
   - `anon public key` (Safe for browsers)
   - `service_role secret key` (Privileged server-side key, **never expose to client**)

---

## 2. Apply Database Migration

Open the **SQL Editor** in your Supabase Dashboard and run the contents of:
`supabase/migrations/20261013000000_phase1_init.sql`

This migration creates:
- `public.profiles`: Internal staff identity with stable UUIDs, `role` check (`super_admin`, `coordinator`), active flag, and foreign key to `auth.users(id)`.
- `public.clients`: Client records with stable UUIDs, normalized E.164 phone numbers (`phone UNIQUE`), demographics, and foreign key to `auth.users(id)` and `public.profiles(id)`.
- Foreign key and query performance indexes (following Supabase Postgres Best Practices).
- Security functions with fixed search paths: `public.is_active_staff()`, `public.is_super_admin()`, and `public.link_client_phone()`.
- Row Level Security (RLS) on all exposed tables:
  - Super Admins can manage coordinators and view all clients.
  - Active Coordinators can create and view all clients (cannot manage coordinators).
  - Verified Clients can access only their own linked records.

---

## 3. Bootstrap the Initial Super Admin

You have two simple options to create the first Super Admin:

### Option A: Supabase Dashboard + SQL (Recommended)
1. Go to **Authentication → Users → Add User → Create User**.
2. Enter:
   - Email: `superadmin@drnehamehta.com`
   - Password: `<your-secure-password>`
   - Auto Confirm User: Checked
3. Copy the generated **User UID** (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`).
4. In the **SQL Editor**, run:
```sql
INSERT INTO public.profiles (
  auth_user_id,
  email,
  full_name,
  role,
  is_active
) VALUES (
  'PASTE_USER_UID_HERE',
  'superadmin@drnehamehta.com',
  'Dr Neha Mehta (Super Admin)',
  'super_admin',
  true
);
```

### Option B: Bootstrap Endpoint
Send a POST request to `http://localhost:3000/api/bootstrap-admin` (or your deployed admin domain):
```json
{
  "email": "superadmin@drnehamehta.com",
  "password": "YourSecurePassword123!",
  "fullName": "Dr Neha Mehta",
  "secretKey": "<last-16-chars-of-SUPABASE_SERVICE_ROLE_KEY>"
}
```

---

## 4. Supabase Auth Configuration

### A. Email Provider (for Staff in `/admin`)
- Go to **Authentication → Providers → Email**.
- Ensure Email provider is enabled.
- For internal staff, coordinators are created programmatically by the Super Admin using `supabase.auth.admin.createUser({ email_confirm: true })`, so confirmation emails are not required for staff login.

### B. Phone Provider & SMS Integration (for Clients in `/app`)
- Go to **Authentication → Providers → Phone**.
- Enable **Phone** provider.
- Configure SMS provider:
  - Supported native providers: Twilio, MessageBird, Vonage, Textlocal, etc.
  - Or use a **Custom SMS Hook / Send SMS Hook** (Webhook pointing to your SMS gateway).
- Under **SMS Template**, configure your OTP message:
  ```text
  Your Dr Neha Mehta verification code is {{ .Code }}. Valid for 10 minutes.
  ```
- **Phone Auth Settings**:
  - OTP expiry: `600` seconds (10 minutes).
  - Rate limiting: Set appropriate cooldown per phone number (e.g., 30–60s).

---

## 5. Environment Variables Configuration

Both applications have `.env.example` templates ready.

### Internal Admin Portal (`/admin`)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** Service Role Key (Used server-side for coordinator provisioning) |
| `NEXT_PUBLIC_SITE_URL` | `https://admin.drnehamehta.com` |
| `NEXT_PUBLIC_CLIENT_PORTAL_URL` | `https://app.drnehamehta.com` |

### Client-Facing Application (`/app`)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** Service Role Key (Server-side linking and record verification) |
| `NEXT_PUBLIC_SITE_URL` | `https://app.drnehamehta.com` |
| `NEXT_PUBLIC_ADMIN_PORTAL_URL` | `https://admin.drnehamehta.com` |

---

## 6. Deploying to Vercel

Since the repository contains two separate Next.js applications (`/admin` and `/app`), create two distinct Vercel projects:

### Project 1: Staff Admin (`admin.drnehamehta.com`)
1. In Vercel, select **Import Git Repository**.
2. Set **Root Directory** to `admin`.
3. Add the environment variables listed in Section 5 for Admin.
4. Add custom domain: `admin.drnehamehta.com`.
5. Deploy.

### Project 2: Client App (`app.drnehamehta.com`)
1. In Vercel, select **Import Git Repository** again.
2. Set **Root Directory** to `app`.
3. Add the environment variables listed in Section 5 for Client App.
4. Add custom domain: `app.drnehamehta.com`.
5. Deploy.

---

## 7. Security Best Practices Enforced
- **Zero Client Key Leakage:** `SUPABASE_SERVICE_ROLE_KEY` is never prefixed with `NEXT_PUBLIC_` and never included in browser client bundles.
- **Role Authorization via Database:** Staff role (`super_admin`, `coordinator`) is validated directly against PostgreSQL `profiles` and cached server sessions rather than trusting client-submitted values or user metadata claims.
- **Row Level Security (RLS):** All database reads and writes are guarded by database-level policies.
- **Phone Privacy:** The client login checks phone existence without exposing client names or personal data to unauthenticated callers.
