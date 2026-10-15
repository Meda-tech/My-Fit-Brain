# Task 02 — Foundation fixes (data model, registration, roles, config)

Prerequisite: Task 01 (UI rebrand) is merged. Work autonomously. Stop and ask only where a step says
**STOP**, or if something would break auth, delete real data, or fail the build.

## Out of scope — do not touch, do not report on

- **Renflair SMS hook and its API key.** The key is intentionally inside the SQL during the testing phase.
  The owner removes it before pushing to GitHub. Do not edit `20261013000001_renflair_sms_hook.sql`,
  do not move the key to Vault, do not flag it in summaries or audits.
- Assessment engine, question-bank import, payments, reports (later tasks).
- `.env` / `.env.local` files themselves (only `.env.example` may change).

## Goal

Make the client and staff data match the MFB Assessments spec so the assessment flow can be built on it:
gender and relationship options match I2/I3, under-18 users are stopped cleanly, a `counsellor` role
exists, and nothing is hard-wired to the old drnehamehta brand or domain.

## Step 0 — Prepare

1. Read `CLAUDE.md`.
2. `git checkout -b task-02-foundation` (commit or stash anything pending first).
3. Read both existing migrations, `supabase/config.toml` (if present), the registration flow in
   `clients/`, the client forms and pages in `admin/`, `admin/lib/auth.ts`, and every TypeScript type,
   zod/validation schema and constant that lists genders, marital statuses or roles.
4. Read the Intimacy question bank (`docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v1_1_1.xlsx`):
   the I1, I2 and I3 rows on the Questions tab (English and Hindi option text) and the AGE_STOP row on the
   Flags & Safety tab. These are the only allowed source for option labels and AGE_STOP copy.
   Read the file with a script (e.g. `npx xlsx-cli` or a small Node script using the `xlsx` package
   installed as a dev dependency at the repo root); do not guess the text.
5. Write findings to `docs/tasks/02-findings.md`: every file that defines or uses gender, marital status
   or role values; every hard-coded domain or email; the exact I2/I3/AGE_STOP texts (EN + HI).

## Step 1 — Migration

Create `supabase/migrations/20261015000000_mfb_foundation.sql` (one transaction):

1. **Gender**
   - Map existing rows: `'Other'` → `'Prefer not to say'`.
   - Replace the `clients.gender` CHECK with `('Male', 'Female', 'Prefer not to say')`.
2. **Relationship status** (keep the column name `marital_status` to avoid churn)
   - New allowed values, in this order: `'Single', 'In a relationship', 'Engaged', 'Married',
     'Separated', 'Divorced', 'Widowed'`.
   - Map existing rows: Single, Married, Separated, Divorced, Widowed keep their value;
     `'Other'` → `'Single'` (testing data only). Before mapping, `RAISE NOTICE` the count of rows changed.
   - Replace the CHECK. Add `COMMENT ON COLUMN public.clients.marital_status IS 'Relationship status — matches question I3'`.
3. **Roles**
   - Replace the `profiles.role` CHECK with `('super_admin', 'coordinator', 'counsellor')`.
   - Counsellors are active staff, so `is_active_staff()` already covers them. Do not change existing
     RLS policies. Add `public.is_counsellor()` (STABLE SECURITY DEFINER, same pattern as
     `is_super_admin()`) for later tasks; grant execute to `authenticated` only.
4. Use the exact CHECK constraint names from the Phase 1 migration (look them up) when dropping and
   re-adding. Make the migration safe to run once on a database that already has Phase 1 applied.
5. Add a matching down/rollback note as a SQL comment at the top (what to run to revert), but no
   automatic down migration.

**Apply it:**
- If a local Supabase stack is running (`supabase status`), apply with `supabase migration up`.
  Never run `supabase db reset`.
- If the project is linked to a remote Supabase project, run `supabase db push --dry-run` and show the
  output. **STOP** and ask before the real push.
- If the CLI is not set up, say so and give the one command to run; continue with the code changes.
- Regenerate Supabase TypeScript types if the project already uses generated types
  (`supabase gen types typescript ...`) and update the import paths that use them.

## Step 2 — Shared option lists (single source per app)

In EACH app create `lib/options.ts`:

```ts
export const GENDERS = ['Male', 'Female', 'Prefer not to say'] as const;
export type Gender = (typeof GENDERS)[number];

export const RELATIONSHIP_STATUSES = [
  'Single', 'In a relationship', 'Engaged', 'Married', 'Separated', 'Divorced', 'Widowed',
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const STAFF_ROLES = ['super_admin', 'coordinator', 'counsellor'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const MIN_AGE = 18;
```

- Replace every other hard-coded list of these values (forms, validation, types, filters, badges) with
  imports from this file. The stored values stay the English strings above.
- Display labels come from i18n. In `clients/` add EN and HI labels for every gender and relationship
  option, using the Hindi option text from the I2/I3 rows found in Step 0. Admin is English-only unless it
  already has i18n.

## Step 3 — Client registration (`clients/`)

1. Gender and relationship status use the new option lists and labels. Gender order:
   Male, Female, Prefer not to say. Relationship order as listed above.
