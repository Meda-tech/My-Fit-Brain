# My Fit Brain Assessments — project rules for Claude Code

My Fit Brain (MFB) is a unit of MeDa Partners Pvt Ltd. This repo is the MFB Assessments platform.
It replaces the earlier "Dr Neha Mehta Relationship & Intimacy Assessment Platform". That brand, its
design system (plum / magenta / gold, Playfair Display, Inter) and its copy are retired.
Dr. Neha Mehta now appears ONLY as an endorsement line.

This file is the single rulebook. `.agents/` and any other agent context must point here, not repeat or
contradict it. Task briefs live in `docs/tasks/` and are executed one at a time.

---

## Repository layout

```
nehamehta/
├─ CLAUDE.md                  this file
├─ README.md · SUPABASE_SETUP_GUIDE.md · skills-lock.json
├─ package.json               npm workspaces root: clients, admin, packages/* (ONE lockfile, here)
├─ .agents/                   points to CLAUDE.md only
├─ admin/                     Next.js app — staff portal
├─ clients/                   Next.js app — client portal
├─ packages/
│  ├─ questionbank/           @mfb/questionbank — types, condition schema, Excel parser, seed rules,
│  │                          version patches, loader, qb:import / qb:patch CLIs (TS source; Vitest)
│  └─ engine/                 @mfb/engine — pure, config-driven assessment engine (flow, scoring, flags,
│                             report keys, test-case runner); server helpers in @mfb/engine/server
├─ brand/                     MFB Brand Kit v1 — MASTER files, never served directly
│  ├─ 01_Logo/
│  │  ├─ SVG/                 web use (first choice)
│  │  ├─ PNG/                 raster fallback, email, social
│  │  └─ PDF/                 print and report PDFs
│  ├─ fonts/                  Poppins (Regular/Medium/SemiBold/Bold), DM Sans (Regular/Medium/Bold) TTF
│  ├─ favicon.ico · favicon-64.png · apple-touch-icon-180.png
│  │  android-chrome-192.png · android-chrome-512.png · app-icon-1024.png
│  ├─ mfb-tokens.css · mfb-tokens.json · tailwind.mfb.js · MFB_Palette_Codes.txt
│  ├─ MFB_Brand_Guidelines_v1.pdf · MFB_Palette_Sheet.png
│  └─ MFB_Assessment_Report_Template_A4.pdf
├─ docs/
│  ├─ spec/                   MFB Assessments Developer Spec v1.1 (.docx)
│  ├─ questionbank/
│  │  ├─ MFB_Intimacy_Assessment_QuestionBank_v1.1_1.xlsx
│  │  └─ MFB_Mind_Assessment_QuestionBank_v1.0_1.xlsx
│  │  └─ rules-reference.md   condition format and rule tables (read before touching rules)
│  ├─ deploy/vercel.md        two Vercel projects from the single repository
│  ├─ engine/README.md        engine inputs, outputs, flow order, rules, test cases, ENGINE_VERSION
│  ├─ tasks/                  task briefs, findings, mappings and verify SQL per task
│  └─ rebrand-audit.md        produced by task 01
└─ supabase/                  shared migrations, seed/question-bank/ load SQL (testing)
```

### Brand files inside the apps

Next.js serves only each app's own `public/`. Each app keeps COPIES of what it needs:

| Copy in each app | From master |
|---|---|
| `<app>/public/brand/logo/*.svg` | `brand/01_Logo/SVG/` (only the files the app uses) |
| `<app>/public/` favicon.ico, apple-touch-icon-180.png, android-chrome-*.png | `brand/` |
| `<app>/app/fonts/*.ttf` (or `src/app/fonts/`) | `brand/fonts/` |
| `<app>/styles/mfb-tokens.css` | `brand/mfb-tokens.css` |

Never edit a copy so it differs from the master. If a master changes, update both apps.
`brand/01_Logo/PDF/` is used by the report PDF generator (server-side), not copied into `public/`.

