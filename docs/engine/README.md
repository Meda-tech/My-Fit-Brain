# MFB assessment engine (`@mfb/engine`)

One engine for every test. It takes a question-bank version (`VersionConfig`, loaded from the database or
built from a payload) plus a client's answers and returns the next question, scores, bands, plan, format,
flags and report content as text keys. It is **pure**: no database, network, clock or randomness, so the same
input always gives the same output, on the server and in tests. It contains **no** question ids,
thresholds, scores or report sentences; everything comes from the config (a test in
`packages/engine/test/rules.test.ts` fails the build if source code contains a question id or a report
sentence).

Rules and their JSON format: `docs/questionbank/rules-reference.md`. Decisions behind IA 1.2 / MA 1.1:
`docs/questionbank/decisions.md`.

## Inputs

```ts
type EngineContext = {
  sex: 'Male' | 'Female' | 'Prefer not to say'; // from registration
  age: number;                                   // exact years from registration
  mode: 'initial' | 'progress';
  firstResult?: AssessmentResult;                // required in progress mode
};
type Answers = Record<string, string | string[]>; // qid → option code(s)
```

Registration fills the sex and age-band questions (`qb_scoring.registration`); they are never asked. A
different answer to them is ignored with a `REGISTRATION_ANSWER_MISMATCH` warning. In progress mode the
`progress.reuse_qids` answers come from `firstResult.counsellor.rawAnswers`.

## Functions

| Function | Returns |
|---|---|
| `evaluateCondition(cond, facts)` | `true`, `false` or `'unknown'` (a fact not knowable yet). Unknown fact or operator → `ConfigError` |
| `buildFacts(config, context, answers, partial = true)` | Answers, sex/age/age band, path, core module, chosen modules (in order), module %, bands, primary / second, fired flags |
| `getFlow(config, context, answers)` | Visible questions in order, each with visible options in display order; throws `InvalidAnswerError` on invalid answers |
| `nextQuestion(config, context, answers)` | Next unanswered visible question, or `null` |
| `pruneAnswers(config, context, answers)` | `{ answers, removed }` without answers to questions (or choices) no longer shown |
| `checkInterrupts(config, context, answers)` | Fired flags with `interrupt` or `stop` (support screen, age stop). Call after every answer |
| `score(config, context, answers)` | `AssessmentResult`. Throws `InvalidAnswerError`, `AssessmentStoppedError` (a `stop` flag fired) or `IncompleteAssessmentError` (lists missing qids) |
| `compareProgress(config, first, progress)` | Per area: before %, now %, change, `better` / `same` / `worse`, text key |
| `runTestCase(config, testCase)` | `{ passed, actual, diffs[], error }` |
| `resolveReportTexts(config, result, 'en' \| 'hi' \| 'both')` | Sentences for every report key. Missing key or language → `null` + warning; text is never generated or filled in |

Server only (`@mfb/engine/server`, `import 'server-only'`): `loadConfig(supabase, versionId)` (Task 03
loader; live/retired cached, drafts never) and `scoreAttempt(supabase, versionId, context, answers, lang)` →
result with resolved texts. Scoring runs only on the server; the browser sends option codes.

## Output: `AssessmentResult`

`engineVersion, versionId, testCode, mode, path, coreModule, chosenModules, modules` (per module:
`scoredItems, shownItems, sum, max, percent, band`), `primary, second, points` (`total`, `breakdown` of
every point rule), `tierBeforeOverrides, overridesApplied` (`key, from, to`), `tier, format` (`type`,
`split` for mixed, `addTextKeys`, `source` = the rule or flag that decided it), `flags` (`key, effects`),
`layout` (`standard` / `crisis`), `notify` (recipients per flag), `report` (text keys: `interpretation`,
`strengths` / `stuck` item ids, `focus` key + line, `tone`, `blocks`, `nextStep`, `plan` or `null` in the
crisis layout, `hidden`), `counsellor` (`readiness`, `tags`, `rawAnswers`), `warnings`, `trace` (a readable
line per decision). In progress mode `points`, `tier` and `format` are `null`.

## Flow order