2. Validation (server action is the authority, client-side mirrors it):
   name required; gender and relationship must be in the lists; age is a whole number 1–120;
   email optional but valid if given; city/state optional. Reject anything else with a calm field message.
3. **Under 18:**
   - If the entered age is below 18, do NOT call the insert. Show a full-screen AGE_STOP view using the
     AGE_STOP text from the question bank (EN + HI, follows the language toggle).
   - Create no `clients` row and write no other data. Sign the user out server-side after the screen is
     shown (a single "Close" button that calls the existing signout route).
   - The server action must also refuse ages below 18 independently of the UI, and must never surface a
     raw database error.
   - Style: calm, centred card, no red, no warning icon, no countdown.
4. Add a calm generic error state for any unexpected insert failure ("Something went wrong. Please try
   again.") — never show Postgres messages.
5. Existing clients whose stored values changed in the migration must still load on the home screen.

## Step 4 — Admin client forms (`admin/`)

1. `/clients/new` and any edit form: same option lists, same validation, same under-18 refusal
   (staff see a plain message: "Clients must be 18 or older.").
2. Client list, filters and detail page: display the new values correctly; remove any filter or badge for
   `'Other'`.

## Step 5 — Counsellor role in admin

Minimal, so later tasks can build on it:

1. Update role types to `StaffRole`. In `admin/lib/auth.ts` change ONLY the role type/union if it is
   declared there — no logic changes. `requireStaff()` must accept counsellors; `requireSuperAdmin()`
   unchanged.
2. Rename the staff management page heading from "Coordinators" to "Team" (keep the route
   `/coordinators` to avoid breaking links). The super admin can provision a staff member as
   Coordinator or Counsellor (role select), and the list shows a role badge (mist bg, teal text).
   Activate/deactivate and password reset work for both roles.
3. Dashboard "Active Coordinators" card becomes "Active team" with a coordinator/counsellor split.
4. Counsellors see the same client screens as coordinators for now.

## Step 6 — Config and domain (no hard-wiring)

1. Bootstrap super admin: remove the hard-coded `superadmin@drnehamehta.com`. Read the email from
   `BOOTSTRAP_SUPER_ADMIN_EMAIL`. If it is missing, the bootstrap page shows "Bootstrap is not
   configured" and does nothing. Do not change the existing super admin row in the database.
2. Create `lib/site.ts` in each app exporting the app's own URL and the other app's URL from env:
   `NEXT_PUBLIC_CLIENTS_URL`, `NEXT_PUBLIC_ADMIN_URL`. Replace every hard-coded origin or
   `drnehamehta.com` reference in code with these.
3. Update (or create) `.env.example` in each app with every variable the app reads, with comments and
   these values:
   - local: `http://localhost:3000` (clients), `http://localhost:3001` (admin)
   - production (commented): `https://app.myfitbrain.app`, `https://admin.myfitbrain.app`
   - `BOOTSTRAP_SUPER_ADMIN_EMAIL=` (blank, with a comment)
   Never write real keys into `.env.example`.
4. If `supabase/config.toml` exists, set `[auth] additional_redirect_urls` to include both localhost
   origins and both myfitbrain.app origins. Leave `site_url` as the local clients URL.
5. Update README.md and SUPABASE_SETUP_GUIDE.md: domains, env variable names, bootstrap steps, role list.
   Remove drnehamehta references (keep "Founded by Dr. Neha Mehta" endorsement wording only where it
   describes the brand).

## Step 7 — Verify

1. `npm run lint` and `npm run build` pass in `clients/` and `admin/`.
2. Grep both apps (excluding node_modules/.next/docs): zero hits for `'Other'` as a gender or status
   value, `drnehamehta`, `superadmin@drnehamehta.com`, or hard-coded `localhost:300` outside `.env.example`
   and `lib/site.ts` defaults.
3. If the migration was applied locally, run and show:
   ```sql
   select gender, count(*) from public.clients group by 1;
   select marital_status, count(*) from public.clients group by 1;
   select role, count(*) from public.profiles group by 1;
   ```
   and confirm an insert with gender `'Other'` and one with age 17 are both rejected.
4. Start both dev servers briefly; confirm `/login` and `/register` (clients) and `/login` (admin)
   return 200. Stop the servers.

## Step 8 — Finish

1. Update `CLAUDE.md`:
   - Status: Task 02 done.
   - Under "Data and privacy", add: "Testing phase only: the Renflair API key sits in
     `20261013000001_renflair_sms_hook.sql`. The owner removes it before any push. Do not modify or flag it."
   - Update the "Next" line to: Task 03 — question bank as data (shared `packages/`, tables, Excel importer).
2. Commit in chunks: `feat(db): MFB foundation migration`, `refactor: shared option lists`,
   `feat(clients): registration options and AGE_STOP`, `feat(admin): counsellor role and team page`,
   `chore: env-driven URLs and bootstrap email`, `docs: update README, setup guide, CLAUDE.md`.
3. Print a short summary: what changed per app, migration status (applied locally / dry-run shown /
   not applied), rows remapped, verification results, and any env variables the owner must set.
