# My Fit Brain Assessments — project rules for Claude Code

My Fit Brain (MFB) is a unit of MeDa Partners Pvt Ltd. This repo is the MFB Assessments platform.
It replaces the earlier "Dr Neha Mehta Relationship & Intimacy Assessment Platform". That brand, its
design system (plum / magenta / gold, Playfair Display, Inter) and its copy are retired.
Dr. Neha Mehta now appears ONLY as an endorsement line.

This file is the single rulebook. `.agents/` and any other agent context must point here, not repeat or
contradict it. Task briefs live in `docs/tasks/` and are executed one at a time.

---

## Permanent rule: never delete data

Never delete database data and never write SQL that deletes, drops or truncates anything without asking the
owner first and getting a yes for that specific file. This protects **production**; on the staging database
(fake data only, see "Database rules") Claude may run anything. The one-time reset of Task 11 (file
`20261026000000_reset_question_bank.sql`) was allowed once and is over. Every SQL file that would remove
something must say so in plain words at its top. Verification SQL is `select` only.

---

## Standing rules for every step (owner, 2026-11-20)

- Build on the current `main` (production code). Never reuse `archive/fms-2026-11-20` or any old Task 12/13 work.
- Never commit directly on `main`: each step gets its own branch, started from the previous step's branch (or
  `main`). Nothing is merged into `main` or pushed unless the owner asks.
- Work on STAGING. Additive SQL only. Never delete data or write deleting SQL without the owner's explicit
  permission. After each step, name the SQL file(s) to paste into production once the owner has tested.
- Production stays untouched until the whole flow works (owner, 2026-11-20): each step's SQL files are collected
  in `docs/deploy/production-log.md` under "To paste later, in order".
- Make every screen responsive: phones, tablets and laptops (owner, 2026-11-20).
- Standing permission (owner, 2026-11-20): a CHECK rule / allowed-values list may be replaced by a WIDER one (new
  outcomes, events, statuses) when a step needs it, as long as no rows are removed or changed. Say so in the step's
  summary every time. Every other kind of deleting still needs the owner's explicit yes.
- Keep screens simple: plain words, one main button at a time, details collapsed.
- Build only what the current step asks. STOP after each step with: what changed, how to test it (with test
  logins), and any SQL.
- Words on screens: **Purchase**, **Purchase journey**, **Mark as call done**.

---

## Repository layout

```
MyFitBrain/
├─ CLAUDE.md                  this file
├─ README.md · SUPABASE_SETUP_GUIDE.md · skills-lock.json
├─ package.json               npm workspaces root: clients, admin, packages/* (ONE lockfile, here)
├─ .agents/                   points to CLAUDE.md only
├─ admin/                     Next.js app — staff portal
├─ clients/                   Next.js app — client portal
├─ packages/
│  └─ questionnaire/          @mfb/questionnaire — the one engine: light validation, flow, scoring, report,
│                             counsellor view, plain-language descriptions, the AI prompt constant
├─ brand/                     MFB Brand Kit v1 — MASTER files, never served directly
│  ├─ 01_Logo/{SVG,PNG,PDF}/  web (first choice) · raster fallback · print
│  ├─ fonts/                  Poppins (Regular/Medium/SemiBold/Bold), DM Sans (Regular/Medium/Bold) TTF
│  ├─ favicon.ico · favicon-64.png · apple-touch-icon-180.png · android-chrome-*.png · app-icon-1024.png
│  ├─ mfb-tokens.css · mfb-tokens.json · tailwind.mfb.js · MFB_Palette_Codes.txt
│  ├─ MFB_Brand_Guidelines_v1.pdf · MFB_Palette_Sheet.png
│  └─ MFB_Assessment_Report_Template_A4.pdf
├─ docs/
│  ├─ spec/                   MFB Assessments Developer Spec v1.1 (.docx) — product, flow, safety
│  ├─ questionnaires/         README.md (the JSON format and the system), ai-prompt.md (behind Copy AI prompt),
│  │                          intimacy.json · mind.json (starting drafts converted from the workbooks)
│  ├─ questionbank/           the two developer workbooks (.xlsx) and decisions.md — history only
│  ├─ deploy/                 vercel.md (two Vercel projects), new-supabase-project.md (exact SQL order),
│  │                          staging.md (staging DB + dashboard checklist), production-log.md (files on prod)
│  ├─ tasks/                  task briefs, findings and verify SQL per task
│  └─ rebrand-audit.md        produced by task 01
└─ supabase/
   ├─ migrations/             paste-ready SQL, one BEGIN … COMMIT per file (never edit an applied one)
   ├─ baseline/               schema-only export of production (no data), the starting point of staging
   ├─ go-live/                one-time go-live steps to paste on production (not migrations; staging never runs them)
   ├─ staging-migrate.ps1     applies new migrations / runs one SQL file on STAGING only
   ├─ prod-readonly.ps1       OWNER ONLY: read-only production backup and check runs
   ├─ seed-staging.sql        fake staging data (staff logins, questionnaires, clients, purchases)
   └─ .env.db                 PROD_DB_URL, STAGING_DB_URL, STAGING_STAFF_PASSWORD — git-ignored, never print
```

### Brand files inside the apps

Next.js serves only each app's own `public/`. Each app keeps COPIES of what it needs:

| Copy in each app | From master |
|---|---|
| `<app>/public/brand/logo/*.svg` | `brand/01_Logo/SVG/` (only the files the app uses) |
| `<app>/public/` favicon.ico, apple-touch-icon-180.png, android-chrome-*.png | `brand/` |
| `<app>/app/fonts/*.ttf` | `brand/fonts/` |
| `<app>/styles/mfb-tokens.css` | `brand/mfb-tokens.css` |
| `admin/assets/report-pdf/*.png` (report PDF logos) | `brand/01_Logo/PNG/` (Endorsed, Horizontal, Founder seal, FullColour) |

Never edit a copy so it differs from the master. If a master changes, update both apps.

---

## Source of truth

| File | Wins on |
|---|---|
| `docs/spec/` Developer Spec v1.1 | Product, flow, safety, report layout |
| The published version's JSON in the database (`questionnaire_versions.definition`) | Every question, option, value, rule and report line |
| `docs/questionnaires/README.md` | The JSON format, the rules, how scoring works |
| `brand/MFB_Brand_Guidelines_v1.pdf` | Logo use, colour, type, voice, photography |
| `brand/MFB_Assessment_Report_Template_A4.pdf` | Report PDF layout |

Never invent questions, values or report text. If something is not covered, stop and ask rather than guess.

---

## Apps and domains

| Folder | Purpose | Domain | Dev port |
|---|---|---|---|
| `clients/` | OTP login, registration, test choice, payment, assessment, thank-you | `https://www.myfitbrain.app` | 3000 |
| `admin/` | Super admin, coordinators, counsellors | `https://admin.myfitbrain.app` | 3001 |

- The folder is `clients/`; it is served at `www.myfitbrain.app` (`myfitbrain.app` redirects to www).
- Both Vercel projects need `NEXT_PUBLIC_CLIENTS_URL=https://www.myfitbrain.app` and
  `NEXT_PUBLIC_ADMIN_URL=https://admin.myfitbrain.app` (`lib/site.ts`; production builds fall back to these).
- One Supabase project for both apps. No custom backend: logic runs in Next.js Server Actions / route
  handlers and Postgres functions.
- Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript 5, Tailwind v4, Supabase
  (`@supabase/ssr`, `@supabase/supabase-js`), lucide-react.
- Tailwind v4: tokens are mapped with `@theme` in `globals.css`. `brand/tailwind.mfb.js` is reference only;
  never add a JS Tailwind config.

---

## Products

