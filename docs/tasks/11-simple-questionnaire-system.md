# Task 11 — Simple questionnaire system (rebuild, one-time reset)

Branch `task-11-simple-questionnaires` from `main`. This replaces Tasks 08, 09 (Phase 4), 10 and the draft
`11-questionnaire-standard-v2.md`. Goal: the simplest system that still runs any questionnaire, with as few
restrictions as possible for the person adding questions.

## Deleting: one-time permission, this task only

- Allowed **once, in Step 1 of this task**: drop the old question-bank tables/functions/code and delete
  **test data only** (attempts, answers, results, alerts/events, test payments). **Never touch** clients,
  users, staff/profiles, auth, the SMS hook or `report_counters`.
- I run all SQL myself. Give me the reset as one SQL file with a plain list at the top of exactly which
  tables and functions it drops or empties.
- After Step 1 the permanent rule is back: **never delete data or write deleting SQL without asking me
  first.** Do not save this permission to memory and do not apply it to any later task.

## The system in one page

**Admin flow:** Questionnaires → **Copy AI prompt** → admin pastes it into any AI together with the questions
they discussed → AI returns one JSON → admin pastes it into **Import JSON** → the system shows the whole
questionnaire in plain language (what opens what) → **Publish**. No review step, no approval tick.

**Client flow:** answers the questions → thank-you screen ("Your counsellor will go through your results with
you"). The client never sees a report in the app.

**Counsellor flow:** opens the attempt in admin → sees the counsellor view → **Download PDF** and sends it on
WhatsApp when the client asks. No sharing feature and no share tracking in the system.

### The JSON (the only format)

```jsonc
{
  "title": { "en": "…", "hi": "…" },                      // required
  "subtitle": { "en": "…", "hi": "…" },                   // optional
  "closing": { "en": "…", "hi": "…" },                    // optional
  "disclaimer": { "en": "…", "hi": "…" },                 // optional (a default is used)
  "ranges": [ { "up_to": 25, "en": "Low", "hi": "कम" }, … ],   // optional (default Low/Mild/Moderate/High at 25/50/75/100)
  "plan": [ { "range": 1, "name": {…}, "sessions": 4, "pace": {…} }, … ],   // optional
  "sections": [
    { "id": "s_relationship", "title": {…}, "scored": true,
      "show_when": { "question": "q_partner", "is_not": ["o_no_partner"] },        // optional
      "report": { "meaning": [ {…}, {…}, {…}, {…} ], "focus": [ {…} ] },          // optional
      "questions": [
        { "id": "q_happy", "text": {…}, "multiple": false, "max_choices": null,
          "show_when": { … },                                                       // optional
          "options": [ { "id": "o_sa", "text": {…}, "value": 1 },
                       { "id": "o_na", "text": {…}, "value": null },                // skipped in scores
                       { "id": "o_x",  "text": {…}, "value": 5,
                         "note": "Suggest a doctor check-up." } ] } ] } ]          // note: counsellor view only
}
```

**Rules (`show_when`), the complete list:**
`{ "question": id, "is": [option ids] }` · `{ "question": id, "is_not": [option ids] }` ·
`{ "question": id, "includes": [option ids] }` · `{ "section": id, "score_at_least": n }` ·
`{ "section": id, "score_at_most": n }` · `{ "all": [rules] }` · `{ "any": [rules] }`.
An unanswered question or a hidden section counts as false, so a rule can never break the flow.

**Scoring (fixed, in code):** higher value = more difficulty. Each answer with a value becomes a % of its own
question's value range; section score = average of those %. If fewer than half of the shown questions in a
section have a value → "Not enough answers". Range = first range whose `up_to` ≥ score. Main area = the scored
section with the highest score.

**Built in (in code, added at the end of every questionnaire):** a safety section with the crisis question
(Yes → immediate support screen with Tele-MANAS during the test + team alert; in the report the plan is
hidden and a support message comes first) and the home-safety question (Yes → counsellor alert). Age under 18
is already stopped at registration. Texts EN + HI in code.

**Report PDF (5 parts, same for every questionnaire):** cover (title, subtitle, name, date, report ID,
disclaimer) · snapshot (per scored section shown: bar with %, range word, that range's meaning line if
given) · plan (main area's range → plan row, if a plan exists, + "Your counsellor will confirm the format
with you.") · what sessions will work on (main area's focus lines, if given) · next step (closing, if given).
Parts with no content are simply left out. Brand per CLAUDE.md. Language as chosen by the client.

**Counsellor view (admin, per attempt):** top: crisis/safety alerts and the notes triggered by the client's
answers; plan and main area · each section: score, range, answered/skipped counts · notable answers (the
highest-value answer of each question that got one) · all answers grouped by section · **Download PDF**.

## Keep validation light

Block import **only** for: invalid JSON, no questions, duplicate ids, or a rule pointing to an id that does
not exist. Everything else is a **warning** shown in plain English and never blocks: missing Hindi (English is
used), missing report lines, missing plan, a rule reading a later question (it just counts as false),
ranges not covering 0–100 (defaults are used).

## Steps

1. **Reset** (one time, see above). Also remove the old code: Excel parser, seeds, patches,
   `mfb-questionnaire/1` standard, tags, old engine, Try-it, test cases, report sharing in the client app.
2. **New tables** (additive SQL): `questionnaires` (code, name, report ID prefix) · `questionnaire_versions`
   (number, status draft/live/retired, `definition jsonb`, created/published by and at; published versions
   are frozen; one live per questionnaire) · `attempts` (pinned version, status, language, report ID) ·
   `attempt_answers` · `attempt_results` (frozen report + counsellor data) · `attempt_alerts`.
   RLS: staff read everything; clients only write their own answers through the app's server actions and
   never read results or definitions.
3. **One small engine package:** light validation, flow, scoring, report, counsellor view. No
   questionnaire-specific code.
4. **Admin:** Questionnaires list; version page with **Copy AI prompt**, **Import JSON**, **Copy JSON**,
   **Publish**. One readable page, no technical words: sections in order with "Shown when Question 1.6 is
   'I don't have a partner'" (numbers from position, rules show option text), each question with its options,
   values and notes, then report settings and each section's report lines. Warnings at the top.
   Attempt page = counsellor view + Download PDF.
5. **AI prompt** (`docs/questionnaires/ai-prompt.md`, used by Copy AI prompt). Short and friendly: the AI
   asks the admin a few questions only if something is unclear, then returns **one JSON block** in the format
   above; Hindi for every text; higher value = more difficulty; "Not applicable / Unsure" get `value: null`;
   notes only for medical or safety concerns; never include the built-in safety questions; copy rules from
   CLAUDE.md. Include one small complete example.
6. **Client app:** render any questionnaire from the definition (single choice as cards, `null`-value options
   as smaller buttons, multiple choice as checkboxes with `max_choices`). Thank-you screen after submit.
   Remove any in-app report view.
7. **Starting drafts:** convert `docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v2.0.xlsx` and the Mind
   v1.0 workbook into `docs/questionnaires/intimacy.json` and `mind.json` (use the workbooks' texts; leave
   missing report lines empty). Give me the import steps.

**Finish:** tests, lint and build pass. Update CLAUDE.md to describe only this system (remove the old
question-bank sections) and restate the permanent no-delete rule. Summary with a "Run in Supabase" list
(reset file, then new tables). STOP after the summary.