---

## Source of truth

| File | Wins on |
|---|---|
| `docs/spec/` Developer Spec v1.1 | Product, flow, safety, report layout |
| Question bank in the database (`qb_*`, live version) | Every item, routing rule, score rule and text, from IA 1.2 / MA 1.1 onward |
| `docs/questionbank/decisions.md` | Why IA 1.2 / MA 1.1 differ from the Excel files (owner decisions D1–D20) |
| `docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v1.1_1.xlsx` | Source of IA 1.1 only |
| `docs/questionbank/MFB_Mind_Assessment_QuestionBank_v1.0_1.xlsx` | Source of MA 1.0 only |
| `brand/MFB_Brand_Guidelines_v1.pdf` | Logo use, colour, type, voice, photography |
| `brand/MFB_Assessment_Report_Template_A4.pdf` | Report PDF layout |

The Excel files are the v1.1 / v1.0 source; the database is the source of truth from IA 1.2 / MA 1.1
onward, and every change since is recorded in `docs/questionbank/decisions.md` and made as a new version.
If the spec and the question bank differ, the question bank wins. Never invent questions, scoring rules or
report text. If something is not covered, stop and ask rather than guess.

---

## Apps and domains

| Folder | Purpose | Domain | Dev port |
|---|---|---|---|
| `clients/` | OTP login, registration, test choice, payment, assessment, report | `https://app.myfitbrain.app` | 3000 |
| `admin/` | Super admin, coordinators, counsellors | `https://admin.myfitbrain.app` | 3001 |

- The folder is `clients/`; the public subdomain stays `app.`.
- One Supabase project for both apps. No custom backend: logic runs in Next.js Server Actions / route
  handlers and Postgres functions (`pg_net`, `pg_cron`, triggers).
- Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript 5, Tailwind v4, Supabase
  (`@supabase/ssr`, `@supabase/supabase-js`), lucide-react.
- Tailwind v4: tokens are mapped with `@theme` in `globals.css`. `brand/tailwind.mfb.js` is reference only;
  never add a JS Tailwind config.

---

## Products

- **MFB Intimacy Assessment** — ID `MFB-IA-YYYY-NNNNN`
- **MFB Mind Assessment** — ID `MFB-MA-YYYY-NNNNN`
- Progress re-tests append `-P1`, `-P2`, `-P3`. PDF file name = ID only.
- Each costs ₹3,500 and includes the assessment and one consultation. The report is for the care team
  only (D22). No price anywhere except the payment step. Progress re-tests are included, never charged.
- Display line under each name: "Designed by Dr. Neha Mehta".
- One person per assessment. A partner takes and pays for their own; reports are never linked.
- One engine, two configurations. Question banks are versioned DB config imported from the Excel
  files. Never hard-code questions or texts. A future test must need only a new Excel file plus its
  routing rules.

## Question bank

- Every question, option, report sentence and scoring / routing / flag rule lives in `qb_*` tables as
  versioned data, managed from the admin app (Question bank). No question ID, score, threshold or report
  text in app code.
- Versions: `draft` → `in_review` → `live` → `retired`. One live and at most one open (draft or in review)
  version per test. Assessments pin the version id they used.
- Freeze rule: live and retired versions never change — a trigger rejects every write, including the
  service role. To change anything, start a new version (copy) or import a workbook as a new draft.
- Status changes only through `qb_start_new_version`, `qb_import_version`, `qb_submit_for_review`,
  `qb_return_to_draft`, `qb_publish` (needs a change note), `qb_delete_draft`. Submit and publish require
  `qb_validate_version` to return no errors. Rights: `profiles.can_edit_content` / `can_approve_content`.
