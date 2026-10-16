# Task 06 — manual click-through

Run this after `docs/tasks/06-apply.sql` is applied on the testing database.
No local database was available while building Task 06, so the scripted runs (Step 5.2) used the
in-memory store with the real engine and the real IA 1.2 / MA 1.1 configs (`clients/test/service.test.ts`).
This click-through is the check against the real database.

## Setup

1. `clients/.env.local`: add `PAYMENTS_MODE=stub`. Restart `npm run dev:clients` (port 3000).
2. `npm run dev:admin` (port 3001) and sign in as a super admin or coordinator in another browser.
3. Use a test phone number with no earlier assessments.

## A. Intimacy, partner path, then change to no partner

1. Open `http://localhost:3000`, log in with phone OTP, finish registration (age 18 or over).
2. Home shows both tests with "Designed by Dr. Neha Mehta" and no price. Tab title is "My Fit Brain".
3. Choose **MFB Intimacy Assessment** → payment page shows the endorsed logo and ₹3,500 (the only price
   in the app). Press **Mark as paid (testing)**.
   - Expect: URL is `/assessment/<uuid>` (no test name). Admin → client → Assessments shows
     `MFB-IA-<year>-NNNNN`, status "Paid, not started", "test payment".
4. No report-language question (D21). Consent screen → one line → **I agree, start**.
5. Intake: age, gender and relationship status are **not** asked (taken from registration).
   For I6 choose "Yes, and they are willing to join sessions".
6. Gate G1: tick **G** and **A** (a third tick is blocked). Continue.
7. Answer a few core and module questions. Check: tapping an option only selects it (teal border, tick);
   **Next** (pinned to the bottom on a phone) saves and moves on and is disabled until a choice is made; the progress bar and "Question n of m" update; **Back** returns to the last answer with
   it selected.
8. Press **Back** until I6. Change it to "I do not have a partner right now".
   - Expect: the flow switches to the solo path; answers that are no longer visible are removed
     (admin → attempt → Answers no longer lists partner-only items) and the gate keeps only choices that
     are still offered.
9. Answer to the end (R5 = No). Finish screen → **See my report**.
   - Expect: "Preparing your report", then `/report/<uuid>` with the endorsed logo, report ID, date,
     snapshot bars (calm colours, no red), strengths / stuck, plan line, next step, founder seal.
   - Switch EN | हिं in the header: the report changes language (both are stored).
10. Reload `/assessment/<uuid>` → redirects to the report. Answers can no longer change.

## B. Mind, crisis answer

1. Home → **MFB Mind Assessment** → Mark as paid → consent.
2. Answer to MR5 and choose **Yes**.
   - Expect: a full-screen calm support screen with the version's support text, two large call buttons
     (Tele-MANAS 14416 and 1-800-891-4416, `tel:` links that open the dialer on a phone) and
     "Continue the assessment". No red, no alarm icons.
   - Admin → attempt → Safety events shows one `crisis` event (answering again does not add a second).
3. Continue to the end and open the report.
   - Expect: crisis layout — crisis block first, no plan line and no focus lines.

## C. Under 18 (optional)

A client registered under 18 never reaches here (registration stops). If the version's age question
can produce AGE_STOP from an attempt, the stop screen shows the AGE_STOP text and **Close** signs out;
nothing more can be answered.

## C2. App shell

1. On Home, Profile and the report, a bottom tab bar shows **Home** and **Profile**; the active tab is
   teal with a mist pill. It is hidden on the payment and assessment screens.
2. Profile shows initials, name, mobile, details (read-only), the language toggle, a privacy line and
   **Sign out**. The header no longer has a sign-out button.
3. On a phone (or installed as an app) the tab bar sits above the home indicator.

## D. Admin

1. Dashboard: "Assessments completed" and "In progress" counts match A and B.
2. Client detail → Assessments: both attempts with report ID, test, version, status, dates.
3. `/attempts/<id>`: the client report exactly as the client sees it, and the Counsellor view —
   module %/bands, points breakdown, tier before/after overrides, format and who decided it, flags and
   tags (e.g. `CRISIS` on the Mind attempt), readiness, every answer with its question text and whether
   it came from registration, and safety events.
4. Sign in as a client and try `/attempts/...` on the admin domain → no access. Try another client's
   `/report/<uuid>` on the client app → not found.

## E. Payments off

Remove `PAYMENTS_MODE` (or set `VERCEL_ENV=production`) and restart: the payment page shows
"Payments are not open yet. Please check back soon." and no button; posting the form directly returns `PAYMENTS_DISABLED`.
