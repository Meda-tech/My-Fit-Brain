# My Fit Brain — MFB Assessments

> Space to speak.

My Fit Brain (MFB) is a unit of MeDa Partners Pvt Ltd. This repository holds the two Next.js apps for the
MFB Assessments platform. The assessments are designed by Dr. Neha Mehta.

Project rules, brand, copy and safety requirements live in [`CLAUDE.md`](./CLAUDE.md). Brand master files
live in [`brand/`](./brand).

## Applications

1. **Staff portal (`admin/`)** — `https://admin.myfitbrain.app`, dev port 3001
   - Email/password sign-in for staff: `super_admin`, `coordinator`, `counsellor`
   - Team page: the super admin adds coordinators and counsellors, activates/deactivates them and resets passwords
   - Client record creation by all active staff (clients must be 18 or older)
   - Searchable client directory and client detail
   - Role-based server-side authorisation
2. **Client app (`clients/`)** — `https://app.myfitbrain.app`, dev port 3000
   - Mobile phone OTP sign-in (Supabase Auth SMS)
   - English and Hindi (`EN | हिं`)
   - Normalisation to E.164 (`+91XXXXXXXXXX`)
   - Privacy-preserving check for pre-created client records
   - Registration for new numbers (gender and relationship options from the question bank;
     under 18 shows the AGE_STOP screen and saves nothing), and automatic linking to staff-created records
   - Authenticated home screen for Phase 1

Domains are listed in `CLAUDE.md` ("Apps and domains").

---

## Local development

### 1. Configure environment variables
Copy `.env.example` to `.env.local` in both folders and fill in your Supabase credentials. Both apps read
`NEXT_PUBLIC_CLIENTS_URL` and `NEXT_PUBLIC_ADMIN_URL` (local defaults `http://localhost:3000` and
`http://localhost:3001`; production `https://app.myfitbrain.app` and `https://admin.myfitbrain.app`):

```bash
cd admin
cp .env.example .env.local

cd ../clients
cp .env.example .env.local
```

### 2. Run the staff portal
```bash
cd admin
npm run dev
# http://localhost:3001
```

### 3. Run the client app
```bash
cd clients
npm run dev
# http://localhost:3000
```

---

## Database and security

- Database migrations: `supabase/migrations/` (run in the Supabase SQL Editor, in file-name order)
- First super admin: created by the owner in Supabase; template in `supabase/seed.sql`
- Setup, env variables, roles and Vercel deployment: `SUPABASE_SETUP_GUIDE.md`
- Option lists (gender, relationship status, staff roles): `lib/options.ts` in each app
