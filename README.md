# Dr Neha Mehta — Relationship & Intimacy Assessment Platform

> “Science with a human touch.”

This repository houses the two dedicated Next.js web applications for Dr Neha Mehta's assessment system, built according to `DR_NEHA_MEHTA_ANTIGRAVITY_DESIGN_SYSTEM.md`, `tokens.css`, and Supabase best practices.

## Applications

1. **Internal Staff Portal (`/admin`)**
   - **Domain:** `admin.drnehamehta.com`
   - **Features:**
     - Super Admin email/password authentication
     - Coordinator email/password authentication
     - Super Admin creation and management of coordinator accounts
     - Client record creation by both Super Admin and coordinators
     - Searchable client directory and detailed client inspection
     - Role-based server-side authorization boundaries
2. **Client-Facing Application (`/app`)**
   - **Domain:** `app.drnehamehta.com`
   - **Features:**
     - Mobile phone number OTP login (Supabase Auth SMS)
     - Bilingual English & Hindi (`EN | हिं`) support conforming to design tokens
     - Normalization to E.164 (`+91XXXXXXXXXX`)
     - Privacy-preserving check for pre-created client records
     - Secure registration flow for new numbers (collecting Full Name, Gender, Age, Marital Status, Location, Email)
     - Automatic secure linkage between staff pre-created records and verified phone identities
     - Minimal authenticated placeholder homepage for Phase 1

---

## Local Development

### 1. Configure Environment Variables
Copy `.env.example` to `.env.local` in both folders and fill in your Supabase credentials:

```bash
# In /admin
cd admin
cp .env.example .env.local

# In /app
cd ../app
cp .env.example .env.local
```

### 2. Running the Admin Portal
```bash
cd admin
npm run dev
# Running on http://localhost:3000
```

### 3. Running the Client Application
```bash
cd app
npm run dev -- -p 3001
# Running on http://localhost:3001
```

---

## Database & Security

- Database migration: `supabase/migrations/20261013000000_phase1_init.sql`
- Seed & bootstrap template: `supabase/seed.sql`
- Setup & Vercel deployment documentation: `SUPABASE_SETUP_GUIDE.md`
