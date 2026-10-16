# Task 06 — manual click-through

Run this after `docs/tasks/06-apply.sql` and `supabase/migrations/20261019000000_attempt_privacy.sql`
(checks: `docs/tasks/06b-privacy-verify.sql`) are applied on the testing database.
No local database was available while building Task 06, so the scripted runs (Step 5.2) used the
in-memory store with the real engine and the real IA 1.2 / MA 1.1 configs (`clients/test/service.test.ts`).
This click-through is the check against the real database.

## Setup

1. Apply `supabase/migrations/20261020000000_payments.sql` (checks: `docs/tasks/08-payments-verify.sql`).
   In `clients/.env.local` fill `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (test mode keys,
   `rzp_test_...`) and `RAZORPAY_WEBHOOK_SECRET`. Restart `npm run dev:clients` (port 3000).
2. `npm run dev:admin` (port 3001) and sign in as a super admin or coordinator in another browser.
3. Use a test phone number with no earlier assessments.

## A. Intimacy, partner path, then change to no partner

1. Open `http://localhost:3000`, log in with phone OTP, finish registration (age 18 or over).
2. Home shows both tests with "Designed by Dr. Neha Mehta" and no price. Tab title is "My Fit Brain".
3. Choose **MFB Intimacy Assessment** → payment page shows the endorsed logo and ₹3,500 (the only price
   in the app). Press **Pay ₹3,500**: Razorpay checkout opens with "My Fit Brain · MFB Assessment".
   Pay with a Razorpay test method (e.g. UPI `success@razorpay`, or a test card from Razorpay's docs).
   - Expect: URL is `/assessment/<uuid>` (no test name). Admin → client → Assessments shows
     `MFB-IA-<year>-NNNNN`, status "Paid, not started"; the attempt page shows the Razorpay payment ID.
   - Close the checkout without paying → back to the Pay button, no assessment created.
   - Fail a test payment (UPI `failure@razorpay`) → "The payment did not go through"; `payments.status`
     = failed. Pay again in the same checkout → succeeds.
   - Press Pay again for the same test while that assessment is unfinished → it opens the assessment
     instead of charging again.
4. No report-language question (D21). Consent screen → one line → **I agree, start**.
5. Intake: age, gender and relationship status are **not** asked (taken from registration).
   For I6 choose "Yes, and they are willing to join sessions".
6. Gate G1: tick **G** and **A** (a third tick is blocked). Continue.
7. Answer a few core and module questions. Check: tapping an option only selects it (teal border, tick);
   **Next** (pinned to the bottom on a phone) saves and moves on and is disabled until a choice is made; the progress bar and "Question n of m" update; **Back** returns to the last answer with
   it selected.
   - Saving: answers are kept in the browser and saved every 5 answers. Answer 3 questions, close the
     tab, open `/assessment/<uuid>` again: you resume at the next unanswered question (the tab saved on
     close). Admin → attempt → Answers shows them.
8. Press **Back** until I6. Change it to "I do not have a partner right now".
   - Expect: the flow switches to the solo path; answers that are no longer visible are removed
     (admin → attempt → Answers no longer lists partner-only items) and the gate keeps only choices that
     are still offered.
9. Answer to the end (R5 = No). The submit screen says "When you submit, your answers are saved.
   Nothing can be changed after this." with **Submit my answers** and **Back**.
   - Expect: "Saving your answers...", then a thank-you screen. No report anywhere in the client app;
     `/report/<uuid>` is a 404. Home → Your assessments shows "Completed" with the date, not clickable.
10. Reload `/assessment/<uuid>` → the thank-you screen. Answers can no longer change.

## B. Mind, crisis answer

1. Home → **MFB Mind Assessment** → pay (test mode) → consent.
2. Answer to MR5 and choose **Yes**.
   - Expect: a full-screen calm support screen with the version's support text, two large call buttons
     (Tele-MANAS 14416 and 1-800-891-4416, `tel:` links that open the dialer on a phone) and
     "Continue the assessment". No red, no alarm icons.
   - Admin → attempt → Safety events shows one `crisis` event (answering again does not add a second).
3. Continue to the end and submit.
   - Expect (admin, as super admin or counsellor): crisis layout — crisis block first, no plan line and
     no focus lines.

## C. Under 18 (optional)

A client registered under 18 never reaches here (registration stops). If the version's age question
can produce AGE_STOP from an attempt, the stop screen shows the AGE_STOP text and **Close** signs out;
nothing more can be answered.

## C2. App shell

1. On Home, Profile and the thank-you screen, a bottom tab bar shows **Home** and **Profile**; the active tab is
   teal with a mist pill. It is hidden on the payment and assessment screens.
2. Profile shows initials, name, mobile, details (read-only), a privacy line and
   **Sign out**. The header no longer has a sign-out button.
3. On a phone (or installed as an app) the tab bar sits above the home indicator.

## D. Admin

1. Dashboard: "Assessments completed" and "In progress" counts match A and B.
2. Client detail → Assessments: both attempts with report ID, test, version, status, dates.
3. As a **super admin or counsellor**, `/attempts/<id>`: two tabs, **Report** (English) and **Counsellor view** (switch without scrolling; `?view=counsellor` opens the second tab) —
   module %/bands, points breakdown, tier before/after overrides, format and who decided it, flags and
   tags (e.g. `CRISIS` on the Mind attempt), readiness, every answer with its question text and whether
   it came from registration, and safety events.
   - The report header shows the client's name and the test name (not "Your report").
   - **Download PDF** ("Preparing PDF..." for a moment) downloads `<report ID>.pdf` directly. Expect the
     brand template: cream cover (endorsed logo, coral dot, test name, Prepared for / Date / Report ID,
     founder seal, teal disclaimer band), then content pages with the logo header "Test · Client name",
     numbered teal sections, mist cards with bars and the "Space to speak." footer with page numbers.
     A coordinator gets 403 on `/attempts/<id>/pdf`.
   - Client page: one **Client details** card (no auth user ID); "Created by" shows the staff name (also
     when a coordinator or counsellor opens it) or "Self-registered (phone sign-in)"; dates in India time.
4. As a **coordinator**, the same page shows status, dates and safety events only, with "Reports and
   answers are visible to counsellors and super admins only."
5. Sign in as a client and try `/attempts/...` on the admin domain → no access.

## D2. Admin payments

Apply `supabase/migrations/20261022000000_payments_access.sql` (checks:
`docs/tasks/08c-payments-access-verify.sql`).
1. As a **super admin** or **coordinator**: the menu shows **Payments**. The page shows Received, This
   month, Not completed and Failed, then the payments table (date, client, assessment + report ID,
   amount, status, method, Razorpay ID). Filters: status chips, period chips, search by client name,
   mobile, email, report ID or Razorpay ID.
2. Click a row (or Tab to it and press Enter): the side sheet opens with amount and status, client
   (link to the client page), assessment (link to the attempt), payment details and Razorpay IDs with
   copy buttons and "Open in Razorpay". Esc, × or the backdrop closes it; the URL keeps `?payment=`.
3. As a **counsellor**: no Payments menu item, `/payments` goes to the dashboard, and a direct read of
   `payments` returns no rows.

## E. Payments not configured and the webhook

1. Empty `RAZORPAY_KEY_ID` and restart: the payment page shows "Payments are not available right now."
   and no button; `POST /api/payments/order` answers 503.
2. Webhook (needs a public URL: a Vercel preview, or a tunnel such as ngrok to port 3000): in Razorpay
   test mode add `<url>/api/payments/webhook` with events payment.captured, order.paid, payment.failed
   and the same secret as `RAZORPAY_WEBHOOK_SECRET`. Pay, then close the tab before it returns: the
   assessment still appears on Home (created by the webhook). `payment_events` lists the event IDs.