- Rules are data: seed files `packages/questionbank/seeds/<TEST>-<VERSION>.rules.json` converted the Excel
  prose once (IA 1.1, MA 1.0; mapping in `docs/tasks/03-rules-mapping.md`). Later versions are copies of the
  live version changed by patches (`packages/questionbank/patches/*.patch.json`, `npm run qb:patch`) or,
  from Task 05, the admin editor. Every change cites a decision in `docs/questionbank/decisions.md`.
- Never import an Excel file older than or equal to the latest version: it would undo later decisions
  (the import blocks it; the CLI needs `--force`).
- Condition format (one JSON shape for every rule): `docs/questionbank/rules-reference.md`. Add a fact
  only if a source rule truly cannot be expressed, and document it there.
- Clients may read only live tests, versions, modules, questions and options — never rules, flags, texts,
  test cases or the audit log.

## Engine

- `@mfb/engine` is pure and config-driven: no database, network, clock or randomness in its logic, and no
  question ids, thresholds, scores or report sentences in code (a test fails the build if it finds any).
  Everything comes from the `VersionConfig`. Reference: `docs/engine/README.md`.
- Scoring runs only on the server (`@mfb/engine/server`); the browser submits option codes.
- Every result stores `engineVersion`; bump `ENGINE_VERSION` whenever a result could change.
- Publishing a version requires, for every test case, a passing run on the current engine version made
  after the version's last change (admin → version → Test cases → Run all). The CLIs only submit.

## Client flow

Phone OTP login → registration (name, gender, age, relationship status, city, state, email;
under 18 → AGE_STOP, save nothing) → choose test → payment ₹3,500 → ID assigned on payment success
→ one-line consent → remaining intake → gate (max 2) → core → modules → dose → flags → submit
("nothing can be changed after this") → thank-you screen. The client never sees the report (D22).

- Registration age → I1 / MI1 band. Registration gender → I2 / MI2. Never ask twice.
- Gender options: Male / Female / Prefer not to say.
- Relationship options (I3): Single / In a relationship / Engaged / Married / Separated / Divorced / Widowed.
- Answers are buffered in the browser and saved in batches (every 5 answers, at once when an answer
  raises a flag, at the last question, at submit, and when the tab is hidden or closed) so the client
  can resume. The server still decides every next step from the answers sent. Changing a routing answer
  clears answers from paths that are no longer visible.

### Attempts (Task 06)

- One `attempts` row per paid assessment; `report_id` from `next_report_id()` on payment success.
  Tables: `attempts`, `attempt_answers`, `attempt_results`, `attempt_events` (migration
  `20261018000000_attempts.sql`). Clients read their own rows; active staff read all; all writes go
  through the server (service role) in `clients/lib/assessment/`.
- Each attempt is **pinned** to the version that was live when it was paid (`version_id`). Answers,
  scoring and the report always use that version, even after a newer version goes live.
- Answers from registration are stored with `source = profile` and never asked again. The
  report-language question (I8 / MI5) is never asked: it is answered English at payment (D21). Completed and
  stopped attempts are frozen by triggers.
- Payments: Razorpay Standard Checkout (`clients/lib/payments/`, migration `20261020000000_payments.sql`).
  The server creates the order for the fixed price (`ASSESSMENT_PRICE_PAISE`), the browser only opens the
  checkout, and the server marks a payment paid only after checking the checkout signature and fetching
  the payment from Razorpay (order, amount, currency, status; authorized payments are captured). The
  signed webhook (`/api/payments/webhook`: payment.captured, order.paid, payment.failed) does the same
  when the browser never returns. One payment → one attempt; every step is idempotent. Paid attempts are
  created only through `public.create_paid_attempt()` (migration `20261021000000_paid_attempt_atomic.sql`):
  a per-payment advisory lock, then the existing attempt is returned, or the report number is taken and
  the attempt inserted in the same transaction, so report IDs have no gaps even when verify and webhook
  race. Never call `next_report_id()` separately from the insert.
