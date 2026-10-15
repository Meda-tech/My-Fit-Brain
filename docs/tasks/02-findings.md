# Task 02 — Findings (Step 0)

Date: 2026-10-15 · Branch: `task-02-foundation` (root, `admin/`, `clients/`)

`admin/` and `clients/` are separate git repos inside the root repo (gitlinks, no `.gitmodules`).
Each gets its own `task-02-foundation` branch and commits.

## 1. Source texts (question bank)

Actual file names use dots: `docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v1.1_1.xlsx` and
`MFB_Mind_Assessment_QuestionBank_v1.0_1.xlsx` (CLAUDE.md lists them with underscores). Read with the
`xlsx` package (root dev dependency).

### I1 (Questions tab)
- EN: "Your age" · HI: "आपकी उम्र"
- Options: `Under 18 / 18–24 / 25–34 / 35–44 / 45–54 / 55+ || 18 से कम / 18–24 / 25–34 / 35–44 / 45–54 / 55+`
- Note: "Under 18 = AGE_STOP screen (see Flags & Safety). Stop the assessment, save nothing. Store exact age band for report."

### I2 (Questions tab)
- EN: "You are" · HI: "आप हैं"

| Stored value | EN | HI |
|---|---|---|
| Male | Male | पुरुष |
| Female | Female | महिला |
| Prefer not to say | Prefer not to say | बताना नहीं चाहते |

Routing note: Male → module C · Female → module D · Prefer not to say → both C and D offered in G1.

### I3 (Questions tab)
- EN: "Your relationship status" · HI: "आपका रिश्ते का स्टेटस"

| Stored value | EN | HI |
|---|---|---|
| Single | Single | अकेले |
| In a relationship | In a relationship | रिश्ते में |
| Engaged | Engaged | सगाई हो चुकी |
| Married | Married | विवाहित |
| Separated | Separated | अलग रह रहे |
| Divorced | Divorced | तलाकशुदा |
| Widowed | Widowed | विधवा/विधुर |

### AGE_STOP (Flags & Safety tab)
- Trigger: I1 = Under 18 · Effect: Stop the assessment. Save nothing. No report.
- EN: "This assessment is for adults aged 18 and above. If you are under 18 and need support, please talk to a parent, a teacher or a school counsellor. You can also call Tele-MANAS (free, 24x7): 14416."
- HI: "यह असेसमेंट 18 साल और उससे ज़्यादा उम्र के लोगों के लिए है। अगर आप 18 से कम हैं और आपको सहारे की ज़रूरत है, तो कृपया अपने माता-पिता, किसी शिक्षक या स्कूल काउंसलर से बात करें। आप Tele-MANAS (मुफ्त, 24x7) पर भी कॉल कर सकते हैं: 14416।"

### Mind bank cross-check
- MI2 options and AGE_STOP texts are identical to I2 / Intimacy AGE_STOP.
- MI3 is occupation ("What best describes you right now?"), not relationship status. Relationship status
  maps to I3 only.

## 2. Gender / marital status / role values — where defined or used

### Database
- `supabase/migrations/20261013000000_phase1_init.sql`
  - `profiles.role text NOT NULL CHECK (role IN ('super_admin', 'coordinator'))` — inline, so Postgres
    auto-names it `profiles_role_check`.
  - `clients.gender ... CHECK (gender IN ('Female', 'Male', 'Other'))` → `clients_gender_check`.
  - `clients.marital_status ... CHECK (... 'Other')` → `clients_marital_status_check`.
  - `clients.age CHECK (age >= 18 AND age <= 120)` → `clients_age_check` (already blocks under 18).
  - `is_super_admin()`: `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`.
  - `is_active_staff()` checks `is_active` only (not role), so counsellors are covered.
- `supabase/seed.sql`: `'super_admin'`, `superadmin@drnehamehta.com`.