- **MFB Intimacy Assessment** — code `IA`, report ID `MFB-IA-YYYY-NNNNN`
- **MFB Mind Assessment** — code `MA`, report ID `MFB-MA-YYYY-NNNNN`
- **On / Off** (Admin → Questionnaires, super admins only; `questionnaires.is_active`, migration
  `20261031000002_questionnaire_active.sql`): Off = nobody can buy it (the pay link says "not available right
  now", the order route refuses with PAUSED, Home hides it). Paid purchases can still be started and running
  assessments finished.
- Any new questionnaire = one row in `questionnaires` (code, names, report prefix; Admin → Questionnaires →
  New questionnaire) plus its JSON versions. No code change.
- Each costs ₹3,500 and includes the assessment and one consultation. No price anywhere except the payment
  step, the public /pricing page and the client's own payment receipt (completed screen: amount paid, date,
  method, Razorpay ID). The payment step and /pricing show ₹3,500 next to the regular price ₹7,000 struck
  through, with "Introductory price" (owner decision 2026-10-31; `REGULAR_PRICE_PAISE` is display only, never
  charged). Keep it only while ₹7,000 is the real regular price. The package offer card on Home (after the report
  presentation, step 6) is a payment step too and shows the package price, the advance and the amount to pay. /pricing
  also lists the Counselling package (price, advance, you pay; read from Admin → Settings) because the payment
  gateway wants every product published.
- "What you get" (payment step, Home cards, /pricing; `pay.features` in `clients/lib/i18n.ts`, EN + HI):
  the assessment, one consultation, report review and guidance with your counsellor, personalised action
  plan, follow-up support, educational resources and guidance. No "diagnostic" or "treatment" wording.