- Report IDs (`MFB-IA-YYYY-NNNNN`) identify assessments; they are **not** GST invoice numbers. Tax
  invoices need their own gap-free, consecutive series per financial year (April–March), issued for paid
  payments only. That series belongs to the payments task, not to report IDs. Checkout name/description: "My Fit Brain" / "MFB Assessment" only. Keys:
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (server-side env only; test and live
  differ only by keys). No stub or test switch exists in code.
- The report is built once at submit from the engine result, in English, and stored in
  `attempt_results.report`. Only super admins and counsellors see it (admin → attempt; `ReportView` from
  `@mfb/report`), never clients or coordinators (D22; RLS `can_view_reports()` on `attempt_answers` and
  `attempt_results`). Never re-score or rebuild it for display.
- Crisis / safety / age-stop flags write one `attempt_events` row each (unique per flag) for staff.
- Answering is built to need no database read in the usual case: the browser sends its draft answers,
  the server checks the whole draft against the pinned version (`resolveDraft`), and the attempt row and
  client profile come from small per-instance caches (`lib/assessment/server.ts`). Caches only skip
  reads; every write goes to the database and its triggers decide. Page loads, consent and submit read
  fresh.
- Auth in the clients app uses `supabase.auth.getClaims()` (middleware and `lib/auth.ts`
  `getAuthUser()`), which verifies the token locally when the project uses asymmetric JWT signing keys
  (Supabase Dashboard → Project Settings → JWT Keys). With the legacy shared secret it falls back to an
  Auth server call per request.
- URLs and titles carry no test name: `/payment/<code>`, `/assessment/<uuid>`.
- Client app shell: `components/PageChrome.tsx` = sticky header + bottom tab bar (`BottomNav`: Home `/`,
  Profile `/profile`). Payment and assessment screens hide the tab bar. Sign out lives on Profile. Home
  lists the client's assessments (status and date only, no report).
- Prefer canonical Tailwind classes (`min-h-11`, not `min-h-[44px]`); keep arbitrary values only for
  sizes off the 4px scale (font sizes, `calc()`, safe-area).

---

## Brand — MFB Brand Kit v1

### Colour

Use tokens, never raw hex in components. Hex lives only in `mfb-tokens.css` and the `@theme` block.

| Token | Hex | Use |
|---|---|---|
| teal | `#145A5A` | Primary: headings, nav, key surfaces |
| night | `#0E4242` | Dark sections, footer, admin nav, hover on teal |
| mist | `#E8F2F0` | Soft fills, selected states, info boxes, pills |
| coral | `#E8745A` | The bindu: dots, icons, focus ring. Never buttons or small text |
| coral-deep | `#B9502F` | Primary buttons (white text), small coral text |
| coral-light | `#F2A58E` | Accents on teal backgrounds only (large text) |
| cream | `#FBF7F2` | Page background |
| white | `#FFFFFF` | Cards, forms, modals |
| sand | `#E6DED3` | Borders, dividers |
| ink / ink-soft / ink-muted | `#1A2A2A` / `#3D5050` / `#5E7474` | Text / secondary / captions |

- Balance per screen: about 60% cream/white, 25% teal, 10% ink, 5% coral.
- Contrast: body text ≥ 4.5:1. White text only on teal, night or coral-deep.
- Service colours (rose, rose-deep, plum, slate, lake) belong to other MFB service lines. Do not use them
  in this product. This product is the MFB Assessments line: Deep Teal.
- Report bands (PROPOSED, pending sign-off — calm, never red): Low = mist with teal text,
  Mild = teal, Moderate = coral-light with ink text, High = coral-deep.

### Type

- Headings: Poppins — H1 SemiBold 40–48px teal or ink; H2 SemiBold 28–32px teal; H3 Medium 20–22px ink.
- Body: DM Sans Regular 16–18px ink-soft; captions 13–14px ink-muted. Buttons: Poppins SemiBold 16px.
- Self-hosted with `next/font/local`; fallback Arial.
- Hindi: Noto Serif Devanagari (headings), Noto Sans Devanagari (body), line-height × 1.15 under `:lang(hi)`.

