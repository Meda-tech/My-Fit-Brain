# MFB UI Rebrand — Audit (Task 01)

Date: 2026-10-14 · Branch: `mfb-ui-rebrand`

## 1. Starting state (before the rebrand)

### Old palette hex values
Only in the old token files (no component used raw hex):

| File | Hits |
|---|---|
| `admin/app/tokens.css` | 11 lines (plum, magenta, gold, neutrals, `#2E7D5B` success, band colours, gradients) |
| `clients/app/tokens.css` | 11 lines (identical copy of the admin file) |

### Old token names / classes in components
Every UI file used `var(--…)` arbitrary Tailwind values built on the old tokens (`--page-bg`, `--surface`,
`--text`, `--text-2`, `--text-muted`, `--border`, `--plum-*`, `--magenta-*`, `--gold-*`, `--band-*`,
`--r-md`, `--r-lg`, `--r-pill`, `--el-1`, `--fw-*`, `--font-display`, `--heading`, `--accent-text`, `--focus`,
`--success`, `--alert`, `--n-*`) plus the old global classes `btn`, `btn-primary`, `btn-secondary`,
`btn-text`, `overline`, `notice-medical`.

| File | Approx. hits |
|---|---|
| `admin/app/layout.tsx` | 2 |
| `admin/components/AdminHeader.tsx` | 28 |
| `admin/app/login/page.tsx` | 46 |
| `admin/app/bootstrap/page.tsx` | 75 |
| `admin/app/dashboard/page.tsx` | 107 |
| `admin/app/clients/page.tsx` | 70 |
| `admin/app/clients/[id]/page.tsx` | 72 |
| `admin/app/clients/new/page.tsx` | 7 |
| `admin/app/clients/new/CreateClientForm.tsx` | 94 |
| `admin/app/coordinators/page.tsx` | 1 |
| `admin/app/coordinators/CoordinatorListClient.tsx` | 115 |
| `clients/app/layout.tsx` | 2 |
| `clients/components/ClientHeader.tsx` | 9 |
| `clients/components/LanguageToggle.tsx` | 15 |
| `clients/app/ClientHomeView.tsx` | 41 |
| `clients/app/login/ClientLoginFlow.tsx` | 61 |
| `clients/app/register/RegisterClientWrapper.tsx` | 1 |
| `clients/app/register/RegisterForm.tsx` | 78 |

### Old fonts, old lines, old design system
- Playfair Display + Inter + Material Symbols: Google Fonts `@import` in both `app/tokens.css`;
  `--font-display` / `--font-body` used by every heading.
- "Science with a human touch": `clients/lib/i18n.ts` (EN + HI "मानवीय स्पर्श के साथ विज्ञान।"),
  `clients/app/layout.tsx` metadata, `admin/app/dashboard/page.tsx`, `README.md`.
- "We Care For Your Emotions": no hits.
- `DR_NEHA_MEHTA_ANTIGRAVITY_DESIGN_SYSTEM.md`: referenced in `README.md` only; the file itself is not in
  the repo.
- `.agents/`: holds only the Supabase skills (`supabase`, `supabase-postgres-best-practices`). Nothing about
  the old design system, so nothing to rewrite.
- `drnehamehta` (domain/email): `admin/app/login/page.tsx` placeholder,
  `admin/app/coordinators/CoordinatorListClient.tsx` placeholder, `admin/app/bootstrap/page.tsx` default
  email, `README.md`, `SUPABASE_SETUP_GUIDE.md`, `supabase/seed.sql`.

### "Dr Neha" / "Neha Mehta" strings

| Location | Use | Action |
|---|---|---|
| `clients/app/layout.tsx` title | brand | REPLACE |
| `admin/app/layout.tsx` title | brand | REPLACE |
| `clients/components/ClientHeader.tsx` aria-label + alt | brand | REPLACE |
| `admin/components/AdminHeader.tsx` aria-label + alt | brand | REPLACE |
| `admin/app/login/page.tsx` alt + body copy | brand | REPLACE |
| `admin/app/bootstrap/page.tsx` logo alt | brand | REPLACE |
| `admin/app/bootstrap/page.tsx` default full name `Dr Neha Mehta` | person (super admin) | KEEP — Next task |
| `clients/lib/i18n.ts` `brand.name` EN + HI | brand | REPLACE |
| `admin/app/tokens.css`, `clients/app/tokens.css` header comment | brand | REPLACE (file deleted) |
| `README.md` title + intro | brand | REPLACE |
| `SUPABASE_SETUP_GUIDE.md` title + SMS template + domains | brand / env | Next task |
| `supabase/seed.sql` | bootstrap person/email | Next task |
| `supabase/migrations/20261013000000_phase1_init.sql` header comment | brand | KEEP — applied migration, never edited |

