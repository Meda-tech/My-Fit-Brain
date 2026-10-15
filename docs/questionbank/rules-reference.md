# Question bank rules — reference

Every rule of a test lives in the `qb_*` rule tables of a version, as data. One **condition** shape is
used everywhere. Schema: `packages/questionbank/src/conditions.ts` (zod) and `src/rules.ts`.
How each Excel rule was converted: `docs/tasks/03-rules-mapping.md`. Owner decisions that changed rules
after the Excel files (IA 1.2, MA 1.1): `docs/questionbank/decisions.md`. The Excel files are the source of
IA 1.1 / MA 1.0 only; from IA 1.2 / MA 1.1 onward the database is the source of truth.

## 1. Versions

| Status | Meaning | Changes allowed |
|---|---|---|
| `draft` | Being prepared (imported or copied) | Content, rules and test cases can be edited by editors |
| `in_review` | Submitted; waiting for an approver | None (return it to draft to edit) |
| `live` | The version new assessments use (one per test) | **None, ever** |
| `retired` | A former live version | **None, ever** |

- At most one `live` and at most one open (`draft` or `in_review`) version per test.
- Freeze rule: a trigger on every content, rule and test-case table rejects any insert, update or delete
  when the row's version is not `draft`, for everyone including the service role.
- Status changes only through: `qb_start_new_version(test, label)` (copy of live, or latest),
  `qb_import_version(payload)` (new draft from a workbook), `qb_submit_for_review(id)`,
  `qb_return_to_draft(id)`, `qb_publish(id, change_note)` (previous live → retired) and
  `qb_delete_draft(id)`. A trigger blocks direct status updates.
- `qb_validate_version(id)` returns `{severity, code, message, ref}`; submit and publish require zero errors.
- Permissions: `profiles.can_edit_content` (import, copy, edit, submit, delete drafts) and
  `profiles.can_approve_content` (publish). Active super admins have both. Only a super admin can grant them.
- Every assessment stores the version id it used, so results can always be re-read with the exact rules.
- **Importing an older or equal version is blocked.** A workbook whose version label is lower than or equal
  to the latest version of that test would replace decisions made in later versions; the admin import shows
  a blocking error and the CLI needs `--force`. Change a live version by starting a new version or with a
  patch (§5) instead.

## 2. Condition format

```ts
type Condition =
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { fact: 'answer'; q: string; op: 'eq' | 'neq' | 'in' | 'not_in'; value: string | string[] }
  | { fact: 'answer_value'; q: string; op: 'eq'|'gte'|'lte'|'gt'|'lt'; value: number }
  | { fact: 'answered_any_except'; q: string; value: string[] }
  | { fact: 'sex'; op: 'eq' | 'in'; value: string | string[] }
  | { fact: 'age'; op: 'gte'|'lte'|'gt'|'lt'|'eq'; value: number }
  | { fact: 'age_band'; op: 'eq' | 'in'; value: string | string[] }
  | { fact: 'path'; op: 'eq'; value: 'partner' | 'solo' }
  | { fact: 'module_chosen'; value: string }
  | { fact: 'chosen_count'; op: 'eq'|'gte'|'lte'; value: number }
  | { fact: 'chosen_kinds'; op: 'only' | 'includes'; value: ('couple' | 'individual')[] }
  | { fact: 'band'; module: string | 'primary' | 'second' | 'core'; op: 'eq'|'gte'|'lte'; value: Band }
  | { fact: 'all_bands'; scope: 'core_and_chosen' | 'chosen'; op: 'lte' | 'gte'; value: Band }
  | { fact: 'count_bands'; scope: 'chosen'; op: 'gte'; value: 'Moderate'|'High'; count: number }
  | { fact: 'flag'; key: string };
// Band: 'Low' < 'Mild' < 'Moderate' < 'High'
```

No facts were added beyond the brief.

### Meaning of each fact

