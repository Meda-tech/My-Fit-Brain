# Task 01 — Rebrand the UI of `clients/` and `admin/` to My Fit Brain

Work autonomously through every step below. Do not stop to ask for approval unless a step says so or
something would break auth, data or the build. Scope is UI and theme ONLY: do not change auth logic,
server actions, Supabase queries, RLS or migrations in this task.

## Step 0 — Prepare

1. Read `CLAUDE.md` fully. It is the rulebook for this task.
2. Read everything in `.agents/`. If any file there describes the old Dr Neha Mehta design system
   (plum, magenta, gold, Playfair Display, Inter, "Science with a human touch"), rewrite it so it only
   says: "Project rules live in CLAUDE.md at the repo root. Follow them." Do not delete the folder.
3. Create a branch: `git checkout -b mfb-ui-rebrand`. Commit the current state first if the tree is dirty
   (`chore: snapshot before MFB UI rebrand`).
4. Detect each app's structure (App Router at `<app>/app/` or `<app>/src/app/`, where `globals.css` and the
   root `layout.tsx` live, where `lib/` and `components/` live). Use the real paths in every step below.
5. The `app/` → `clients/` rename is already done. Search the repo (excluding node_modules and .next) for
   leftover references to the old folder (`app/` as a project folder, `../app`, `cd app`, workspace or
   script entries) in package.json files, README.md, SUPABASE_SETUP_GUIDE.md and configs. Fix them.

## Step 1 — Audit (write it down, then continue)

Create `docs/rebrand-audit.md` listing:
- Every file using the old palette. Search for these hex values (case-insensitive):
  `4A1431 5E1B3F 75224E E6D3DC F3E8EE C2365F D43F6E FCE8EF 8A7A45 B4A268 F7F4EA F5F7F8 1F1F1F 374151 6B7280 D1D5DB 2E7D5B`
- Every use of the old token names: `--plum-* --magenta-* --gold-* --page-bg --surface --text --text-2
  --text-muted --border --band-* --r-md --r-lg --r-pill` and any Tailwind classes built on them.
- Every reference to Playfair Display, Inter, `drnehamehta`, "Science with a human touch",
  "We Care For Your Emotions", and the old design-system markdown.
- Every "Dr Neha" / "Neha Mehta" string, marked as REPLACE (used as the brand) or KEEP
  (a "Founded by Dr. Neha Mehta" / "Designed by Dr. Neha Mehta" endorsement).
- Old logo, favicon and OG image files in each app's `public/`.

## Step 2 — Install brand assets into both apps

For EACH of `clients/` and `admin/`:
1. Copy `brand/mfb-tokens.css` → `<app>/styles/mfb-tokens.css` (create `styles/` if needed).
2. Copy `brand/fonts/*.ttf` → `<app>/app/fonts/` (or `src/app/fonts/`).
3. List `brand/01_Logo/SVG/` and record the real file names in the audit (version × colour). Copy only
   the SVGs the app uses (see the logo table in CLAUDE.md) → `<app>/public/brand/logo/`.
4. Copy `brand/favicon.ico`, `brand/apple-touch-icon-180.png`, `brand/android-chrome-192.png`,
   `brand/android-chrome-512.png` → `<app>/public/`. Remove old favicon/icon files those replace.
   If the app uses `app/favicon.ico` or `app/icon.*` file conventions, replace those too.
5. Add a `manifest.webmanifest` (name "My Fit Brain", theme_color `#145A5A`,
   background_color `#FBF7F2`, the two android-chrome icons).

## Step 3 — Fonts

In each root `layout.tsx`:
- Remove `Playfair_Display` and `Inter` imports and every class or variable that uses them.
- Load with `next/font/local`, `display: 'swap'`:
  - Poppins 400/500/600/700 from the local TTFs → CSS variable `--font-poppins`
  - DM Sans 400/500/700 → `--font-dm-sans`
- Keep Noto Serif Devanagari and Noto Sans Devanagari for Hindi (keep the existing loader and the
  `:lang(hi)` 1.15× line-height rule). Point Hindi headings and body at them.