### Logo (`brand/01_Logo/`)

Seven versions × five colour treatments. Before using any logo, list `brand/01_Logo/SVG/` and map the
real file names; never guess a path.

| Version | Use in this product |
|---|---|
| Horizontal | App headers (clients + admin), login screens |
| Horizontal + tagline | Brand moments only (e.g. login hero). Min 180px wide |
| Stacked / Stacked + tagline | Square or tall spaces (empty states, splash) |
| Icon | Favicon, app icon, collapsed admin nav, watermark (8–10% opacity, cropped at a corner) |
| Endorsed ("Founded by Dr. Neha Mehta") | Test selection, payment, booking confirmation, report header |
| Founder seal | Report footer and certificates only. Never in ads or general UI |

| Colour treatment | When |
|---|---|
| Full colour | On cream or white (default) |
| Reverse | On teal or night (e.g. admin sidebar, dark footer) |
| Mono teal / Black / White | One-colour contexts only |

- Minimum sizes: horizontal 120px wide, horizontal + tagline 180px, stacked 80px, icon 16px.
- Clear space: one bindu width on every side; the master files already include it — do not crop.
- Never stretch, recolour, rotate, add effects, rearrange, retype the wordmark, place on busy or
  mid-grey backgrounds, or turn the bubble into a brain.
- Use SVG on the web, PDF in generated PDFs, PNG only where SVG is not supported (email).
- Always `alt="My Fit Brain"`. The endorsed version's alt: "My Fit Brain, founded by Dr. Neha Mehta".

**Logo files.** Each version has its own folder: `brand/01_Logo/SVG/<Folder>/MFB_<Name>_<Treatment>.svg`.
Folders/names: `Horizontal`, `Horizontal_Tagline`, `Stacked`, `Stacked_Tagline`, `Icon`,
`Endorsed_FoundedBy`, `Founder_Seal`. Treatments: `FullColour`, `Reverse`, `MonoTeal`, `Black`, `White`
(e.g. `Horizontal/MFB_Horizontal_FullColour.svg`). `Service_Lines/` holds other MFB service-line lockups;
do not use them here. In the apps, render logos only through `components/brand/Logo.tsx`, which maps
variant × tone to these names. Apps keep a flat copy in `public/brand/logo/` of only the files they render,
so copy the master file there before using a new combination.

### Components

- Buttons: pill. Primary = Coral Deep, white text, one per screen. Secondary = 2px teal outline.
  Bindu Coral is never a button background. The old orange-to-pink gradient is retired.
- Cards: white, 1px sand border, 14px radius, soft shadow `0 6px 24px rgba(20,90,90,0.08)`.
- Pills / labels: mist background, teal text, fully rounded.
- Bindu dot: one coral dot above a headline, max one per screen.
- Icons: lucide outline, rounded ends, 2px stroke, teal. Never mix filled and outline. No brains, pills,
  crosses or medical symbols.
- Touch targets ≥ 44px. Assessment column max 640px; report max 760px; header 56px sticky with logo
  left and `EN | हिं` toggle right.
- Photography (if ever used): real Indian people, natural light, calm. Never head-in-hands, dark/rainy
  scenes, brain illustrations, or a real client.

### Tagline and lines

- Brand line: "Space to speak." — capital S, full stop. Never translated inside the logo.
- Campaign lines allowed: "Talk to someone who understands." · "Understood, in your language."
- Retired everywhere: "We Care For Your Emotions", "Science with a human touch".
- Footer: "Space to speak. · My Fit Brain, a unit of MeDa Partners Pvt Ltd".

---

## Copy rules (hard)

- Voice: calm, kind expert. Short sentences, everyday words. Warm, never cute.
- Say: qualified counsellor / therapist / psychologist, consultation, support, screening,
  "Your information stays private", "It's okay to start small".
