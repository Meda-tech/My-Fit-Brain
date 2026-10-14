# My Fit Brain — MFB Assessments

> Space to speak.

My Fit Brain (MFB) is a unit of MeDa Partners Pvt Ltd. This repository holds the two Next.js apps for the
MFB Assessments platform. The assessments are designed by Dr. Neha Mehta.

Project rules, brand, copy and safety requirements live in [`CLAUDE.md`](./CLAUDE.md). Brand master files
live in [`brand/`](./brand).

## Applications

1. **Staff portal (`/admin`)** — dev port 3001
   - Super Admin and coordinator email/password sign-in
   - Super Admin creation and management of coordinator accounts
   - Client record creation by Super Admin and coordinators
   - Searchable client directory and client detail
   - Role-based server-side authorisation
2. **Client app (`/clients`)** — dev port 3000
   - Mobile phone OTP sign-in (Supabase Auth SMS)
   - English and Hindi (`EN | हिं`)
   - Normalisation to E.164 (`+91XXXXXXXXXX`)
   - Privacy-preserving check for pre-created client records
   - Registration for new numbers, and automatic linking to staff-created records
   - Authenticated home screen for Phase 1

Domains are listed in `CLAUDE.md` ("Apps and domains").

---

## Local development

### 1. Configure environment variables
Copy `.env.example` to `.env.local` in both folders and fill in your Supabase credentials:

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

- Database migrations: `supabase/migrations/`
- Seed and bootstrap template: `supabase/seed.sql`
- Setup and Vercel deployment: `SUPABASE_SETUP_GUIDE.md`
