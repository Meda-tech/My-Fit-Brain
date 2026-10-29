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
owner first and getting a yes for that specific file. The one-time reset of Task 11 (file
`20261026000000_reset_question_bank.sql`) was allowed once and is over. Every SQL file that would remove
something must say so in plain words at its top. Verification SQL is `select` only.

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
│  ├─ deploy/                 vercel.md (two Vercel projects), new-supabase-project.md (exact SQL order)
│  ├─ tasks/                  task briefs, findings and verify SQL per task
│  └─ rebrand-audit.md        produced by task 01
└─ supabase/migrations/       paste-ready SQL, one BEGIN … COMMIT per file (never edit an applied one)
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
| `clients/` | OTP login, registration, test choice, payment, assessment, thank-you | `https://app.myfitbrain.app` | 3000 |
| `admin/` | Super admin, coordinators, counsellors | `https://admin.myfitbrain.app` | 3001 |

- The folder is `clients/`; the public subdomain stays `app.`.
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
- Any new questionnaire = one row in `questionnaires` (code, names, report prefix; Admin → Questionnaires →
  New questionnaire) plus its JSON versions. No code change.
- Each costs ₹3,500 and includes the assessment and one consultation. No price anywhere except the payment
  step and the client's own payment receipt (completed screen: amount paid, date, method, Razorpay ID).
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
  version back for editing. Super admins and coordinators import and publish; counsellors read.
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
  any time (super admins, coordinators), and it applies at once, also to running assessments. Each answer
  is stored in `attempt_details` with a copy of the question as it was asked. The JSON may carry an optional
  `client_details` list; publishing a version that has one replaces the questionnaire's list, and Copy JSON
  includes the current list.
- Clients read questionnaire names and their own attempt rows; never definitions, answers or results (RLS).
- Registration already asks age, gender and relationship status; questionnaires never ask them again. Age
  under 18 is stopped at registration.

## Client flow

Phone OTP login → registration (name, gender, age, relationship status, city, state, email; under 18 →
AGE_STOP, save nothing) → choose test (live questionnaires) → payment ₹3,500 → report ID assigned on payment
success → one-line consent → one question per screen, in the order of the JSON → built-in safety questions →
client details (typed, required; the questionnaire's current list) → submit ("nothing can be changed after this") → thank-you screen ("Your counsellor will go through your
results with you"). The client never sees a report in the app.

- Every answer is saved at once (`attempt_answers`); the server decides the next question from the stored
  answers and the pinned version. Changing a routing answer clears answers to questions that are no longer
  shown. Back reopens the previous visible question. Client details are saved at once too
  (`attempt_details`); Back from the first one returns to the last safety question.
- Single choice = cards; options with `value: null` ("Not applicable", "Unsure") = smaller secondary buttons;
  multiple choice = checkboxes with `max_choices`.
- The report is built once at submit, in the language the client was using (EN / हिं toggle), and stored in
  `attempt_results.report` with the engine result. Never re-scored or rebuilt for display.
- URLs and titles carry no test name: `/payment/<code>`, `/assessment/<uuid>`.
- Client app shell: `components/PageChrome.tsx` = sticky header + bottom tab bar (`BottomNav`: Home `/`,
  Profile `/profile`). Payment and assessment screens hide the tab bar. Sign out lives on Profile. Home
  lists the client's assessments: unfinished → Continue; completed → View details (thank-you + receipt).
- Public policy pages (no sign-in, required by Razorpay; English only; listed in `lib/legal.ts`, skipped by
  `proxy.ts`): /pricing, /terms, /privacy, /refund-policy (no refunds, no cancellations), /contact. Business
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
  when the browser never returns. One payment → one attempt, created only through
  `public.create_paid_attempt()` (per-payment advisory lock; the report number and the insert in one
  transaction, so report IDs have no gaps even when verify and webhook race). Never call `next_report_id()`
  separately from the insert.
- Admin → Payments (`/payments`): super admins and coordinators only (nav, page guard and RLS
  `can_view_payments()`); counsellors never see payments.
- Report IDs identify assessments; they are **not** GST invoice numbers (open: a gap-free invoice series per
  financial year, April–March, for paid payments only). Checkout name/description: "My Fit Brain" / "MFB
  Assessment" only. Keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (server-side
  env only). No stub or test switch exists in code.
- Auth in the clients app uses `supabase.auth.getClaims()` (`proxy.ts` → `lib/supabase/middleware.ts`, and
  `lib/auth.ts` `getAuthUser()`), which verifies the token locally with asymmetric JWT signing keys.

### Counsellor flow (admin)

- Client → attempt (`/attempts/<id>`): super admins and counsellors see the **counsellor view** (alerts and
  the notes triggered by the client's answers at the top; plan and main area; each section's score, range,
  answered / skipped counts; notable answers, highest first; all answers grouped by section) and **Download
  PDF**, plus the client's typed **client details** below it (never in the PDF). Coordinators see the
  safety alerts only (RLS `can_view_reports()` on answers, results and client details).
- The counsellor view is computed from the pinned version, the stored answers and the stored result
  (`counsellorView` in `@mfb/questionnaire`); nothing is re-scored.
- Report PDFs are never stored: built on request by `admin/app/attempts/[id]/pdf/route.ts` with
  `@react-pdf/renderer` from the stored report, `Cache-Control: no-store`, file name = report ID. Five parts
  (cover · snapshot · plan · what sessions will work on · next step; empty parts left out), layout per
  `brand/MFB_Assessment_Report_Template_A4.pdf` in `admin/lib/report-pdf/`. Colours from
  `brand/mfb-tokens.json`, fonts from `admin/app/fonts`, logos from `admin/assets/report-pdf/`. Hindi PDFs
  need `NotoSansDevanagari-Regular.ttf` / `-Bold.ttf` (OFL) in `admin/app/fonts/` — registered when present.
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
  Psychologist" (the report's DESIGNED_BY line). Every other credential still needs approval. Never claim she
  personally reviews or treats every case.
- Discretion: SMS, WhatsApp, email subjects, payment-gateway descriptor and all notifications say only
  "MFB Assessment". Never "Intimacy". Browser tab titles and page metadata stay generic ("My Fit Brain").
- Report text comes only from the version's JSON (titles, range names, meaning and focus lines, closing,
  disclaimer) plus the fixed headings and safety texts in `defaults.ts`. Never generate free text.

## Safety (never weaken)

- Under 18 → AGE_STOP screen at registration, end, save nothing.
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
  texts automatically; a crisis can only be raised by the built-in safety question.
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
- The owner runs SQL in the Supabase dashboard SQL Editor. Write migrations paste-ready (one
  `BEGIN … COMMIT`), plus a separate verification SQL file (`select` only). Do not apply them or start a
  local database. Always list which files to run, in order.
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
- Open: Hindi PDF font files (`NotoSansDevanagari-*.ttf`) in `admin/app/fonts/`; Intimacy 2.0 workbook (the
  starting draft comes from v1.1).
- Done: **Client details** (typed answers after the safety questions). Run
  `20261027000000_client_details.sql`, checks `docs/tasks/12-client-details-verify.sql`; then set the list
  in Admin → Questionnaires (or import + publish `intimacy.json`, which carries the six Intimacy questions).
- Next: Task 07 — polish.