- Never say: licensed, RCI-registered, clinically validated, cure, guaranteed, fix you, diagnosis names,
  "crazy", "mental", "victim", "before it's too late".
- No fake urgency, countdowns, streaks, confetti, marketing opt-ins, upsells, fake reviews or
  unverified outcome numbers.
- The assessment is "a structured assessment designed by Dr. Neha Mehta". Never "clinically validated".
- "Founded by Dr. Neha Mehta" / "Designed by Dr. Neha Mehta" only, plus exactly "Dr. Neha Mehta, Consultant
  Psychologist" (the brand guidelines use this line, e.g. DESIGNED_BY in the report). Every other
  credential still needs approval. Never claim she personally reviews or
  treats every case.
- Discretion: SMS, WhatsApp, email subjects, payment-gateway descriptor and all notifications say only
  "MFB Assessment". Never "Intimacy". Browser tab titles and page metadata stay generic ("My Fit Brain").
- Report text comes only from the version's question-bank texts (`qb_texts`, `qb_item_texts`; originally the
  Excel Report Text, Flags & Safety and Strengths & Stuck tabs). Never generate free text.

## Safety (never weaken)

- Under 18 → AGE_STOP screen, end, save nothing, refund if paid.
- R5 / MR5 = Yes → immediate calm support screen (Tele-MANAS 14416 / 1-800-891-4416, `tel:` links),
  crisis report layout (crisis block first; no plan, no focus lines), coordinator alert by email and
  WhatsApp. Coordinator calls within 4 working hours (after 8 PM → by 10 AM next day).
- R6 / MR6 = Yes → safety block (112 / 181), format forced to Individual, no couple invitation, team notified.
- Medical flags add a block and a counsellor tag. Flags never change the tier.
- MR4 is a counsellor tag only, never printed.

## Data and privacy

- Never collect or store free text from clients.
- Scoring runs server-side only. The browser submits option indexes; the server loads config, scores,
  and writes results.
- Every attempt stores its question-bank version.
- Report PDFs are never stored (owner, 2026-10-16): super admins and counsellors download them from
  the admin report page ("Download PDF" → `admin/app/attempts/[id]/pdf/route.ts`, built on request with
  `@react-pdf/renderer` from the stored report, sent with `Cache-Control: no-store`), file name = report
  ID. Layout follows `brand/MFB_Assessment_Report_Template_A4.pdf` (`admin/lib/report-pdf/`): cover with
  endorsed logo, test name, Prepared for / Date / Report ID, founder seal and the disclaimer band; content
  pages with logo header, numbered sections and the brand footer. Colours come from
  `brand/mfb-tokens.json`, fonts from `admin/app/fonts`, logos from `brand/01_Logo/PNG` (the renderer
  cannot embed SVG; `next.config.ts` traces these files into the deployment).
- Secrets live in env vars or Supabase Vault. Never commit keys or put them in SQL or code comments.
- Nothing in UI, reports, metadata or code comments may contain a diagnosis name, medical claim, cure or
  guarantee word, price (outside payment), or an unapproved credential.
- DPDP (India) / GDPR: consent before health information; no marketing opt-in on the consent screen.
- Testing phase only: the Renflair API key sits in `20261013000001_renflair_sms_hook.sql`. The owner
  removes it before any push. Do not modify or flag it.

## Database rules

- Never edit an applied migration. Add a new timestamped file in `supabase/migrations/`.
- The owner runs SQL in the Supabase dashboard SQL Editor. Write migrations paste-ready (one
  `BEGIN … COMMIT`), plus a separate verification SQL file. Do not apply them or start a local database.
- Gender, relationship status, staff roles and age limits come only from `lib/options.ts` in each app
  (stored values = English strings; labels via i18n).
- Every new table gets RLS in the same migration.
- Roles: `super_admin`, `coordinator`, `counsellor`. Counsellor-only fields (raw answers, flags,
  readiness, COPING_TAG) live in tables or views clients cannot read.
