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
├─ .agents/                   points to CLAUDE.md only
├─ admin/                     Next.js app — staff portal
├─ clients/                   Next.js app — client portal (renamed from app/)
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
│  │  ├─ MFB_Intimacy_Assessment_QuestionBank_v1_1_1.xlsx
│  │  └─ MFB_Mind_Assessment_QuestionBank_v1_0_1.xlsx
│  ├─ tasks/                  task briefs (01-ui-rebrand.md, …)
│  └─ rebrand-audit.md        produced by task 01
└─ supabase/                  shared migrations and config
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
| `docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v1_1_1.xlsx` | Every Intimacy item, routing rule, score rule and text |
| `docs/questionbank/MFB_Mind_Assessment_QuestionBank_v1_0_1.xlsx` | Every Mind item, routing rule, score rule and text |
| `brand/MFB_Brand_Guidelines_v1.pdf` | Logo use, colour, type, voice, photography |
| `brand/MFB_Assessment_Report_Template_A4.pdf` | Report PDF layout |

If the spec and an Excel file differ, the Excel file wins. Never invent questions, scoring rules or report
text. If something is not covered, stop and ask rather than guess.

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
- Each costs ₹3,500 and includes the assessment, the report and one consultation. No price anywhere
  except the payment step. Progress re-tests are included, never charged.
- Display line under each name: "Designed by Dr. Neha Mehta".
- One person per assessment. A partner takes and pays for their own; reports are never linked.
- One engine, two configurations. Question banks are versioned DB config imported from the Excel
  files. Never hard-code questions or texts. A future test must need only a new Excel file plus its
  routing rules.

## Client flow

Phone OTP login → registration (name, gender, age, relationship status, city, state, email;
under 18 → AGE_STOP, save nothing) → choose test → payment ₹3,500 → ID assigned on payment success
→ one-line consent → remaining intake → gate (max 2) → core → modules → dose → flags → report.

- Registration age → I1 / MI1 band. Registration gender → I2 / MI2. Never ask twice.
- Gender options: Male / Female / Prefer not to say.
- Relationship options (I3): Single / In a relationship / Engaged / Married / Separated / Divorced / Widowed.
- Answers save as they are given so the client can resume. Changing a routing answer clears answers
  from paths that are no longer visible.

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
- "Founded by Dr. Neha Mehta" / "Designed by Dr. Neha Mehta" only. Never claim she personally reviews or
  treats every case.
- Discretion: SMS, WhatsApp, email subjects, payment-gateway descriptor and all notifications say only
  "MFB Assessment". Never "Intimacy". Browser tab titles and page metadata stay generic ("My Fit Brain").
- Report text comes only from the Excel Report Text and Strengths & Stuck tabs. Never generate free text.

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
- Report PDFs: private Storage bucket, file name = report ID, short-lived signed URLs.
- Secrets live in env vars or Supabase Vault. Never commit keys or put them in SQL or code comments.
- Nothing in UI, reports, metadata or code comments may contain a diagnosis name, medical claim, cure or
  guarantee word, price (outside payment), or an unapproved credential.
- DPDP (India) / GDPR: consent before health information; no marketing opt-in on the consent screen.

## Database rules

- Never edit an applied migration. Add a new timestamped file in `supabase/migrations/`.
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
- Before finishing any task: `npm run lint` and `npm run build` pass in every app you touched.

## Status

- Phase 1 done: phone OTP via Renflair Auth hook, clients and staff tables with RLS, admin client
  management, coordinator provisioning, bilingual EN/HI UI.
- Done: folder rename `app/` → `clients/`; brand kit and docs added to the repo.
- Done: task 01 UI rebrand (MFB tokens, Poppins/DM Sans, brand primitives in `components/brand/`,
  both apps restyled). See `docs/rebrand-audit.md` for details and follow-ups.
- Next: migration (gender, relationship status, counsellor role, Vault SMS key), registration fixes,
  domain switch to myfitbrain.app, then Phase 2 (question-bank import, engine, flow, report, payments,
  safety ops, progress tests).