| Fact | True when | Notes |
|---|---|---|
| `all` | every child is true | `{ "all": [] }` is always true (used for "otherwise" rules) |
| `any` | at least one child is true | must have at least one child |
| `not` | the child is false | |
| `answer` | the answer to `q` matches option code(s) | Single: `eq`/`in` compare the chosen code. Multi: `eq` = the code is among the choices, `in` = any listed code is chosen, `neq`/`not_in` the opposite. Unanswered or hidden: `eq`/`in` false, `neq`/`not_in` true |
| `answer_value` | the **raw** option value of `q` (before reverse scoring) compares with `value` | Unanswered, hidden or valueless options: false |
| `answered_any_except` | `q` has at least one chosen option not in `value` | "R1 has any condition" = any option except `none_of_these` |
| `sex` | the client's gender, as an option code of the sex question | Registration gender is mapped by `qb_scoring.registration.sex_options` (`Male` → `male`, …) |
| `age` | the client's **exact** age from registration | e.g. MED_MALE "age ≥ 40" |
| `age_band` | the age band option code of the age question (`18_24`, …) | From registration via `registration.age_bands` |
| `path` | the client's path is `partner` or `solo` | Path comes from `qb_scoring.core_module`. Tests without paths (Mind): false |
| `module_chosen` | the module was chosen in the gate | Gate option codes are module codes (checked by validation) |
| `chosen_count` | number of chosen modules compares with `value` | |
| `chosen_kinds` | `only`: at least one module chosen and every chosen module's kind is listed · `includes`: every listed kind is among the chosen modules | Kinds from `qb_modules.kind` |
| `band` | band of a module compares with `value` | `module` is a module code or a role: `primary`, `second` (the other chosen module), `core`. False when that module has no % (not chosen, not shown) |
| `all_bands` | every band in the scope compares with `value` | `core_and_chosen` = the core + every chosen module |
| `count_bands` | at least `count` chosen modules have a band ≥ `value` | |
| `flag` | the flag `key` is raised | Flags are evaluated in `sort` order; a flag may only refer to flags with a lower `sort` |

**Exclusive options.** `qb_options.exclusive = true` marks an option of a multi-select question that cannot
be combined with any other option (e.g. "None of these" on R1 / MR1). Only on `multi` questions, at most
one per question. The engine rejects answers that combine it with others; the UI prevents it.

Option codes are stable slugs: likert `never|rarely|sometimes|often`, yes/no `no|yes`, gate letters
(`A`…`G`, `H`/`L`/`W`/`K`), others snake_case of the English label (`under_18`, `18_24`, `55_plus`,
`none_of_these`, `i_do_not_have_a_partner_right_now`).

## 3. Rule tables

| Table | What it holds | Evaluation |
|---|---|---|
| `qb_scoring` (one row) | `scale` (likert and yn values, `reverse_max`), `bands` (`code`, `min`, `max`, EN/HI names, `severity_points`), `rounding` (`half_up`), `core_module` (`rules[]` of `{when, module, path}` + `default`), `gate` (`qid`, `min_choices` ≥ 1, `max_choices`), `primary` (`tie: first_chosen`, `fallback: core`), `tier_thresholds` (`[{max_points, sessions}]`, last `max_points: null`), `pace` (per tier: `[{sessions, every}]`), `progress`, `registration` (which questions registration fills, gender and age-band mapping) | See §4 |
| `qb_point_rules` | One row per point source: `primary_band_severity`, `answer_value` (points = raw value of `qid`), `fixed` (`points` when `condition`) | Total = sum of all rules |
| `qb_overrides` | `cap` (tier = min(tier, sessions)) or `floor` (tier = max(tier, sessions)) when `condition` | In `sort` order, after the tier |
| `qb_visibility_rules` | A question is shown only if its condition is true | On top of module and path visibility (§4) |
| `qb_option_rules` | `hide` an option, or `order_first` (list it first) when `condition` | In `sort` order |
| `qb_flags` | `condition` + `effects` | Effects: `stop` (end, show the flag's own text, save nothing), `interrupt` (show the flag's own text immediately, then continue), `layout: crisis`, `report_block` (text key printed in the report), `force_format` (flags in `sort` order, first one wins, before the format rules), `notify` (`coordinator`, `counsellor`; passed through for notifications), `dashboard_tag` (counsellor dashboard), `printed: false` (never in the client report; appears only as a counsellor tag). The flag's own screen text is `qb_texts[key]`. A printed flag needs a text: its `report_block` text, or a text keyed by the flag; `printed: false` flags need none. Flags **never change the tier** |
| `qb_format_rules` | `format` (`individual`, `couple`, `mixed`, `individual_partner_joins`), optional `split` (mixed: sessions → [individual, couple]) and `add_text_key` | First match by `sort` wins; a flag's `force_format` overrides the result. The last rule should be a catch-all (`{ "all": [] }`); validation warns otherwise |
| `qb_report_rules` (one row) | `strengths`, `stuck`, `focus`, `tone`, `interpretation` (`order`, `second_min_band`, `fallback`: `core` or `none`), `layouts.crisis`, `format_texts`, `report_language` | Report assembly (Task 07). `interpretation.fallback = core`: a module with no text for its band (e.g. no `INTERP_B_LOW`) uses the core's text for the core's band, printed once |