- Never trust client metadata for authorisation; check `profiles` / `clients` by `auth.uid()`.

## Do not touch without an explicit task

`admin/lib/auth.ts`, `clients/lib/phone.ts`, Supabase client helpers, existing RLS policies,
existing migrations, `.env*` files.

## Working conventions

- Windows + PowerShell. Stop dev servers before renaming or moving folders.
- Work on a branch per task; commit in small logical chunks with conventional messages.
- Install from the repo root (`npm install`); never add a lockfile inside an app. Root scripts:
  `dev:clients`, `dev:admin`, `build`, `lint`, `test`, `qb:import`, `qb:patch`.
- Before finishing any task: `npm run lint` and `npm run build` pass in every app you touched, and
  `npm test` passes when a package changed.

## Status

- Phase 1 done: phone OTP via Renflair Auth hook, clients and staff tables with RLS, admin client
  management, coordinator provisioning, bilingual EN/HI UI.
- Done: folder rename `app/` → `clients/`; brand kit and docs added to the repo.
- Done: task 01 UI rebrand (MFB tokens, Poppins/DM Sans, brand primitives in `components/brand/`,
  both apps restyled). See `docs/rebrand-audit.md` for details and follow-ups.
- Done: task 02 foundation fixes — migration `20261015000000_mfb_foundation.sql` (gender and
  relationship status per I2/I3, `counsellor` role, `is_counsellor()`), shared `lib/options.ts`,
  registration AGE_STOP, Team page with counsellors, env-driven URLs (`lib/site.ts`,
  `NEXT_PUBLIC_CLIENTS_URL` / `NEXT_PUBLIC_ADMIN_URL`). See `docs/tasks/02-findings.md`.
- Done: task 03 question bank data model — npm workspaces + `@mfb/questionbank`, migration
  `20261016000000_question_bank.sql`, seed rules and worked-example test cases for IA 1.1 / MA 1.0, admin
  Question bank screens (overview, import, read-only version tabs, status actions). See
  `docs/tasks/03-findings.md`, `03-rules-mapping.md`, `03-load-banks.md`.
- Done: task 04 Step 0 — single repository (apps no longer nested git repos; old histories in
  `../git-backups/`).
- Done: task 03b rule decisions — `docs/questionbank/decisions.md` (D1–D20), migration
  `20261016100000_qb_rule_decisions.sql` (exclusive options, test Hindi/progress names, validation), version
  patches IA 1.1 → 1.2 and MA 1.0 → 1.1 with 8 new test cases. Run order: `docs/tasks/03b-apply.md`.
- Done: task 04 engine — `@mfb/engine` (ENGINE_VERSION 1.0.0); all 11 Worked Examples and the 8 Task 03b
  cases pass offline; migration `20261017000000_qb_test_runs.sql` (test runs, `content_changed_at`, publish
  gate; paste-ready in `docs/tasks/04-apply.sql`); admin Test cases tab runs and records test cases.
- Done: task 06 client assessment flow — migration `20261018000000_attempts.sql` (paste-ready in
  `docs/tasks/06-apply.sql`), server layer `clients/lib/assessment/`, test choice, payment (now Razorpay), language,
  consent, question runner, crisis support screen, web report (`@mfb/report`), admin read-only attempt
  views and dashboard counts. Manual check: `docs/tasks/06-manual-check.md`.
- Done: Razorpay payments — migration `20261020000000_payments.sql` (checks:
  `docs/tasks/08-payments-verify.sql`), order / verify / webhook routes, payment screen.
- Done: gap-free report IDs — migration `20261021000000_paid_attempt_atomic.sql` (checks:
  `docs/tasks/08b-paid-attempt-verify.sql`).
- Open (payments task): GST invoice numbering, its own gap-free series per financial year.
- Next: Task 07 — polish. Task 05 (admin editor, rule builder, preview, review/publish UI)
  is still open.