No "Founded by" / "Designed by" endorsement existed yet.

### Old logo, favicon, OG files
- Both apps referenced `/logo.png`, which does not exist in either `public/` (broken image).
- `admin/app/favicon.ico`, `clients/app/favicon.ico`: Next.js default favicon.
- `admin/public/`, `clients/public/`: create-next-app samples `file.svg`, `globe.svg`, `next.svg`,
  `vercel.svg`, `window.svg` (unused).
- No OG images.

### Leftover `app/` folder references
- `clients/package.json` + `package-lock.json` name `"app"`.
- `README.md`: `/app` section, `cd app`, `cd ../app`, swapped dev ports.
- `SUPABASE_SETUP_GUIDE.md`: `/app` in headings, Vercel "Root Directory `app`".

## 2. Logo files in `brand/01_Logo/SVG/`

| Version | Folder | Full colour | Reverse | Mono teal | Black | White | viewBox |
|---|---|---|---|---|---|---|---|
| Horizontal | `Horizontal/` | `MFB_Horizontal_FullColour.svg` | `MFB_Horizontal_Reverse.svg` | `MFB_Horizontal_MonoTeal.svg` | `MFB_Horizontal_Black.svg` | `MFB_Horizontal_White.svg` | 410.93 × 153.5 |
| Horizontal + tagline | `Horizontal_Tagline/` | `MFB_Horizontal_Tagline_FullColour.svg` | `…_Reverse.svg` | `…_MonoTeal.svg` | `…_Black.svg` | `…_White.svg` | 410.93 × 153.5 |
| Stacked | `Stacked/` | `MFB_Stacked_FullColour.svg` | `…_Reverse.svg` | `…_MonoTeal.svg` | `…_Black.svg` | `…_White.svg` | 291.43 × 226 |
| Stacked + tagline | `Stacked_Tagline/` | `MFB_Stacked_Tagline_FullColour.svg` | `…_Reverse.svg` | `…_MonoTeal.svg` | `…_Black.svg` | `…_White.svg` | 291.43 × 250 |
| Icon | `Icon/` | `MFB_Icon_FullColour.svg` | `…_Reverse.svg` | `…_MonoTeal.svg` | `…_Black.svg` | `…_White.svg` | 156 × 156 |
| Endorsed | `Endorsed_FoundedBy/` | `MFB_Endorsed_FoundedBy_FullColour.svg` | `…_Reverse.svg` | `…_MonoTeal.svg` | `…_Black.svg` | `…_White.svg` | 410.93 × 153.5 |
| Founder seal | `Founder_Seal/` | `MFB_Founder_Seal_FullColour.svg` | `…_Reverse.svg` | `…_MonoTeal.svg` | `…_Black.svg` | `…_White.svg` | 300 × 300 |

Also present: `Service_Lines/` (`MFB_Assessments_*`, `MFB_Corporate_*`, `MFB_Couples_*`,
`MFB_Intimacy_Wellness_*`, `MFB_Teens_*`, FullColour + Reverse only). Not used in this task.
All 35 version × colour combinations exist, so the `Logo` component needs no fallbacks.

Copied into the apps (only what is rendered):
- `clients/public/brand/logo/`: `MFB_Horizontal_FullColour.svg`
- `admin/public/brand/logo/`: `MFB_Horizontal_FullColour.svg`, `MFB_Horizontal_Reverse.svg`, `MFB_Icon_Reverse.svg`

## 3. What changed

### Both apps
- `styles/mfb-tokens.css`: exact copy of `brand/mfb-tokens.css`.
- `app/fonts/`: Poppins Regular/Medium/SemiBold/Bold and DM Sans Regular/Medium/Bold TTF from `brand/fonts/`.
- `app/fonts.ts`: `next/font/local`, `display: 'swap'`, variables `--font-poppins` and `--font-dm-sans`
  (set on `<html>`).
- `app/globals.css`: Noto Serif/Sans Devanagari Google Fonts import (the existing Hindi loader, kept),
  then `tailwindcss`, then `../styles/mfb-tokens.css`. The `@theme` block from the brief, with
  `--color-*: initial` first so only brand colours exist as utilities (plus `white`). It also adds
  `--font-heading-hi` / `--font-body-hi`. Base styles: cream body, ink DM Sans 16px, Poppins h1–h3
  (h1/h2 teal SemiBold, h3 ink Medium), 2px coral focus ring with offset, mist selection. The `:lang(hi)`
  rule is kept: Noto families and 1.15× line-height.