## 4. Engine semantics (for Task 04)

1. **Registration fills intake.** Gender → `registration.sex_qid`, exact age → `registration.age_band_qid`
   via `age_bands`. Never asked twice.
2. **Core and path.** The first `core_module.rules[]` whose `when` is true sets the core module and path;
   otherwise `default`.
3. **Which questions are shown.** Intake, gate, dose and flag modules always; the core module; each chosen
   module. Within those, a question is shown when its `path` is `all` or equals the client's path, and its
   visibility rule (if any) is true. Options are hidden or reordered by `qb_option_rules`.
4. **Item score.** Likert / yes-no score = option value; reverse items score `reverse_max − value`.
5. **Module %** = sum of item scores ÷ (`reverse_max` × number of **shown** questions with `scored = yes`)
   × 100, rounded half up (25.5 → 26). Computed for the core and each chosen module. `scored = points`
   questions feed point rules only; `scored = no` never count.
6. **Band** = the band whose `min`–`max` contains the %.
7. **Gate**: the client chooses between `min_choices` and `max_choices` modules.
   **Primary** = chosen module with the highest band (tie → first chosen); none chosen → the core.
   **Second** = the other chosen module.
8. **Points** = sum of `qb_point_rules`. **Tier** = sessions of the first threshold with
   `max_points ≥ total` (`null` = no limit). Then overrides in `sort` order.
9. **Flags** in `sort` order. **Format** = first matching format rule, then any `force_format`.
10. Store the version id, answers, %, bands, points, tier, format, flags and path with the result.

Validation (`qb_validate_version` and `validatePayload`) checks: exclusive options (multi only, at most
one); gate `min_choices` (1 … `max_choices`); every printed flag has a text; `notify` recipients;
interpretation fallback; a catch-all last format rule (warning); Hindi on every text and label; likert =
exactly 4 options valued 0–3; yes/no = `no` 0 / `yes` 3; module codes; every question, option, module,
flag and text key referenced by a rule exists; gate option codes are modules; the strengths priority has
STRENGTH texts; tier thresholds match tiers; AGE_STOP, CRISIS and SAFETY exist and stay protected;
protected questions are unchanged and protected flags keep their condition and every effect (effects may
be added, e.g. a `notify` recipient, never removed or changed) against the version this one is based on;
scoring and report rules rows exist.

## 5. Patches (changing a live version without Excel)

`packages/questionbank/patches/<TEST>-<VERSION>.patch.json` lists operations that turn the live version into
the next one; each operation names its decision (`D1`–`D20`, see `decisions.md`). Operations:
`set_question`, `set_option`, `add_text` (or copy a text exactly from another test's live version),
`add_flag` (optionally `after` a flag), `set_flag` (`set` fields, `merge_effects`), `set_format_rules`
(whole list), `set_scoring` / `set_report_rules` (`merge` into or replace one field), `add_test_case`,
`set_test_case` (`merge_answers`, notes, expected).

`npm run qb:patch -- <patch.json> --sql <out.sql> [--publish "<note>"]` first applies the patch offline to
the base version (seed workbook or earlier patches) and validates it, then writes one SQL transaction:
`qb_start_new_version` → every operation (each must hit exactly one row) → `qb_raise_if_invalid` → with
`--publish`, `qb_submit_for_review` + `qb_publish`. The Task 05 editor will offer the same operations.
