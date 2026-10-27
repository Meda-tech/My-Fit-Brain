# Questionnaires — the simple system (Task 11)

One JSON per questionnaire version. The admin pastes it in, reads it back in plain language, and publishes.
The engine (`@mfb/questionnaire`, `packages/questionnaire/`) holds the logic once: validation, flow, scoring,
the report and the counsellor view. Nothing in code belongs to one questionnaire.

| Where | What |
|---|---|
| `docs/questionnaires/ai-prompt.md` | The prompt behind **Copy AI prompt** (one source; `npm run prompt -w @mfb/questionnaire` regenerates the code constant) |
| `docs/questionnaires/intimacy.json` · `mind.json` | Starting drafts converted from the developer workbooks |
| `packages/questionnaire/src/` | `validate.ts` (light validation) · `flow.ts` · `measure.ts` + `score.ts` · `report.ts` · `counsellor.ts` · `describe.ts` (plain words) · `defaults.ts` (ranges, disclaimer, safety, headings) |
| `supabase/migrations/20261026000001_questionnaires.sql` | Tables and functions |

## The JSON

```jsonc
{
  "title": { "en": "…", "hi": "…" },                       // required
  "subtitle": { "en": "…", "hi": "…" },                    // optional
  "closing": { "en": "…", "hi": "…" },                     // optional: the "Your next step" text
  "disclaimer": { "en": "…", "hi": "…" },                  // optional (a default is used)
  "ranges": [ { "up_to": 25, "en": "Low", "hi": "कम" }, … ], // optional (default Low/Mild/Moderate/High at 25/50/75/100)
  "plan": [ { "range": 1, "name": {…}, "sessions": 4, "pace": {…} }, … ],  // optional
  "sections": [
    { "id": "s_relationship", "title": {…}, "scored": true,
      "show_when": { "question": "q_partner", "is_not": ["o_no_partner"] },      // optional
      "report": { "meaning": [ {…}, {…}, {…}, {…} ], "focus": [ {…} ] },        // optional
      "questions": [
        { "id": "q_happy", "text": {…}, "multiple": false, "max_choices": null,
          "show_when": { … },                                                     // optional
          "options": [ { "id": "o_sa", "text": {…}, "value": 1 },
                       { "id": "o_na", "text": {…}, "value": null },              // skipped in scores
                       { "id": "o_x",  "text": {…}, "value": 5, "note": "Suggest a doctor check-up." } ] } ] } ],
  "client_details": [ { "id": "d_medicines", "text": { "en": "…", "hi": "…" } }, … ]   // optional
}
```

- Every text is `{ "en", "hi" }`. Missing Hindi is a warning; English is shown instead.
- Ids: letters, digits and `_`; section ids unique, question ids unique, option ids unique within their question.
- `value`: a number (higher = more difficulty) or `null` (not counted). `note`: counsellor view only.
- `multiple: true` = checkboxes, with `max_choices` (or null).

### Rules (`show_when`) — the complete list

| Rule | True when |
|---|---|
| `{ "question": id, "is": [option ids] }` | the answer is one of them (multiple choice: any chosen option is) |
| `{ "question": id, "is_not": [option ids] }` | answered, and no chosen option is one of them |
| `{ "question": id, "includes": [option ids] }` | any chosen option is one of them (same as `is`; reads better for multiple choice) |
| `{ "section": id, "score_at_least": n }` | that section is shown, scored and its score ≥ n |
| `{ "section": id, "score_at_most": n }` | … and its score ≤ n |
| `{ "all": [rules] }` · `{ "any": [rules] }` | every / at least one |

An unanswered question or a hidden section counts as **false**, so a rule can never break the flow. A rule
that reads a later question is a warning and is simply false.

### Scoring (fixed, in code)

Each answer with a value becomes a % of its own question's value range (lowest value = 0 %, highest =
100 %; for multiple choice the highest chosen value counts). Section score = average of those %, rounded.
Fewer than half of the shown questions in a section answered with a value → "Not enough answers" (no score,
no range). Range = first range whose `up_to` ≥ score. Main area = the scored section with the highest score
(tie → the first). Plan row = the row whose `range` is the main area's range (1 = first range).

### Built in (code, never in the JSON)

A safety section is added at the end of every questionnaire: the crisis question (Yes → support screen with
Tele-MANAS at once, team alert, report shows a support message first and hides the plan and focus) and the
home-safety question (Yes → team alert). Age under 18 is already stopped at registration.

### Client details (typed answers, after the safety questions)

Open questions where the client types the answer, e.g. "Are you taking any medicines? If yes, please mention
the details." They come after the two safety questions, one per screen. Each answer is required and at most
1,000 characters. They have no options, values or rules, are never scored and never appear in the report or
the PDF. Counsellors and super admins read them on the assessment page.

- **Where the list lives:** on the questionnaire (`questionnaires.client_details`), not on a version, so it
  can change at any time without a new version: Admin → Questionnaires → (test) → **Client details** →
  add, edit, reorder, remove → Save. The change applies at once, also to clients who have not reached these
  questions yet.
- **Old answers never change:** each answer (`attempt_details`) keeps a copy of the question as it was asked.
- **In the JSON (optional):** `client_details` as above (ids start with `d_`). Publishing a version that has
  it replaces the questionnaire's list; a version without it keeps the current list. Copy JSON includes the
  current list. `intimacy.json` carries the six Intimacy questions.

### Validation

Import is blocked only for: invalid JSON, no questions, duplicate ids, a rule pointing to an id that does not
exist (and a question without options; a client-details question without an id or English text). Everything
else is a warning in plain English: missing Hindi,
missing report lines, no plan, a rule reading a later question, ranges not reaching 100 (defaults used).

## Flows

- **Admin:** Questionnaires → (test) → New version → Copy AI prompt → paste into any AI with the questions →
  answer the AI's questions (it asks about anything unclear or missing, such as the plan or report lines,
  before it writes) → paste the complete JSON into the import box (creates or replaces the draft) → read the
  Overview and Report tabs → Publish (the previous live version retires). The prompt asks for the plan and
  the report lines every time; the import itself still only warns when they are missing.
- **Client:** pays → consent → answers (one screen per question, saved as they go) → safety questions →
  client details (typed) → submit → thank-you screen.
  No report in the app.
- **Counsellor:** opens the attempt in the admin → counsellor view → Download PDF (built on request, never
  stored; file name = report ID) → sends it on WhatsApp when the client asks.

## Report PDF (five parts, the same for every questionnaire)

Cover (title, subtitle, name, date, report ID, disclaimer) · snapshot (per scored section shown: bar, %,
range, meaning line) · plan (main area's range → plan row, plus "Your counsellor will confirm the format
with you.") · what sessions will work on (main area's focus lines) · next step (closing). Parts with no
content are left out. Language = the one the client used.