- Put the font variables on `<html>`.
- Metadata: `clients/` title "My Fit Brain", admin title "My Fit Brain · Staff". Description must not
  contain "Intimacy" (discretion rule). Set icons and manifest from Step 2. `themeColor` `#145A5A`.

## Step 4 — Theme tokens (Tailwind v4)

In each `globals.css`:
1. `@import "tailwindcss";` then `@import "../styles/mfb-tokens.css";` (fix the relative path).
2. Add an `@theme` block exposing the brand as Tailwind utilities:

```css
@theme {
  --color-teal: #145A5A;        --color-night: #0E4242;     --color-mist: #E8F2F0;
  --color-coral: #E8745A;       --color-coral-deep: #B9502F; --color-coral-hover: #9E4227;
  --color-coral-light: #F2A58E;
  --color-cream: #FBF7F2;       --color-sand: #E6DED3;
  --color-ink: #1A2A2A;         --color-ink-soft: #3D5050;  --color-ink-muted: #5E7474;

  /* report bands — PROPOSED, pending clinical/brand sign-off; calm, never red */
  --color-band-low: #E8F2F0;      --color-band-low-text: #145A5A;
  --color-band-mild: #145A5A;     --color-band-mild-text: #FFFFFF;
  --color-band-moderate: #F2A58E; --color-band-moderate-text: #1A2A2A;
  --color-band-high: #B9502F;     --color-band-high-text: #FFFFFF;

  --font-heading: var(--font-poppins), Arial, sans-serif;
  --font-body: var(--font-dm-sans), Arial, sans-serif;

  --radius-input: 8px; --radius-card: 14px; --radius-hero: 24px;
  --shadow-card: 0 6px 24px rgba(20, 90, 90, 0.08);
}
```

3. Base styles: `body` = cream background, ink text, DM Sans 16px; `h1–h3` = Poppins, h1/h2 Deep Teal
   SemiBold, h3 Ink Medium; focus-visible ring = 2px Bindu Coral with offset; selection = mist.
4. Remove the old tokens file and every old token definition once nothing references them.
5. No raw hex values in components. Hex is allowed only in `mfb-tokens.css` and the `@theme` block.

## Step 5 — Brand UI primitives

Create in each app under `components/brand/` (same API in both apps):