intake → gate → the core module chosen by `qb_scoring.core_module` (core, solo core) → chosen modules in
the order chosen → dose → flag; inside a module by `sort`. A question is shown when its module is shown,
its `path` is `all` or the client's path, and its visibility rule (if any) is true. Options: `hide` rules
remove options, `order_first` rules move options to the front (rule `sort` order). The gate offers
`min_choices` … `max_choices`. Progress mode asks only the same core, the same chosen modules and
`progress.items.qids`.

Answer checks (`InvalidAnswerError`): unknown option, option not offered, several options on a single
question, a non-list on a multi question, duplicates, an `exclusive` option combined with others, too few or
too many gate choices.

## Rules, in the order the engine applies them

1. **Item score** = option value; reverse items `reverse_max − value`. Only `scored = yes` questions count
   toward a module %; `scored = points` questions are read by point rules.
2. **Module %** = sum ÷ (`reverse_max` × scored questions shown) × 100, rounded half up in exact integer
   arithmetic (25.5 → 26). For the core and each chosen module.
3. **Band** = the `qb_scoring.bands` entry containing the %; band order is the list order.
4. **Primary** = chosen module with the highest band, tie → first chosen; none chosen → the core.
   **Second** = the other chosen module.
5. **Points**: every `qb_point_rules` row in `sort` order — `primary_band_severity`, `answer_value` (raw value
   of `qid`), `fixed` (when its condition is true). All appear in the breakdown.
6. **Tier** = first `tier_thresholds` entry with `max_points ≥ total` (`null` = no limit); then every
   `qb_overrides` row in `sort` order (`cap` = min, `floor` = max). Applied overrides are recorded.
7. **Flags** in `sort` order (a flag may refer to earlier flags). Flags never change the tier. A flag with
   `layout: crisis` sets the crisis layout (the tier is still computed and stored).
8. **Format**: the first fired flag with `force_format` (flag `sort` order) wins; otherwise the first
   matching `qb_format_rules` row (mixed: `split` for the tier). No match → `null` + `NO_FORMAT_RULE`.
9. **Report keys** (`qb_report_rules`): interpretation for primary, second (when at least
   `second_min_band`) and core, with `fallback: core` (a module without a text for its band uses the core's
   text for the core's band; no key twice); strengths (priority order, answered with `strengths.answer`, max
   `count`); stuck (non-reverse questions with a stuck text, by `answer_order` then `module_order`, accepted
   answers named by the item's trigger, max `count`); focus (primary lines, or the configured split with
   the second module when it reaches `second_module_min_band`); tone (condition → ready / gentle key);
   blocks (printed flags' `report_block`, crisis `top_block` first); next step (tone, or the crisis
   `next_key`); plan (hidden in the crisis layout).
10. **Counsellor**: readiness (the unscored dose question), tags (every fired flag's `dashboard_tag`;
    `printed: false` flags appear only here), raw answers.
11. **Progress**: same item scoring and %; no points, tier or format; `compareProgress` classifies
    change ≤ `better_at` → better, ≥ `worse_at` → worse, else same.

A rule that cannot be evaluated (unknown question, module, band, flag, operator) throws `ConfigError`: the
configuration is wrong, not the client.

## Test cases and publishing

Stored test cases (`qb_test_cases`): `context` (sex as the sex question's option code, age, path),
`answers`, `expected` (`bands`, `primary`, `points` incl. `TOTAL`, `tier`, `format`, `flags`, `layout`,
optional `extra_text_keys`, `interpretation_keys`, `notify`). `runTestCase` compares each of these.

To add a test case: add an `add_test_case` operation to a patch (`packages/questionbank/patches/`) — or, from
Task 05, in the admin editor — with a full answer set and the expected result, and put the intended module
% in `notes`. Run `npm test -w @mfb/engine` (the offline suite builds IA 1.2 / MA 1.1 from the workbooks and
patches and runs every stored case).

Publishing needs, for every test case of the version, a passing run on the current `ENGINE_VERSION` made
after the version's last content change. In the admin: Question bank → version → **Test cases** → **Run all
test cases** (results go to `qb_test_runs`), then Publish.

## When to bump `ENGINE_VERSION`

`packages/engine/src/version.ts`. Bump whenever any result could change: **MAJOR** for a changed
`AssessmentResult` shape, **MINOR** for changed outcomes (scoring, flow, flags, report keys), **PATCH** for
fixes that cannot change any outcome. After a bump, every version needs its test cases run again before it
can be published; stored results keep the engine version that produced them.