- Home: paid, not started shows a "Paid" pill, the paid date and Start; a test the client already paid for
  shows "already paid" instead of Buy now. No "Install app" button (the browser's own prompt still works).
- Display line under each name: "Designed by Dr. Neha Mehta".
- One person per assessment. A partner takes and pays for their own; reports are never linked.
- The report is for the care team only. The client never sees it in the app; the counsellor downloads the
  PDF from the admin and shares it on WhatsApp when the client asks. No sharing feature in the system.

## Questionnaires (Task 11 — the simple system)

**One JSON per version is the only format.** Spec: `docs/questionnaires/README.md`. The engine
`@mfb/questionnaire` holds the logic once; nothing in code belongs to one questionnaire.

- **Admin flow:** Questionnaires → **Copy AI prompt** → paste it into any AI together with the questions →
  the AI returns one JSON → **Import JSON** (creates the draft, or replaces the open draft) → the page shows
  the whole questionnaire in plain language (what opens what, values, counsellor notes, report lines) →
  **Publish** (the previous live version retires). No review step, no approval tick. **Copy JSON** gives a
  version back for editing. Super admins import and publish; counsellors read; coordinators have no access to Questionnaires (owner, 2026-11-20: menu, page guard and every action).
- **The JSON:** `title`, optional `subtitle` / `closing` / `disclaimer` / `ranges` / `plan`, and `sections` →
  `questions` → `options` (`id`, `text {en, hi}`, `value` number or `null`, optional counsellor `note`).
  Rules (`show_when`), the complete list: `question is / is_not / includes`, `section score_at_least /
  score_at_most`, `all`, `any`. An unanswered question or hidden section counts as false, never "unknown".
- **Scoring (fixed, in code):** higher value = more difficulty; each answer = % of its own question's value
  range; section score = average; fewer than half the shown questions with a value → "Not enough answers";
  range = first `up_to` ≥ score; main area = highest-scoring section; plan row = the main area's range.
- **Built in (code, never in the JSON):** a safety section at the end of every questionnaire — the crisis
  question (Yes → support screen with Tele-MANAS at once, `attempt_alerts` row, report shows a support
  message first and hides the plan and focus) and the home-safety question (Yes → alert). Texts EN + HI in
  `packages/questionnaire/src/defaults.ts`. The validator never relaxes this.
- **Validation is light.** Import is blocked only for invalid JSON, no questions, duplicate ids, a rule
  pointing to an id that does not exist (and a question without options). Everything else is a warning in
  plain English shown at the top of the page and never blocks: missing Hindi (English is used), missing
  report lines, no plan, a rule reading a later question (it counts as false), ranges not reaching 100
  (defaults used).
- **The AI prompt** lives once in `docs/questionnaires/ai-prompt.md`; `npm run prompt -w @mfb/questionnaire`
  regenerates the code constant and a test fails when they differ. The prompt never includes the safety
  questions, never asks for identity, and carries the copy rules below.
- **Versions:** `draft` → `live` → `retired`. One live and one draft per questionnaire. Published versions
  never change (trigger). Attempts pin the version they were paid on; publishing never touches a running
  assessment. Status changes only through the admin (`publish_questionnaire_version`).
- **Client details** (typed answers, owner-approved 2026-10-27): a per-questionnaire list of open questions
  asked after the safety questions, one per screen, answer required, up to 1,000 characters
  (`DETAIL_MAX_LENGTH`). No options, values, rules, scoring or report text. The list lives in
  `questionnaires.client_details`, **not** in a version: Admin → Questionnaires → Client details edits it at
  any time (super admins), and it applies at once, also to running assessments. Each answer
  is stored in `attempt_details` with a copy of the question as it was asked. The JSON may carry an optional
  `client_details` list; publishing a version that has one replaces the questionnaire's list, and Copy JSON
  includes the current list.
- Clients read questionnaire names and their own attempt rows; never definitions, answers or results (RLS).
- Registration already asks age, gender and relationship status; questionnaires never ask them again. Age
  under 18 is stopped at registration.

## Client flow

**Pay first, log in later.** Public pay link `/pay/<code>`, e.g. `/pay/IA` (phone only, ₹3,500; or the same page from
Home, phone fixed to the signed-in number) → success screen with the masked number → phone OTP login (number
filled in) → registration (name, gender, age, relationship status, city, state, email; under 18 →
AGE_STOP, no account; only the minimal `age_stops` record is kept, and the number's paid purchases are flagged
refund needed) → Home claims every paid,
unclaimed purchase of the verified number → **Start** creates the attempt and its report ID → one-line
consent → one question per screen, in the order of the JSON → built-in safety questions →
client details (typed, required; the questionnaire's current list) → submit ("nothing can be changed after this") → thank-you screen ("Your counsellor will go through your
results with you"). The client never sees a report in the app.

- Every answer is saved at once (`attempt_answers`); the server decides the next question from the stored
  answers and the pinned version. Changing a routing answer clears answers to questions that are no longer
  shown. Back reopens the previous visible question. Client details are saved at once too
  (`attempt_details`); Back from the first one returns to the last safety question.
- Single choice = cards; options with `value: null` ("Not applicable", "Unsure") = smaller secondary buttons;
  multiple choice = checkboxes with `max_choices`.
- The report is built once at submit, **always in English** (owner decision 2026-11-06; the client may answer
  in Hindi, `attempts.language` keeps that), and stored in `attempt_results.report` with the engine result.
  Never re-scored. The one rebuild: the PDF route turns a report stored in Hindi before that decision into
  English from the pinned version and the stored result (same scores, English texts; nothing is written).
- URLs and titles carry no test name: `/pay/<code>` (the questionnaire code, e.g. `/pay/IA`, any case; shown with
  Copy pay link in Admin → Questionnaires; title and link preview "My Fit Brain"), `/assessment/<uuid>`. The unused column
  `questionnaires.pay_code` is removed by `20261031000001_drop_pay_code.sql`.
- Client app shell: `components/PageChrome.tsx` = sticky header + bottom tab bar (`BottomNav`: Home `/`,
  Profile `/profile`). Payment and assessment screens hide the tab bar. Sign out lives on Profile. Home
  lists the client's assessments: paid, not started → Start; unfinished → Continue; completed → View
  details (thank-you + receipt).
- Public pages (no sign-in; skipped by `proxy.ts`): the pay links `/pay/*`, and the policy pages (required by
  Razorpay; English only; listed in `lib/legal.ts`): /pricing, /terms, /privacy, /refund-policy (no refunds, no cancellations), /contact. Business
  address, email and phone live in `lib/legal.ts`. The brand `Footer` links to all five; the payment screen
  links Terms and Refund policy. Update the pages when what we collect or who sees it changes.
- Prefer canonical Tailwind classes (`min-h-11`, not `min-h-[44px]`); keep arbitrary values only for sizes
  off the 4px scale (font sizes, `calc()`, safe-area).

### Attempts and payments

- Tables (migration `20261026000001_questionnaires.sql`, checks `docs/tasks/11-verify.sql`): `questionnaires`,
  `questionnaire_versions`, `attempts` (pinned `version_id`, status paid / in_progress / completed,
  `language`, `report_id`), `attempt_answers` (`option_ids text[]`), `attempt_results` (result + report,
  written once), `attempt_alerts` (crisis / home_safety, one per attempt and kind). `report_counters` is the
  gap-free report-number table (kept from before). Migration `20261027000000_client_details.sql` (checks
  `docs/tasks/12-client-details-verify.sql`) adds `questionnaires.client_details` and `attempt_details`
  (typed answer + question as asked; locked once completed; RLS `can_view_reports()`). Every new table has RLS; all writes go through the
  server (service role) in `clients/lib/assessment/` and `admin/lib/services/`.
- Completed attempts and results are frozen by triggers; assessments and payments are never deleted.
- Payments: Razorpay Standard Checkout (`clients/lib/payments/`, migration `20261020000000_payments.sql`).
  The server creates the order for the fixed price (`ASSESSMENT_PRICE_PAISE`), the browser only opens the
  checkout, and the server marks a payment paid only after checking the checkout signature and fetching
  the payment from Razorpay (order, amount, currency, status; authorized payments are captured). The
  signed webhook (`/api/payments/webhook`: payment.captured, order.paid, payment.failed) does the same
  when the browser never returns. Order and verify need no sign-in.
- A purchase whose number already belongs to a registered client (signed in before) is linked to that client
  when the order is created (`clientByPhone`); otherwise at the first Home load with that verified number.
  Home also asks Razorpay about the number's "not completed" orders of the last 48 hours
  (`recoverOpenPayments`) and marks paid any that were paid there but never confirmed here.
- A payment row is a **purchase owned by a phone** (migration `20261031000000_pay_first.sql`, checks
  `docs/tasks/13-pay-first-verify.sql`): `phone` (E.164), `client_id` + `claimed_at` empty until someone
  logs in with that verified number (claimed on every Home load), `refund_status` needed → refunded,
  `ip_hash` (keyed hash, rate limit only: 5 orders per phone and 20 per IP per hour). Owner (phone, client)
  may change only before Start (trigger). One purchase → one attempt, created on **Start** only through
  `public.create_paid_attempt()` (per-payment advisory lock; the report number and the insert in one
  transaction, so report IDs have no gaps even on a double tap). Never call `next_report_id()` separately
  from the insert.
- Admin → Payments (`/payments`): super admins and coordinators only (nav, page guard and RLS
  `can_view_payments()`); counsellors never see payments. Each row shows two pills, Payment (Paid / Not
  paid / Payment failed / Refund needed / Refunded) and Assessment (Not logged in / Not started / In progress
  / Completed). The filters: Paid (all money received, not refunded; matches the Received card), then calling
  lists, one stage per purchase (`paymentStage`): Paid, not logged in · Logged in, not started · In progress
  · Completed · Payment not made ("Paid on a later try" when the number paid for the same test afterwards) ·
  Refund needed · Refunded. Rows not linked to a client show the name of the client registered with that
  number, if any. **Export to Excel** asks which list and
  period, then downloads an .xlsx built on request (`/payments/export`, `admin/lib/xlsx.ts`, no library,
  nothing stored). A paid purchase that is not started can be moved to another number (logged in
  `payment_moves`) or marked refunded (after refunding in the Razorpay dashboard).
- Google Sheets feed (read only): `GET /api/integrations/google-sheets/payments` in the admin app returns
  purchase_id (the payments row id, the sheet's key), payment_time (paid, else tried; India time), test code,
  status, payment, assessment, name, mobile (the same values as the Excel export, both use
  `lib/payment-fields.ts`) and last_update, newest payment first. An unpaid try followed by a later try for
  the same number and test is left out and listed in `removed` (`lib/integrations/sheets-rows.ts`). `Authorization: Bearer` + `GOOGLE_SHEETS_SYNC_TOKEN` (64 characters, server env
  only, checked timing-safe before any read; unset → 401 for all). Optional `from` (inclusive) / `to`
  (exclusive), ISO 8601 with a zone: purchases whose payment, assessment or client (`updated_at`) or
  under-18 record (`last_at`) changed in the window (`readPaymentsForSync`). Over 20,000 rows → 422.
- **Offline payments** (UPI to our number, bank transfer, other; no cash; migration
  `20261103000000_offline_payments.sql`, checks `docs/tasks/18-offline-payments-verify.sql`): super admins and
  coordinators press **Add manual payment** on a client's profile (staff see "manual payment" and
  "Reference ID" everywhere; code and database keep `offline`) (live, switched-on questionnaire; the fixed price,
  read-only; method; date paid; reference required; proof JPG/PNG/WebP/PDF ≤ 4 MB required, type checked from the
  bytes; optional note). The proof is uploaded to Google Drive FIRST; if that fails nothing is saved. Then a paid row
  in `payments` (`provider = 'offline'`, `reference`, `recorded_by`, `proof_file_id`, `proof_url`, order and payment ID
  `offline_<id>`), linked to the client, so Home shows Start at once. A reference already used is a warning, never a
  block. **Cancel payment** (offline, paid, not started; reason required): status `cancelled`, the row stays with
  who / when / why. Razorpay payments keep Mark refunded. The Payments list shows both, with method (Razorpay / UPI
  / Bank transfer / Other), reference, proof link and recorded by; manual payments carry a solid teal **Manual**
  pill. Filters for method (Razorpay, Manual = every manual payment, UPI, Bank transfer, Other) and a date range
  (date paid, else created); the Excel export follows them.
- **Google Drive** (proofs; all Google code in `admin/lib/google/drive.ts`, `uploadProof(file, paymentId)`): a
  **service account** (no OAuth, nothing stored in the database), scope `drive`, `supportsAllDrives`, uploads into
  `GOOGLE_DRIVE_FOLDER_ID` (a Shared Drive where the service account is Content manager). File name = payment ID +
  date, never the client's name. Env (admin, server only): `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`
  (literal \n become newlines), `GOOGLE_DRIVE_FOLDER_ID`. Missing env → "Proof storage is not set up. Ask a super
  admin."; failed upload → "Proof could not be uploaded. Please try again."; Google's real error is logged on the
  server only. No Google settings page; coordinators see nothing about Google.
- Report IDs identify assessments; they are **not** GST invoice numbers (open: a gap-free invoice series per
  financial year, April–March, for paid payments only). Checkout name/description: "My Fit Brain" / "MFB
  Assessment" only. Keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (server-side
  env only). No stub or test switch exists in code.
- Auth in the clients app uses `supabase.auth.getClaims()` (`proxy.ts` → `lib/supabase/middleware.ts`, and
  `lib/auth.ts` `getAuthUser()`), which verifies the token locally with asymmetric JWT signing keys.

### Purchases and the purchase journey (step 1, owner 2026-11-20)

- Migrations `20261120100000_purchases.sql` then `20261120110000_payment_attempts.sql`; checks
  `docs/tasks/21-purchases-verify.sql` and `docs/tasks/21b-payment-attempts-verify.sql`; behaviour test
  `supabase/staging/staging-test-purchases.sql` (rolled back). The `payments` table is not changed.
- One table `purchases` holds **purchases** (Paid / Refunded / Cancelled) and **payment attempts** (`not_paid`: tried
  on the pay page, not paid; never called a purchase). One open attempt per phone and assessment: every new payment
  of that phone and assessment, paid or not, Razorpay or manual, joins it; when one is paid the attempt becomes the
  purchase (same row, same coordinator). Without an open attempt a payment starts its own row. One paid payment per
  purchase: a second paid payment becomes its own purchase. An older attempt replaced by a later row is closed
  (`closed_at`) and never shown. `payment_attempts` (view, caller's rights) lists attempts with first / last try and
  `last_try_status` (failed / not_completed) for the Payment call of step 2 (30 min after a try still unpaid, at once
  when failed). `purchase_payments` links payments and keeps "Accounts check: pending" for manual payments; the
  screen shows "Verified by coordinator" (who recorded it).
- **Purchase journey** (`purchase_stages`): Payment → Assessment → Presentation booking → Report presentation → Package
  call, each with planned time, actual time and status (waiting / open / done). Payment and Assessment actual times
  come from real data by triggers on `payments` and `attempts` (never block a payment or a submit). Planned times
  (owner 2026-11-20, filled as the calls are created in later steps): Assessment = paid + 2 working hours
  (Assessment call due); Presentation booking = assessment completed + 2 working hours (Booking call due); Report
  presentation = the booked slot; Package call = presentation done + 2 working hours. Actual: assessment completed,
  booked, counsellor marks done, coordinator marks done.
- **Coordinator per client** (phone, `client_coordinators`): new phone → round robin among active coordinators
  (`coordinator_round_robin`), also for an unpaid try; returning phone → same coordinator. Admin → Team (`/team`; the old `/coordinators` redirects there) shows each
  coordinator's clients; **Move clients** moves all of them, with their purchases and attempts, to another active
  coordinator (`move_coordinator_clients`, logged in `coordinator_client_moves`). **Make inactive** is refused while
  a coordinator still has clients: "Move their clients first." (service and trigger `profiles_keep_clients`). The
  round robin for a phone whose coordinator is inactive stays only as a safety fallback.
- `add_working_hours(at, hours)`: Mon–Sat 9:00–18:00 India time, Sunday off (Fri 17:30 + 2 h = Sat 10:30).
- Admin → **Purchases** (`/purchases`, super admins all, coordinators only their own clients' rows; RLS
  `purchases_select`). Tabs **Unpaid** (open attempts and those closed as Not interested: tried, client,
  assessment, tries, status, call, coordinator) · **Paid** (date, client, assessment, amount, status, stage now,
  call, coordinator) · **All**. Each row shows its open call and due time. Coordinators open on Unpaid when they
  have any, else Paid; super admins on All. A row opens a right-side panel (`?open=<id>`, full width on phones):
  a short top (client, phone, assessment, amount, status, coordinator), then ONE **purchase journey** of our team's
  five tasks in fixed order: 1. Payment call · 2. Assessment call · 3. Booking call · 4. Report presentation
  (counsellor) · 5. Package call. Each task: who, Planned (due / slot) and Actual, late in coral-deep, status done
  ✓ · open ● · upcoming ○ (greyed) · not interested ✕ · **not needed** (struck through, "Not needed – client <did X>
  at <time>": the call closed by itself with no call attempt, or was never made). Nested under each task, in time
  order: every call attempt (choice, reason, full note, who, follow-up) and the client's steps (tries and payment;
  assessment started / completed; presentation booked; marked done; package paid); open task expanded, others
  collapsed. The task's buttons (Mark as call done, Copy pay link, Book presentation, Report presentation done,
  Cancel booking, Add package payment) sit on its row. Built by `buildJourney()` (`admin/lib/journey.ts`, tests
  `admin/test/journey.test.ts`), shown by `components/purchases/JourneyView.tsx`. Payments (assessment and package,
  with proof links) collapsed below. No separate Call history section. Cards below wide screens (xl), a table on
  wide screens.

### Calls and My tasks (step 2, owner 2026-11-20)

- Migrations `20261120120000_calls.sql` then `20261120130000_calls_go_live.sql` (same session, at go-live); checks
  `docs/tasks/23-calls-go-live-verify.sql` (replaces 22); behaviour test `supabase/staging/staging-test-calls.sql`
  (rolled back). Tables `calls` (one per row of purchases and kind, status open / closed, outcome, `closed_note`
  when a rule closed it) and `call_logs` (call history; never changed or removed, trigger); `call_settings` holds
  `go_live_at` (one row). RLS: whoever sees the purchase sees its calls. The outcome and event lists are CHECK
  rules; widening one is covered by the standing permission (say so in the summary). Cleanup
  `20261121000000_calls_cleanup.sql`: outcome `before_go_live` (calls closed by the go-live rule), event `reopened`.
- **Payment call** (on an unpaid attempt): starts 30 minutes after the first try if still unpaid, or at once when a
  payment actually failed; due 2 working hours after it starts. **No call ever starts before go-live** (trigger
  `calls_start_at_go_live`, `20261122000000_payment_calls_go_live.sql`, checks `docs/tasks/33-payment-calls-go-live-verify.sql`):
  a try in the 7 days before go-live gets its Payment call at go-live, due 2 working hours later. One per attempt; a new try adds a history line.
  Closes by itself when the attempt becomes a Paid purchase. **Reopens** (owner, 2026-11-20) when a try after it
  closed (Done or Not interested) fails, or is still unpaid 30 minutes later: due 2 working hours after that, history
  line "Tried again – failed, <time>" (event `try_failed`) and "Payment call reopened" (event `reopened`); a new try also joins and reopens an attempt closed as Not
  interested.
- **Assessment call** (on a Paid purchase): starts at the paid time, due 2 working hours after payment; closes by
  itself when the assessment is completed (stays open while only started); not made when already completed.
  Journey: Assessment planned = its first due time, actual = completed time. **Go-live rule** (owner, 2026-11-20):
  paid in the 7 days before go-live → starts at go-live, due 2 working hours later (not late); paid earlier → no
  automatic call (closed with the note "Paid more than 7 days before go-live: no automatic call."), it stays under
  Paid as "Assessment not started" for Admin to decide; calls already worked before go-live keep their times.
- The Unpaid side panel has **Copy pay link** (`<clients URL>/pay/<code>`) for Payment calls; Paid rows show
  "Assessment not started" / "Assessment started" while at the Assessment stage.
- Calls are made and closed by the payment and assessment triggers (`calls_sync_purchase`) and by `calls_sync()`,
  which the admin runs when My tasks or Purchases opens (the 30-minute rule; no scheduler). Start and due times
  always come from the events, never from when the sync ran.
- **Mark as call done** (`call_mark()`, service role; `lib/services/calls.ts` checks the role and reads the call
  under RLS first): Done (closes) · Call later / Not picked (follow-up date and time within 2 working days = 18
  working hours; the call stays open with that due time) · Not interested (only after at least one earlier call,
  else "At least one follow-up call is needed first."; reason Too costly / Not now / Wrong number / Other). A note
  (up to 2,000 characters) on every choice. Not interested on a Payment call closes the attempt
  (`purchases.closed_reason = 'not_interested'`); it stays under Unpaid with that status. Not interested on an
  Assessment call only closes the call.
- Admin → **My tasks** (`/tasks`, coordinators their own clients, super admins all): ONE list in due-time order,
  late ones first; no sections (owner, 2026-11-20). Filters at the top: **All · Late only · Upcoming** (with
  counts; `?show=late|upcoming`), plus a coordinator filter for super admins. Row = call name, client name or
  phone, assessment, one context line ("2 tries, last 4:19 pm" / "Paid 19 Nov · assessment not started"), due
  time ("Today, 4:19 pm" / "Tomorrow, …"; coral-deep "Late · was due …"), button Mark as call done. A row opens
  the same right-side panel as Purchases.
- Working hours exist twice and must match: SQL `add_working_hours` and `addWorkingHours` in `admin/lib/calls.ts`
  (tests `admin/test/calls.test.ts` use the same cases as the verify file).

### Counsellor availability (step 3, owner 2026-11-20)

- Migration `20261121000001_counsellor_availability.sql`, checks `docs/tasks/24-availability-verify.sql`, behaviour
  test `supabase/staging/staging-test-availability.sql` (rolled back). Super admins only: page, reads (RLS
  `is_super_admin()`), writes (`availability_add` / `availability_remove`, service role, which check the role again).
  Counsellors and coordinators cannot see or change availability.
- **Default, stored once** in `availability_settings` (one row; a Settings screen can change it later, nothing is
  hard-coded in screens): 30-minute slots, Monday–Saturday (`work_days` = ISO weekdays), 9:00–18:00, no gap, lunch
  13:00–13:30 → 17 slots a day (9:00 … 12:30, 13:30 … 17:30). Sunday off. Times are India time.
- **Changes** (`availability_changes`, per counsellor and date): Mark off (whole day, or a time range; optional
  reason) or custom slots (a time range that is a whole number of slots, split into slots; e.g. Sunday 10:00–12:00,
  18:00–18:30). Today or later only. Undo sets `removed_at / removed_by_name` (refused when any of its slots is
  booked); the row stays, so the history (who added, who undid, when) is complete. Never deleted or rewritten
  (trigger).
- `counsellor_slots(counsellor, from, to)` is the ONE place that turns the default and the changes into slots with
  Free / Booked / Off (a default slot wins over a custom one at the same time; Booked wins over Off). Booking must use
  it. `availability_booked()` reads the active presentation bookings (step 4).
- Admin → **Counsellor availability** (`/availability?c=<counsellor>&m=<YYYY-MM>&d=<date>`): pick a counsellor →
  month view (Monday first) with free / booked / off per date → a date opens a right-side panel: that day's slots
  (a booked slot shows the client's name), Mark off and Add custom slots (past dates read only), the active changes
  with Undo, the history (collapsed).

### Booking call and Book presentation (step 4, owner 2026-11-21)

- Migration `20261121100000_presentation_booking.sql`, checks `docs/tasks/25-booking-verify.sql`, behaviour test
  `supabase/staging/staging-test-booking.sql` (rolled back). Wider allowed values (standing permission):
  `calls.kind` + `booking`, `calls.outcome` + `booked`, `call_logs.event` + `presentation_booked`,
  `booking_cancelled`.
- **Booking call** (on a Paid purchase): starts when the assessment is completed, due 2 working hours later; same
  Mark as call done rules. Journey: Presentation booking planned = its first due time. Same go-live rule as the
  Assessment call (completed more than 7 days before go-live → no automatic call; in the 7 days before → starts at
  go-live). Closed (outcome `booked`) when a presentation is booked; ended when the purchase is refunded/cancelled.
- **Book presentation** (button on the Booking call's My tasks row and in the side panel; also in the panel of a
  paid, completed, unbooked purchase whose Booking call is closed): one dialog with the FREE future slots of all
  active counsellors in the **next 3 working days only** (owner, 2026-11-21; `booking_last_day()`: today counts when
  it is a working day, working days = `availability_settings.work_days`; migration
  `20261121500000_booking_three_working_days.sql`, checks `docs/tasks/29-booking-window-verify.sql`;
  `free_presentation_slots()` never lists a later slot and `presentation_book()` refuses one, for every role), by date
  then counsellor; the first 2 dates with free slots are "Preferred", the third selectable without a reason → confirm
  (client, assessment, counsellor, date and time) → `presentation_book()`.
- `presentation_bookings` (counsellor, date, slot, booked by / at; cancel who / when / why). The DATABASE refuses a
  double booking: unique (counsellor, date, start) and unique (purchase) among active bookings, plus a per-counsellor-
  day lock. Coordinators book only for their own clients, super admins for anyone. Never deleted (trigger).
- On booking: the slot is Booked for everyone; Presentation booking actual = booked at; Report presentation planned
  = the slot; the Booking call closes with "Presentation booked: <counsellor>, <date time>". Purchases (Paid tab)
  and the side panel show the presentation.
- **Cancel booking**: super admins only, reason required (3–300). Frees the slot, journey back to Presentation
  booking, Booking call reopens (due 2 working hours) with a "Booking cancelled" history line. No reschedule,
  no-show or meeting link.

### Report presentation done and the Package call (step 5, owner 2026-11-21)

- Migration `20261121200000_presentation_done.sql`, checks `docs/tasks/26-presentation-done-verify.sql`, behaviour
  test `supabase/staging/staging-test-presentation.sql`, end-to-end journey `supabase/staging/staging-e2e-journey.sql`
  (both rolled back). Wider allowed values (standing permission): `calls.kind` + `package`.
- Admin → **My presentations** (`/presentations`): counsellors see only their own booked presentations, super admins
  all with a counsellor filter. Upcoming and Past: date and time, client, assessment, coordinator; **Open report**
  links to `/attempts/<id>` (report access unchanged: super admins and counsellors). Reads run on the service role
  after the role check, filtered to the counsellor (`lib/services/presentations.ts`).
- **Report presentation done** (`presentation_mark_done()`, confirm dialog): the booked counsellor from the slot's
  start onwards (not before), super admins at any time; once. Saves when and who on the booking; journey Report
  presentation actual = marked time; creates the **Package call** for the client's coordinator, due 2 working hours
  later; journey Package call planned = that due time. A presentation marked done can no longer be cancelled.
- **Package call**: same Mark as call done rules, with its own choices since step 6 (below). Context line
  "Presentation done <date> by <counsellor>". (Step 5 closed it with Done = "Client agreed"; older rows may still
  hold outcome `done`, shown as "Client agreed".)
- My tasks (super admins): extra filter **Presentations not marked done** (slot time passed, not marked), each with
  the button. Purchases (Paid tab) and the side panel show "Presentation done <date>" and the Package call status;
  super admins can also mark done (or cancel the booking) from the panel.

### Package offer and package payment (step 6, owner 2026-11-21)

- Migration `20261121300000_packages.sql`, checks `docs/tasks/27-packages-verify.sql`, behaviour test
  `supabase/staging/staging-test-packages.sql`; the full journey `staging-e2e-journey.sql` now ends with the paid
  package. Wider allowed values (standing permission): `purchases.kind` + `package`, `calls.outcome` +
  `package_paid`, `call_logs.choice` + `agreed` (with a follow-up), four `package_*` events.
- **The ₹3,500 assessment payments are not touched**: package payments live in their own table `package_payments`
  with their own functions, routes and store (`clients/lib/package/`). Never add package logic to `payments`.
- **Package settings** (`packages`, one active row; Admin → Settings, super admins): name, sessions (8), frequency
  text ("1 session every week"), price (₹35,000). Never hard-coded. Every payment keeps a copy of the package as it
  was offered.
- **Amount** = package price − the amount paid for that assessment purchase (₹35,000 − ₹3,500 = ₹31,500), always
  calculated in the database (`package_offer()`); full payment only, no expiry. The offer exists once the report
  presentation is marked done, until a package is paid for that assessment purchase.
- **Client app**: Home shows the offer card ("Your report presentation is done · A plan made for you · 8 sessions ·
  1 session every week", package price, already paid (advance), you pay now, Pay) and, once paid, "Payment received.
  Our team will contact you to schedule your sessions." EN + HI (`pkg` in `clients/lib/i18n.ts`). This card is a
  payment step, so it shows prices. `/api/package/order` and `/api/package/verify` (signed-in client, own offer,
  server amount, signature check, payment fetched from Razorpay); the one webhook URL serves both payment kinds
  (`PaymentDeps.otherOrder`); Home recovers a payment the browser never confirmed. Checkout name and description:
  "My Fit Brain" only. Up to 5 orders an hour per offer.
- **Paid** (Razorpay or manual) → `package_settle()`: a new purchase of kind `package` (₹31,500, `parent_purchase_id`
  = the assessment purchase, same client, phone and coordinator); the Package call closes (outcome `package_paid`);
  the assessment journey's Package call actual = package paid time. One paid package per assessment purchase (unique
  index): a second paid payment makes no package and is flagged `refund_status = 'needed'` ("Refund needed").
- **Failed or abandoned try**: failed at once, or still not completed after 30 minutes (`calls_sync()` →
  `package_calls_sync()`): a history line on the Package call, and a closed call (Not interested) reopens, due
  2 working hours later.
- **Add package payment** (button on the Package call's My tasks row and in the purchase's side panel; coordinators
  for their own clients, super admins): the same form and rules as the manual assessment payment
  (`admin/lib/services/packages.ts`, `PackagePaymentDialog`): amount fixed and read-only, method, date, reference,
  proof to the SAME Google Drive folder first, then `package_payment_manual()`; "Verified by coordinator", "Accounts
  check: Pending". No cancel for package payments yet.
- **Package call choices** (`choicesFor('package')`): **Client agreed – will pay** (`agreed`: the call stays open, a
  follow-up within 2 working days is required), Call later / Not picked (follow-up), Not interested (after an
  earlier call, with a reason). Done is refused on Package calls.
- **Where it shows**: Package purchases are NOT in the coordinators' Purchases tabs (assessment rows only, `kind =
  'assessment'` in every list); super admins have the type **Package** in Purchases. Payments has a switch
  Assessment payments · **Package payments** (`/payments/packages`; super admins all, a coordinator their own
  clients by RLS, counsellors none). The assessment purchase's side panel shows "Package paid ₹31,500 on <date>
  (<method>)".
- Staging end-to-end: `supabase/staging/staging-e2e-package-setup.sql` makes two fake clients at the offer stage;
  `admin/test/staging-e2e-package-manual.test.ts` (only with `RUN_STAGING_E2E=1`) records a manual package payment
  with a real proof upload.

### Counsellor access and moving a counsellor's clients (step 8, owner 2026-11-21)

- Migration `20261121600000_counsellor_clients.sql`, checks `docs/tasks/30-counsellor-clients-verify.sql`, behaviour
  test `supabase/staging/staging-test-counsellor-clients.sql` (rolled back).
- **A counsellor sees only their own clients** (client record, assessments, answers, results, client details, alerts,
  conclusion, PDF, My presentations). A client is assigned (`client_counsellors`) when a presentation is booked with
  that counsellor (trigger on `presentation_bookings`; also when a super admin marks an old purchase's presentation done,
  and once at go-live for old clients with a paid assessment, see "Before the system"); the assignment stays after the
  presentation and after a cancel.
  Super admins see everyone; coordinators and clients unchanged. Enforced by RESTRICTIVE rules on `clients`,
  `attempts`, `attempt_answers`, `attempt_details`, `attempt_results`, `attempt_alerts`, `attempt_conclusions`
  (`counsellor_login()`, `counsellor_client_ids()`, `counsellor_attempt_ids()`); every counsellor read of client data
  goes through RLS, and service-role writes check visibility first (`saveConclusion`). Counsellors add no clients.
- **Move clients** (Team, super admins; same as coordinators): all of a counsellor's clients go to another active
  counsellor (`move_counsellor_clients()`): access moves (old rows get `ended_at`, never deleted), upcoming booked
  presentations (booked, not done, slot not started) move to the new counsellor at the same date and time. When the
  new counsellor is not free at any of those times (`counsellor_move_clashes()`, via `counsellor_slots()`), nothing
  moves and the dialog lists the clashing presentations. Past presentations keep their counsellor. Logged in
  `counsellor_client_moves` (from, to, by, when, client and booking ids; never changed).
- **Make inactive** is refused with "Move their clients first." while a counsellor has clients or upcoming
  presentations (service and trigger `profiles_keep_counsellor_clients`). An inactive counsellor gets no bookings and
  sees nothing at once.

### Before the system (owner, 2026-11-21)

- No historical data: no "Record past presentation", CSV import, "Assign counsellor" or old-payment options. Old
  clients stay as they are; only purchases after go-live run the flow.
- Migrations `20261121700000_before_system.sql`, `20261121700001_before_system_planned.sql`,
  `20261121800000_admin_presentation_done.sql`; checks `docs/tasks/31-before-system-verify.sql` and
  `docs/tasks/32-admin-presentation-verify.sql`; behaviour tests `supabase/staging/staging-test-before-system.sql`
  and `staging-test-admin-presentation.sql` (rolled back).
- `before_system(purchases)` (also a column in the API): paid more than 7 days before go-live (`call_settings`); a
  try never paid: its latest try more than 7 days before go-live. Such a purchase never gets an automatic Payment,
  Assessment or Booking call (trigger `calls_before_system` on `calls`; open ones were closed with "Before the system:
  no automatic call."), plans nothing and is never due or late.
  Purchases shows "Before the system" as its stage; the journey shows "Before the system" on tasks 1–3.
- **Book presentation by hand** (owner decision 2026-11-21, `20261121900000_old_purchases_bookable.sql`): an old paid
  purchase with a completed assessment shows Book presentation in its side panel (the main button; super admins and
  the client's coordinator; same slots and rules as any booking). No Booking call is made for it. Once booked it is
  the normal flow: the counsellor marks it done, then the Package call and the offer.
- **Mark report presentation done** (super admins; for a presentation that already happened outside the system; side
  panel, task 4 of an old paid purchase with a completed assessment and no booking; `AdminPresentationDoneButton`, `presentation_mark_done_admin()`): the counsellor (the
  only active one pre-selected) and the date it happened (today by default, earlier allowed), no slot. Stored as a
  `presentation_bookings` row with `marked_by_admin`, `start_time / end_time` empty and `done_at` set, so everything
  after it is the normal flow with no special code: journey "Done · Marked by admin", the package offer in the client
  app (₹35,000 − ₹3,500 = ₹31,500), the Package call for the client's coordinator (due 2 working hours later),
  Razorpay and manual package payment, and the client assigned to that counsellor. **A presentation row may have no
  slot**: `start_time` is nullable everywhere (`presentationLabel` shows only the date).
- The package offer exists only once a report presentation is marked done (`package_offer()`, unchanged).
- **Go-live, once** (`supabase/go-live/assign-old-clients.sql`, pasted after every migration; it calls
  `go_live_assign_old_clients()`): every existing client (phone) and purchase gets the only active coordinator; every
  existing client with a paid assessment is assigned to the only active counsellor (`client_counsellors.at_go_live`),
  so the counsellor keeps seeing old reports. It stops and changes nothing unless there is exactly one active
  coordinator and one active counsellor. Not a migration: staging (two of each) never runs it.

### Counsellor flow (admin)

- Client → attempt (`/attempts/<id>`): super admins and counsellors see the **counsellor view** (alerts and
  the notes triggered by the client's answers at the top; plan and main area; each section's score, range,
  answered / skipped counts; notable answers, highest first; all answers grouped by section) and **Download
  PDF**, plus the client's typed **client details** below it (never in the PDF). Coordinators see the
  safety alerts only (RLS `can_view_reports()` on answers, results and client details).
- The counsellor view is computed from the pinned version, the stored answers and the stored result
  (`counsellorView` in `@mfb/questionnaire`); nothing is re-scored.
- **Counsellor's conclusion** (migration `20261105000000_attempt_conclusions.sql`, checks
  `docs/tasks/20-conclusions-verify.sql`): at the bottom of `/attempts/<id>`, super admins and counsellors
  write free text about a **completed** assessment and edit it at any time (plain text, up to 20,000
  characters, an empty line = new paragraph; `admin/lib/conclusion.ts`, `lib/services/conclusions.ts`). One
  row per attempt in `attempt_conclusions` with the first author and the last editor (name kept as it was);
  a save is refused when someone else saved in between. Never deleted (trigger). Read only under
  `can_view_reports()`; coordinators and clients never see it in the apps, never in any notification. **Printed
  last in the report PDF as "Overall Summary & Suggested Support Plan"**, always in English, also in a Hindi
  report (owner decisions 2026-11-06), so it is written for the client to read; left out when none is saved.
  Lines "• Label: text" print as bullets with a bold label; a short line above them as a subheading.
- **Draft with AI** (owner request 2026-11-06): a button on the conclusion fills the editor with a Google
  Gemini draft in English (about 250 words, addressed to the client as "you"), in the counsellors' own
  shape: a summary paragraph ("Your responses indicate…", concerns, context from the client's words,
  strengths) · "Suggested Support Plan" with 4–5 "Label: sentence" points · a closing paragraph (progress
  across the sessions; a fitting doctor's follow-up only when the client reported something physical or
  medical). The input is always English (a Hindi report is rebuilt in English for the AI only). Nothing is saved until the counsellor reads, edits and saves.
  Prompt, compact markdown input and answer format in `admin/lib/ai/conclusion-prompt.ts` (tests
  `admin/test/ai-conclusion.test.ts`), the call in `admin/lib/ai/gemini.ts` (Interactions API, plain fetch, `store: false`), the service in
  `lib/services/ai-conclusion.ts`. Sent: age, gender, relationship status, the report's areas / plan / focus,
  the top 12 answers, counsellor notes and the client-details answers. Never the name, phone, email, city or
  report ID; a crisis is sent only as "needs support first", home safety only as "individual sessions only".
  Env (admin, server only): `GEMINI_API_KEY` (billing-enabled project; unset = no button), optional
  `GEMINI_MODEL` (default `gemini-3.8-flash`; when busy it retries once on stable `gemini-3.6-flash`). Listed on
  /privacy as a service provider.
- **Assessments** (`/assessments`, sidebar, all staff): every attempt with its client, newest first; status
  chips (Paid, not started · In progress · Completed, plus **Needs conclusion** for super admins and
  counsellors), a test filter and search (name, mobile, email, report ID). Alerts show as pills; the
  conclusion column only for report roles. Opening a row shows what the role allows.
- Report PDFs are never stored: built on request by `admin/app/attempts/[id]/pdf/route.ts` with
  `@react-pdf/renderer` from the stored report, `Cache-Control: no-store`, file name = report ID. Six parts
  (cover · snapshot · plan · what sessions will work on · next step · overall summary & suggested support
  plan = the saved counsellor's conclusion, in English; empty parts left out), layout per
  `brand/MFB_Assessment_Report_Template_A4.pdf` in `admin/lib/report-pdf/`. Colours from
  `brand/mfb-tokens.json`, fonts from `admin/app/fonts`, logos from `admin/assets/report-pdf/`. Hindi PDFs
  use `NotoSansDevanagari-Regular.ttf` / `-Bold.ttf` (static, OFL, licence beside them) in `admin/app/fonts/`
  as a font LIST: Noto first, then DM Sans / Poppins for the Latin letters Noto lacks (name, report ID).
  Never set Hindi text in DM Sans or Poppins alone: DM Sans and Poppins-SemiBold have no Devanagari, and
  the PDF prints garbled letters (seen on 2026-11-06, before the font was added).
  Runtime files must live inside the app (`next.config.ts` traces them into the deployment).

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
- Report ranges are shown calmly, never red: a teal bar with the % and the range word.

### Type

- Headings: Poppins — H1 SemiBold 40–48px teal or ink; H2 SemiBold 28–32px teal; H3 Medium 20–22px ink.
- Body: DM Sans Regular 16–18px ink-soft; captions 13–14px ink-muted. Buttons: Poppins SemiBold 16px.
- Times: always 12-hour with am / pm, never 24-hour (owner, 2026-11-21): `hm()` / `slotRange()` in
  `admin/lib/availability.ts`, `hour12: true` in every `Intl` time format, `TimeSelect` instead of a native time input.
  A slot is shown as its whole range: "Sun, 22 Nov 2026, 9:00–9:30 pm" (`presentationLabel`, SQL `presentation_label`).
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
- Footer (apps and the report PDF): "Space to speak. · My Fit Brain". No "a unit of MeDa Partners" in the UI or
  the PDF (owner decision 2026-10-31). Only the policy pages (terms, privacy, refund, contact) name the company,
  as "operated by MeDa Partners Pvt Ltd", because the payment gateway requires it.

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
  Psychologist" (the report's DESIGNED_BY line). Every other credential still needs approval. Never claim she
  personally reviews or treats every case.
- Discretion: SMS, WhatsApp, email subjects, payment-gateway descriptor and all notifications say only
  "MFB Assessment". Never "Intimacy". Browser tab titles and page metadata stay generic ("My Fit Brain").
- Report text comes only from the version's JSON (titles, range names, meaning and focus lines, closing,
  disclaimer) plus the fixed headings and safety texts in `defaults.ts`. Never generate free text. The one
  exception is the last PDF part, the counsellor's saved conclusion (an AI draft only becomes text there after a
  counsellor saves it).

## Safety (never weaken)

- Under 18 → AGE_STOP screen at registration, end, no client record. The server (never only the browser) keeps
  a minimal record in `age_stops` (verified number, name typed, age entered, when; owner decision 2026-10-31,
  migration `20261031000004_age_stops.sql`) and flags the number's paid purchases refund needed. Nothing else
  from the form is saved. Admin → Under 18 (super admins, coordinators; RLS `can_view_payments()`) lists them;
  Payments shows "Under 18 · name" on their purchases.
- Crisis question = Yes → immediate calm support screen (Tele-MANAS 14416 / 1-800-891-4416, `tel:` links),
  `attempt_alerts` row for the team, report shows the support message first with no plan and no focus lines.
  Coordinator calls within 4 working hours (after 8 PM → by 10 AM next day).
- Home-safety question = Yes → `attempt_alerts` row; individual sessions only; counsellor sees it at the top
  (112 / 181).
- Counsellor `note`s on options are for the care team only, never printed. Flags never change the plan.

## Data and privacy

- Never collect or store free text from clients, with one exception approved by the owner (2026-10-27): the
  client-details answers at the end of an assessment (`attempt_details`, up to 1,000 characters, read only by
  super admins and counsellors, never in the report, the PDF or any notification). Nothing reads these
  texts automatically, except that "Draft with AI" sends them to Gemini when a counsellor presses it; a crisis can
  only be raised by the built-in safety question.
- Scoring runs server-side only. The browser submits option ids; the server loads the pinned version,
  scores, and writes results.
- Every attempt stores its questionnaire version.
- Secrets live in env vars or Supabase Vault. Never commit keys or put them in SQL or code comments.
- Nothing in UI, reports, metadata or code comments may contain a diagnosis name, medical claim, cure or
  guarantee word, price (outside payment), or an unapproved credential.
- DPDP (India) / GDPR: consent before health information; no marketing opt-in on the consent screen.
- Testing phase only: the Renflair API key sits in `20261013000001_renflair_sms_hook.sql`. The owner
  removes it before any push. Do not modify or flag it.

## Database rules

- Never edit an applied migration. Add a new timestamped file in `supabase/migrations/`.
- **Two databases** (`docs/deploy/staging.md`): production `tmifixelvfdtutsakwor` (real data) and staging
  `ndlqjmcpmkkulpinwbxe` (fake data only). Connection strings in `supabase/.env.db` (git-ignored; never print
  them, never pass them on a command line — the scripts hand them to Docker as environment variables).
- **Every database change** = a new file in `supabase/migrations/`, paste-ready (one `BEGIN … COMMIT`), plus
  a separate verification SQL file (`select` only). Then:
  1. **Staging: Claude applies it** — `powershell -File supabase/staging-migrate.ps1` (runs only the files
     staging does not have yet), and runs the verify file with `-Run <file>`. Anything may run on staging.
  2. **Production: Claude never connects to change anything.** Tell the owner exactly: "paste file X into the
     production SQL Editor" (in order), and add X under "To paste later, in order" in
     `docs/deploy/production-log.md`; move it to "Already on production" with the date once the owner
     confirms it ran.
- `PROD_DB_URL` is for read-only, schema-only exports (`supabase db dump`, no data) and nothing else. Never
  read production client data. No local database. Exception, run by the OWNER only: `supabase/prod-readonly.ps1`
  (read-only sessions) takes full backups into `D:\Tech\Meda\backups\` (outside the repo, never in git) and prints
  check files on production. Go-live steps: `docs/deploy/go-live-runbook.md`.
- Never delete data or write deleting SQL without asking first (see the permanent rule at the top).
- Gender, relationship status, staff roles and age limits come only from `lib/options.ts` in each app
  (stored values = English strings; labels via i18n).
- Every new table gets RLS in the same migration.
- Roles: `super_admin`, `coordinator`, `counsellor`. Counsellor-only data (answers, results) lives in tables
  clients and coordinators cannot read (`can_view_reports()`).
- Never trust client metadata for authorisation; check `profiles` / `clients` by `auth.uid()`.

## Do not touch without an explicit task

`admin/lib/auth.ts`, `clients/lib/phone.ts`, Supabase client helpers, existing RLS policies,
existing migrations, `.env*` files.

## Working conventions

- Windows + PowerShell. Stop dev servers before renaming or moving folders.
- Work on a branch per task; commit in small logical chunks with conventional messages.
- Install from the repo root (`npm install`); never add a lockfile inside an app. Root scripts:
  `dev:clients`, `dev:admin`, `build`, `lint`, `test`. Package: `npm run prompt -w @mfb/questionnaire`.
- Before finishing any task: `npm run lint` and `npm run build` pass in every app you touched, and
  `npm test` passes when a package changed.
- Deploy: two Vercel projects from this repository (Root Directory `clients` / `admin`, install
  `cd .. && npm ci`, include files outside the root). Full steps, env vars and checks:
  `docs/deploy/vercel.md`; a new Supabase project: `docs/deploy/new-supabase-project.md` (exact SQL order).
  Next.js 16 uses `proxy.ts` (the old `middleware.ts` name is deprecated).
- Security headers live in each app's `next.config.ts` (HSTS, nosniff, frame and permissions policy;
  admin also `noindex`). Local-network origins are trusted in development only.
- **Speed** (checked 2026-11-21): every Supabase call is a network trip (~300 ms from a developer's computer, even
  for a call that does nothing; a few ms when the Vercel function region is Mumbai `bom1`, next to the databases in
  `ap-south-1`). A page's time ≈ the number of trips that wait for one another, so:
  - start every read that does not need another read's result at the same time (`Promise.all`); a page should need
    about 3 waves: sign-in → the page's reads → names;
  - never `await` work the page does not show: `calls_sync()` runs with `after()` (a call that reaches its
    30 minutes shows on the next load; paid / completed / booked are instant through the triggers);
  - after a server action that calls `revalidatePath` for the current page, do not also call `router.refresh()`
    (it renders the whole page a second time). Keep `router.refresh()` only after `fetch` to an API route.

## Status

- Done: Phase 1 (phone OTP via Renflair Auth hook, clients and staff tables with RLS, admin client
  management, coordinator provisioning, bilingual EN/HI UI); folder rename `app/` → `clients/`; brand kit;
  task 01 UI rebrand (`docs/rebrand-audit.md`); task 02 foundation fixes (`docs/tasks/02-findings.md`);
  Razorpay payments (`20261020000000_payments.sql`, checks `docs/tasks/08-payments-verify.sql`); admin
  Payments page (`20261022000000_payments_access.sql`); SMS hook v2 (`20261023000000_sms_hook_v2.sql`,
  debugging `docs/tasks/09-sms-hook-verify.sql`).
- Done: **Task 11 — simple questionnaire system** (`docs/tasks/11-simple-questionnaire-system.md`). Replaces
  tasks 03–06, 08 (question bank), 09 and 10. Run `20261026000000_reset_question_bank.sql` (one-time reset,
  deletes the old question bank and test data — read its header) then `20261026000001_questionnaires.sql`;
  checks `docs/tasks/11-verify.sql`; then import `docs/questionnaires/intimacy.json` and `mind.json` from
  Admin → Questionnaires and publish.
- Open (payments task): GST invoice numbering, its own gap-free series per financial year.
- Done: Hindi PDF font files (`NotoSansDevanagari-*.ttf`) in `admin/app/fonts/` (2026-11-06).
- Open: Intimacy 2.0 workbook (the starting draft comes from v1.1).
- Done: **Client details** (typed answers after the safety questions). Run
  `20261027000000_client_details.sql`, checks `docs/tasks/12-client-details-verify.sql`; then set the list
  in Admin → Questionnaires (or import + publish `intimacy.json`, which carries the six Intimacy questions).
- Done: **Pay first, log in later** (`/pay/<code>`, purchases owned by a phone, claim at login, Start
  creates the attempt). Run `20261031000000_pay_first.sql`, checks `docs/tasks/13-pay-first-verify.sql`.
- Launch cleanup (owner request 2026-10-31, one time): `docs/tasks/17-launch-cleanup.sql` deletes all test
  payments, assessments, clients, under-18 records, coordinators, counsellors and their logins; questionnaires
  and super admins are kept. Checks `docs/tasks/17-launch-cleanup-verify.sql`. Not a migration; never rerun.
- Done: **Offline payments with proof** and proof storage in a Google Shared Drive. Run
  `20261103000000_offline_payments.sql` (replaces the CHECK rules on `payments.provider` / `payments.status` with
  wider ones, owner-approved 2026-11-03; no data removed), then `20261103000001_drop_google_drive_connection.sql`
  (drops only the unused OAuth token table, owner-approved for that step only), checks
  `docs/tasks/18-offline-payments-verify.sql`; then set the three `GOOGLE_*` service-account variables.
- Done: **Staging database** (2026-11-04): built from a schema-only export of production
  (`supabase/baseline/`), all 22 migrations recorded, fake data from `supabase/seed-staging.sql`. Dashboard
  settings still to copy by hand: checklist in `docs/deploy/staging.md`. Files on production:
  `docs/deploy/production-log.md`.
- Done: **Counsellor's conclusion and the Assessments page** (`20261105000000_attempt_conclusions.sql`, on
  production 2026-11-05; checks `docs/tasks/20-conclusions-verify.sql`).
- Set aside on 2026-11-20 (owner decision): Task 12 (Gold journey FMS) and Task 13 (coordinator orders). Never on
  production; removed from staging; the code is only in local branch `archive/fms-2026-11-20` and
  `D:\Tech\Meda\mfb-backup-2026-11-20.bundle`. Do not reuse it unless the owner asks.
- Done: Next.js 16.4.6 in both apps (security advisory on 16.4.2), on `main` 2026-11-20.
- Next: Task 07 — polish.