- `Logo.tsx` — props `variant: 'horizontal' | 'horizontal-tagline' | 'stacked' | 'icon' | 'endorsed' | 'seal'`
  and `tone: 'colour' | 'reverse' | 'mono-teal' | 'white'`. Map each combination to the real SVG file
  names found in `brand/01_Logo/SVG/` (a typed lookup table, no guessed paths). Render with `next/image`,
  enforce the minimum widths from CLAUDE.md, alt "My Fit Brain" (endorsed: "My Fit Brain, founded by
  Dr. Neha Mehta"). Never render the wordmark as live text. If a combination truly has no file, fall back
  to the nearest version and log it under "Waiting on assets" in the audit.
  Usage: clients header + login = horizontal colour; admin nav on Teal Night = horizontal reverse
  (icon reverse when collapsed); seal is not used anywhere in this task.
- `Button.tsx` — `primary` (Coral Deep bg, white text, Poppins SemiBold 16px, pill, 48px min height,
  hover coral-hover), `secondary` (transparent, 2px teal inset outline, teal text, hover mist),
  `ghost` (teal text). Disabled and loading states. Keep 44px+ touch targets.
- `Card.tsx` — white, 1px sand border, 14px radius, optional soft shadow.
- `Pill.tsx` — Teal Mist bg, Deep Teal text, uppercase tracking, fully rounded.
- `BinduDot.tsx` — single coral dot used above a headline (max one per screen).
- `Notice.tsx` — `info` (mist bg, teal left border), `medical` (cream bg, sand border, teal left border).
  No red, no warning triangles.

## Step 6 — Restyle every screen

Replace the old styling across both apps with the primitives and tokens. Change styling only — keep all
logic, props, state, server actions and routes as they are.

Old → new mapping:

| Old | New |
|---|---|
| page bg `#F5F7F8` | cream |
| plum-500 primary button | `Button primary` (Coral Deep) |
| plum-700 hover | coral-hover |
| plum-500 headings | teal |
| plum-50 / magenta-50 selected & info surfaces | mist |
| magenta-600 small accent text | coral-deep |
| magenta-500 focus ring | coral |
| magenta-500 progress bar | teal fill on sand track |
| gold-50 / gold-500 medical notice | `Notice medical` |
| text / text-2 / text-muted | ink / ink-soft / ink-muted |
| border `#D1D5DB` | sand |
| radius 10 buttons | pill buttons; inputs 8px |
| radius 16 cards | 14px cards |
| band colours | `band-*` tokens above |

Screens to cover:
- `clients/`: header (56px sticky, Logo left, `EN | हिं` toggle right — toggle selected state teal on mist),
  login + OTP flow, register, home, sign-out, any error/not-found pages.
- `admin/`: login, layout/navigation (sidebar or top bar in Teal Night with reverse icon and white text;
  active item mist/coral-light accent), dashboard metric cards, clients table and search, client detail,
  new client form, coordinators page, bootstrap page.
- Status badges: "Verified & Linked" = mist bg + teal text; "Pending First Login" = cream bg + sand
  border + ink-soft text. Never red or alarm colours.
- Rule: exactly one primary (Coral Deep) button per screen; every other action is secondary or ghost.
- Icons: lucide only, outline, 2px stroke, teal by default. Remove any brain, pill, cross or medical icons.

## Step 7 — Copy

- In `clients/` i18n (EN and HI): replace the brand name with "My Fit Brain", replace
  "Science with a human touch" with the tagline "Space to speak." (HI: keep "Space to speak." in
  English inside brand lockups; only use a Hindi line where it is a separate sentence).
- Footer (both apps): "Space to speak. · My Fit Brain, a unit of MeDa Partners Pvt Ltd".
- Keep endorsement lines exactly as "Founded by Dr. Neha Mehta" / "Designed by Dr. Neha Mehta".
- Replace every other "Dr Neha Mehta" brand usage found in the audit.
- Update the Phase 1 home notice so it reads calmly and uses MFB wording; no dates or promises.
- Check all copy against the CLAUDE.md copy rules (no "licensed", "cure", "guaranteed", urgency, etc.).
- Do NOT change the bootstrap super-admin email or any env value in this task; list them in the audit
  under "Next task" instead.

## Step 8 — Clean up

- Delete the old design-system markdown (e.g. `DR_NEHA_MEHTA_ANTIGRAVITY_DESIGN_SYSTEM.md`), old token
  files, old logos and unused old images — only after confirming nothing imports them.
- Remove unused dependencies or font packages tied to the old design.

## Step 9 — Verify

For both apps:
1. `npm run lint` and `npm run build` pass with zero errors. Fix anything you broke.
2. Re-run the Step 1 search. Old hex values, old token names, Playfair and Inter must return zero hits
   outside `docs/`.
3. Grep components for raw hex (`#[0-9a-fA-F]{3,6}`) outside the token files — must be zero.
4. Confirm text contrast: body text ≥ 4.5:1, no small text on Bindu Coral, white only on Teal, Teal Night
   or Coral Deep.
5. Start each dev server briefly and confirm the home/login routes return 200 and render Poppins/DM Sans
   (check the served CSS for the font-face declarations). Stop the servers afterwards.
6. Check Hindi (`हिं`) mode renders with Noto Devanagari on login and register.

## Step 10 — Finish

1. Update `CLAUDE.md`: the Status section (UI rebrand done) and, if the real logo file names differ from
   the layout described, a short "Logo files" list under the Logo section.
2. Finalise `docs/rebrand-audit.md` with: what changed per app, files deleted, anything you could not do,
   "Waiting on assets", and "Next task" items (bootstrap email, env/domain values, migration, registration
   form).
3. Commit in logical chunks (`feat(ui): MFB tokens and fonts`, `feat(ui): brand primitives`,
   `feat(ui): restyle clients app`, `feat(ui): restyle admin app`, `chore: remove Dr Neha design system`).
4. Print a short summary in chat: per-app changes, verification results, and the audit file path.