### admin/
| File | What |
|---|---|
| `lib/types.ts` | `StaffRole`, `Gender` (with Other), `MaritalStatus` (with Other) |
| `lib/auth.ts` | `isSuperAdmin`, `isCoordinator` from `profile.role` (types come from `lib/types.ts`) |
| `lib/services/clients.ts` | hard-coded `validGenders`, `validStatuses`, age 18–120, raw DB error returned |
| `lib/services/coordinators.ts` | lists/creates/toggles/resets only `role = 'coordinator'` |
| `app/clients/actions.ts` | casts and defaults `'Female'` / `'Single'` |
| `app/clients/new/CreateClientForm.tsx` | hard-coded gender + marital `<option>`s incl. Other; `min={18}` |
| `app/clients/page.tsx`, `app/clients/[id]/page.tsx`, `app/dashboard/page.tsx` | display `gender` / `marital_status` raw; no filters or badges for Other |
| `app/coordinators/*` | "Coordinators" heading, coordinator-only copy |
| `components/AdminShellClient.tsx` | `roleLabel` super admin vs Coordinator; nav label "Coordinators" |
| `app/dashboard/page.tsx` | "Active coordinators" card; non-admin "Active coordinator" |

No edit form exists for clients in admin (create only).

### clients/
| File | What |
|---|---|
| `lib/types.ts` | `Gender`, `MaritalStatus` with Other |
| `lib/services/client-auth.ts` | `completeRegistration`: hard-coded lists, age 18–120 check, returns raw DB errors (`updateErr.message`, `insertError.message`) |
| `app/register/RegisterForm.tsx` | hard-coded options incl. Other; under-18 shows a plain error, no AGE_STOP |
| `app/ClientHomeView.tsx` | label maps incl. Other |
| `lib/i18n.ts` | `genderOther`, `other`, marital labels; HI `single: 'अविवाहित'` (bank says `अकेले`) |

No zod or other validation library is used; validation is hand-written in the services.

## 3. Hard-coded domains, origins and emails

| File | Hit |
|---|---|
| `supabase/seed.sql` | `superadmin@drnehamehta.com` (×2), header "Dr Neha Mehta" |
| `SUPABASE_SETUP_GUIDE.md` | `superadmin@drnehamehta.com`, `/api/bootstrap-admin`, `*.drnehamehta.com` domains, old env names |
| `README.md` | ports (`localhost:3000/3001`) |
| `admin/.env.example` | `admin.drnehamehta.com`; `NEXT_PUBLIC_SITE_URL=:3000` / `NEXT_PUBLIC_CLIENT_PORTAL_URL=:3001` (ports swapped vs `package.json`) |
| `clients/.env.example` | `app.drnehamehta.com`; `NEXT_PUBLIC_SITE_URL=:3001` / `NEXT_PUBLIC_ADMIN_PORTAL_URL=:3000` (swapped) |
| `admin/next.config.ts`, `clients/next.config.ts` | `serverActions.allowedOrigins` hard-codes `localhost:3000/3001` plus LAN IP `192.168.29.64` |
| `admin/README.md`, `clients/README.md` | create-next-app boilerplate (`localhost:3000`, Geist) |

No app code reads `NEXT_PUBLIC_SITE_URL` / `*_PORTAL_URL` today. Env vars actually read:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Bootstrap super admin

The bootstrap page and `/api/bootstrap-admin` were deliberately removed in `admin` commit `b4e5aef`
("First super admin is set up by the owner directly, so the public setup UI and /api/bootstrap-admin
(which exposed the super admin email) are removed"). There is no hard-coded super admin email left in
app code. Step 6.1 is therefore met by removal: the endpoint is NOT recreated (it would reopen what
`b4e5aef` closed) and `BOOTSTRAP_SUPER_ADMIN_EMAIL` is not added, since nothing reads it. The seed and
setup guide are updated to use a placeholder email and the SQL-only setup.

## 5. Tooling

- Supabase CLI: not installed (no global binary, not in either app's `node_modules`).
- No `supabase/config.toml`; project not linked locally. Remote URL is set in each app's `.env.local`.
- No generated Supabase types.
- PostgreSQL 18 client tools are installed (`psql`), usable for a scratch test of the migration.