- `app/layout.tsx`: metadata (titles below), icons, `manifest: /manifest.webmanifest`,
  `viewport.themeColor` `#145A5A`.
- `public/`: `favicon.ico`, `apple-touch-icon-180.png`, `android-chrome-192.png`, `android-chrome-512.png`
  and `manifest.webmanifest` (name "My Fit Brain", theme `#145A5A`, background `#FBF7F2`).
- `components/brand/` (identical in both apps): `Logo`, `Button` (+ `ButtonLink`, `buttonClasses`),
  `Card`, `Pill` (`mist` default, `quiet` for neutral states), `BinduDot`, `Notice` (`info`, `medical`,
  plus a calm `error` variant: white, sand border, coral-deep left rule, no red), `Footer`, `form.ts`
  (shared input/label classes, 8px inputs), `cn.ts`.
- Footer on every screen: "Space to speak. · My Fit Brain, a unit of MeDa Partners Pvt Ltd".

### `clients/` (title "My Fit Brain")
- Header: 56px sticky, white, horizontal full-colour logo left, `EN | हिं` toggle right (selected = mist
  bg + teal text, 44px tall), sign-out as a ghost button.
- Login/OTP, register, home: Card + BinduDot + Pill eyebrow, one Coral Deep primary per screen, ghost
  secondary actions, Notice for info, errors and the "what happens next" note. Page wrappers now carry
  `lang={lang}`, so the Hindi font and line-height apply when `हिं` is chosen. Before this they never did.
- New `app/not-found.tsx` (branded 404). Note: middleware redirects unknown routes to `/login` for
  signed-out users, so it shows only to signed-in clients.
- i18n (EN + HI): brand name "My Fit Brain"; tagline "Space to speak." (English in HI too); added
  `brand.endorsement` "Designed by Dr. Neha Mehta" (not rendered yet); calmer copy ("Your information stays
  private.", "qualified counsellor" instead of "psychologist", no "clinical", no "Phase 2" promise).
- `package.json` name `app` → `clients`.

### `admin/` (title "My Fit Brain · Staff")
- Header: 56px sticky Teal Night bar, horizontal reverse logo (icon reverse below 640px), white nav
  links, active item mist bg + teal text (`components/AdminNav.tsx`, client component using
  `usePathname`). Nav now shows on mobile too (scrolls sideways). Role caption in mist, sign-out ghost on
  dark. Dark footer.
- Login + bootstrap: white header with full-colour horizontal logo + Pill (`components/PublicHeader.tsx`).
- Dashboard metric cards: white cards, mist icon tiles, teal icons and numbers. Tables: cream header row,
  sand dividers, mist hover.
- Status badges: "Verified & Linked" = mist + teal Pill; "Pending First Login" = cream + sand + ink-soft
  Pill (dashboard and list said "Linked" before; they now use the same wording as the detail page).
  Coordinator "Inactive" no longer red (quiet Pill).
- One primary per screen: empty-state "Create…/Add first…" buttons are now secondary. Modal overlays use
  `night/40`.
- Placeholders `name@drnehamehta.com` / `coordinator@drnehamehta.com` → `@example.com`.
- **Outside UI scope (type-only):** `app/clients/actions.ts` and `lib/services/clients.ts` already had 4
  `no-explicit-any` lint errors before this task, so `npm run lint` failed. I replaced `any` with
  `Gender` / `MaritalStatus` / a row type. There is no runtime change: same queries, same values.

### Root
- `README.md` rewritten for MFB with the correct folders (`/clients`, `cd clients`) and dev ports.
- `SUPABASE_SETUP_GUIDE.md`: folder references `/app` → `/clients`, Vercel root directory `clients`.
- `CLAUDE.md`: Status updated; "Logo files" note added under Logo.

## 4. Files deleted
- `admin/app/tokens.css`, `clients/app/tokens.css` (old design tokens + Playfair/Inter/Material Symbols).
- `admin/app/favicon.ico`, `clients/app/favicon.ico` (Next.js default; replaced by `public/favicon.ico`).
- `admin/public/{file,globe,next,vercel,window}.svg`, same in `clients/public/` (create-next-app samples, unused).
- No old logo/OG files existed (`/logo.png` was referenced but missing). No old design-system markdown
  file existed. No old font packages were installed (fonts came from a CSS `@import`), so no dependencies
  were removed.

## 5. Verification (2026-10-14)
- `npm run lint` and `npm run build`: pass in both apps (0 errors, 0 warnings).
- Old hex values, old token names, Playfair, Inter, Material Symbols: 0 hits in `admin/` and `clients/`
  outside `docs/`.
- Raw hex in `.ts/.tsx`: only `viewport.themeColor: "#145A5A"` in each `app/layout.tsx`. Step 3 of the
  brief requires that value, and Next.js needs a literal there.
- Contrast (WCAG): ink/cream 13.98, ink-soft/white 8.53, ink-soft/mist 7.47, ink-muted/white 4.97,
  ink-muted/cream 4.66, teal/white 7.96, teal/mist 6.97, white/coral-deep 4.94, white/teal 7.96,
  white/night 11.19, mist/night 9.80, coral-deep/white 4.94 (used for small error text and required
  marks). ink-muted/mist is 4.35, so labels on mist use ink-soft instead. Bindu Coral (2.97 on white)
  is used only for the dot and the focus ring, never for text or buttons.
- Dev servers (`:3000` clients, `:3001` admin; already running from these folders, so I did not start
  or stop them): `/login` 200 on both, `/bootstrap` 200, `/` → 307 `/login` when signed out. Served HTML
  has the new titles, manifest, `theme-color #145A5A`, MFB logo and footer. Served CSS has 7 `@font-face`
  rules (Poppins 400/500/600/700, DM Sans 400/500/700), `--font-poppins` / `--font-dm-sans`, the brand
  utilities, and both `:lang(hi)` rules with Noto Serif/Sans Devanagari.
- Hindi: login/register/home wrappers render `lang={lang}`, and the `:lang(hi)` rules are in the served
  CSS. Not checked visually in a browser.

## 6. Could not do / notes
- **Git layout.** The root was not a git repo, and `admin/` and `clients/` each had their own nested repo
  (only the create-next-app commit, no remote). I created a root repo with `.gitignore` (excludes `.env*`,
  `node_modules`, `.next`), but it records `admin/` and `clients/` only as nested-repo pointers. App work
  is committed inside each nested repo on branch `mfb-ui-rebrand`. Folding them into one repo means
  removing or moving `admin/.git` and `clients/.git`. That needs an owner decision.
- The brief file is at the repo root (`01-ui-rebrand.md`), not in `docs/tasks/` as CLAUDE.md describes.
- CLAUDE.md lists question banks as `…_v1_1_1.xlsx` / `…_v1_0_1.xlsx`; the real names are
  `…_v1.1_1.xlsx` / `…_v1.0_1.xlsx`.
- Endorsement and tagline logos are not used yet. No screen in this phase needs them (test selection,
  payment and report don't exist yet).

## 7. Waiting on assets
- None. All 7 versions × 5 treatments exist in `brand/01_Logo/SVG/`.
- Report band colours are PROPOSED and pending clinical/brand sign-off.

## 8. Next task
- **Bootstrap super admin.** `admin/app/bootstrap/page.tsx` defaults (`Dr Neha Mehta`,
  `superadmin@drnehamehta.com`), `supabase/seed.sql` and `SUPABASE_SETUP_GUIDE.md` still use the old
  email. Not changed, as the brief instructs.
- **Env / domains.** `SUPABASE_SETUP_GUIDE.md` env tables and Vercel domains still say
  `admin.drnehamehta.com` / `app.drnehamehta.com`; move to `admin.myfitbrain.app` / `app.myfitbrain.app`.
  Check `.env.local` / Vercel `NEXT_PUBLIC_*_URL` values (not read or changed here).
- **SMS template.** The setup guide's OTP text "Your Dr Neha Mehta verification code…" breaks the
  discretion rule. It should say only "MFB Assessment". Fix it with the Vault SMS key migration.
- **Migration.** Gender options (DB/type has `Other`, the rule says "Prefer not to say"), relationship
  status (`marital_status` lacks "In a relationship" and "Engaged", has `Other`), counsellor role, Vault
  SMS key.
- **Registration form.** Apply the new gender/relationship options; under-18 → AGE_STOP screen (today it
  shows an inline error); localise the hard-coded English error strings in `RegisterForm.tsx`.
- `SUPABASE_SETUP_GUIDE.md` title and intro still use the old brand. Update them with the domain switch.
- Next.js warns that `middleware.ts` is deprecated in favour of `proxy`. It needs its own task, because
  the middleware touches auth.
