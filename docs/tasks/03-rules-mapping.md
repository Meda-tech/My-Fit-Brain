# Task 03 — Rules mapping (Excel prose → stored rules)

Seed files: `packages/questionbank/seeds/IA-1.1.rules.json` and `MA-1.0.rules.json`. Condition format:
`docs/questionbank/rules-reference.md`. Rules are encoded literally; where the source is ambiguous the
most literal reading is used and the case is listed under **Open questions** (end of file).

Short forms in the JSON column: `ans(Q=x)` = `{fact: answer, q: Q, op: eq, value: x}`,
`val(Q≥n)` = `{fact: answer_value, …}`, `band(M≥B)` = `{fact: band, module: M, …}`,
`chosen(M)` = `{fact: module_chosen, value: M}`, `any_except(Q,[…])` = `answered_any_except`.

## MFB Intimacy Assessment v1.1

### Scoring Rules tab

| # | Source rule | Stored as |
|---|---|---|
| 1 | Item score: FREQ 0–3, reverse = 3 − answer, YN No 0 / Yes 3 | `scoring.scale` `{likert: never 0…often 3, yn: no 0 yes 3, reverse_max: 3}` + `qb_questions.reverse` |
| 2 | Module % = sum ÷ (3 × scored items shown) × 100, rounded; unscored M10, F8, C12, CS10, T8, T1, D4; SOLO skips PARTNER items | `qb_questions.scored = no` for exactly those 7 · `qb_questions.path` · `scoring.rounding = half_up` (OQ 3) |
| 3 | Band 0–25 Low · 26–50 Mild · 51–75 Moderate · 76–100 High | `scoring.bands` (cross-checked against the Session Tiers band rows on import) |
| 4 | Primary = chosen module with highest band (tie → first chosen); none → core | `scoring.primary` `{tie: first_chosen, fallback: core}` |
| 5 | Severity points Low 0 · Mild 1 · Moderate 2 · High 3 | `point_rules.SEVERITY` (`primary_band_severity`) + `bands[].severity_points` |
| 6 | Duration points = D1 value | `point_rules.DURATION` `{source: answer_value, qid: D1}` |
| 7 | Impact points = D2 value | `point_rules.IMPACT` `{source: answer_value, qid: D2}` |
| 8 | +2 if two chosen modules Moderate+ OR one chosen Moderate+ and core Moderate+ | `point_rules.MULTI_AREA` 2 when `any[count_bands(chosen ≥ Moderate) ≥ 2, all[count_bands ≥ 1, band(core ≥ Moderate)]]` |
| 9 | +1 if D3 ≥ 2 | `point_rules.PRIOR_ATTEMPTS` 1 when `val(D3≥2)` |
| 10 | +1 if G chosen and G Moderate+ | `point_rules.TRUST_WOUND` 1 when `all[chosen(G), band(G≥Moderate)]` |
| 11 | Total = sum of 5–10 (0–13) | Engine: sum of `qb_point_rules` |
| 12 | Tier 0–4 → 4 · 5–6 → 6 · 7–8 → 8 · 9+ → 12 (target mix 30/30/25/15) | `scoring.tier_thresholds` `[{4,4},{6,6},{8,8},{null,12}]`. Target mix / monthly alert is reporting, not a scoring rule — not stored |
| 13 | All mild: every band (core + chosen) Low/Mild → min(tier, 6) | `overrides.ALL_MILD` cap 6 when `all_bands(core_and_chosen ≤ Mild)` |
| 14 | Primary High AND D1 ≥ 2 → max(tier, 8) | `overrides.SEVERE_LONG` floor 8 when `all[band(primary=High), val(D1≥2)]` |
| 15 | G band High → max(tier, 8) | `overrides.TRUST_WOUND_HIGH` floor 8 when `band(G=High)` |
| 16 | Format: couple A, B, G · individual C–F · willing = I6 option 1 · SAFETY or not willing / unaware / no partner → Individual · only couple → Couple · only individual → Individual (partner joins 1–2) · one of each → Mixed 3+1, 4+2, 5+3, 7+5 · SOLO → Individual | `module_kinds` (A, B, G couple; C–F individual) + `format_rules`: 1 SAFETY_INDIVIDUAL `flag(SAFETY)` · 2 SOLO_INDIVIDUAL `path=solo` · 3 PARTNER_NOT_WILLING `not ans(I6=yes_and_they_are_willing_to_join_sessions)` · 4 COUPLE_ONLY `chosen_kinds only [couple]` · 5 INDIVIDUAL_ONLY → `individual_partner_joins` · 6 MIXED `chosen_kinds includes [couple, individual]`, split `{4:[3,1],6:[4,2],8:[5,3],12:[7,5]}` (OQ 12) |
| 17 | Pace 4/6/8 weekly · 12 = weekly for 8 then fortnightly for 4 | `scoring.pace` |
| 18 | Strengths: reverse items answered Often, priority C6, C1, CS1, M4, F6, T7, T8, A7, C12, CS10, C2, C3, CS4, CS9, C9, C7, A8, B5; print 2; never invent | `report_rules.strengths` `{count 2, priority [...], answer: often}` |
| 19 | Stuck: non-reverse items Often then Sometimes; primary, second, core; print 3 | `report_rules.stuck` `{count 3, module_order [primary, second, core], answer_order [often, sometimes]}` |
| 20 | Focus: primary FOCUS; second Moderate+ → 2 primary + 1 second | `report_rules.focus` `{lines 3, second_module_min_band Moderate, split_when_second [2,1], separator " · "}` |
| 21 | Tone: C12 (PARTNER) / CS10 (SOLO); D4 = Fully/Yes and tone raw ≥ 2 → ready, else gentle | `report_rules.tone` `all[ans(D4 in [yes, fully_committed]), any[all[path=partner, val(C12≥2)], all[path=solo, val(CS10≥2)]]]` → CLOSE_READY / CLOSE_GENTLE |
| 22 | Flags never change the tier; MEDICAL adds a block; SAFETY forces Individual; CRISIS → crisis layout | `qb_flags` (no tier effect exists in the schema) |
| 23 | Store answers, %, bands, points, tier, format, flags, language, timestamp; never free text | Not a question-bank rule (Task 04 / 06 storage) |
| 24 | Path: I6 = no partner → SOLO; core CS1–CS10; gate hides A, B; PARTNER items never shown | `scoring.core_module` `rules: [{when ans(I6=i_do_not_have_a_partner_right_now), module SOLO_CORE, path solo}]`, default CORE / partner · `option_rules` G1.A and G1.B hide when `path=solo` · `qb_questions.path` |
| 25 | Age stop: I1 = Under 18 → AGE_STOP, end, save nothing; payment / refund | `flags.AGE_STOP` `ans(I1=under_18)` → `{stop: true}` (protected). Payment and refund: payments task |
| 26 | Crisis layout: hide plan heading, sessions heading and plan line; CRISIS block first; CRISIS_NEXT next step; tier stored for counsellor only; same-day call | `report_rules.layouts.crisis` `{top_block CRISIS, hide [H_PLAN, PLAN_LINE, H_FOCUS], next_key CRISIS_NEXT}` + `flags.CRISIS` `layout: crisis`, `notify: [coordinator]`. Call timing is an operations rule |
| 27 | Progress Assessment at sessions 4, 8 (and 12) | `scoring.progress` (below) |
| 28 | Report header TITLE, SUBTITLE, DESIGNED_BY, endorsed logo, founder seal | Texts TITLE, SUBTITLE, DESIGNED_BY in `qb_texts`; logos are part of the report template (Task 07) (OQ 14) |

### Flags & Safety tab

| Flag | Source trigger | Stored condition | Effects |
|---|---|---|---|
| MED_MALE | (Male OR C chosen) AND any of: R4 = Yes · R2 = Yes · M10 = Suddenly · (M3 ≥ 2 AND (M4 = Never OR R1 any condition OR age ≥ 40)) | `all[any[sex=male, chosen(C)], any[ans(R4=yes), ans(R2=yes), ans(M10=suddenly_within_a_few_weeks), all[val(M3≥2), any[ans(M4=never), any_except(R1,[none_of_these]), age≥40]]]]` (OQ 1, 2) | report_block MED_MALE, dashboard_tag MED_MALE |
| MED_FEMALE | (Female OR D chosen) AND any of: R3 = Yes · R2 = Yes · (D chosen AND F8 = No AND D band ≥ Mild) | `all[any[sex=female, chosen(D)], any[ans(R3=yes), ans(R2=yes), all[chosen(D), ans(F8=no), band(D≥Mild)]]]` | report_block MED_FEMALE, dashboard_tag MED_FEMALE |
| MED_GENERAL | R1 any condition AND no MED_MALE/MED_FEMALE AND (B1 ≥ 2 OR F chosen) | `all[any_except(R1,[none_of_these]), not flag(MED_MALE), not flag(MED_FEMALE), any[val(B1≥2), chosen(F)]]` | report_block MED_GENERAL (short; no tag listed) |
| CRISIS | R5 = Yes | `ans(R5=yes)` (protected) | interrupt, layout crisis, report_block CRISIS, notify coordinator |
| SAFETY | R6 = Yes | `ans(R6=yes)` (protected) | force_format individual, report_block SAFETY, notify coordinator ("team notified"; no couple invitation follows from the forced format) |
| AGE_STOP | I1 = Under 18 | `ans(I1=under_18)` (protected) | stop |

### Routing / Dev note column (Questions tab)

| Question | Note | Stored as |
|---|---|---|
| I1 | Under 18 = AGE_STOP; store exact age band | `flags.AGE_STOP`; `scoring.registration.age_bands` |
| I2 | Male → C · Female → D · Prefer not to say → both in G1 | `option_rules` G1.C hide when `ans(I2=female)`, G1.D hide when `ans(I2=male)` |
| I5 | NRI tag for report tone and session timing | `flags.NRI` `ans(I5=outside_india)` → dashboard_tag NRI, report_block NRI_LINE (OQ 9) |
| I6 | Sets PATH; option 1 = partner willing (drives couple format) | `scoring.core_module`; `format_rules.PARTNER_NOT_WILLING` |
| I7 | Conception pressure context | Context for the counsellor only; no rule |
| G1 | Max 2; SOLO hides A, B; hide C if Female; hide D if Male | `scoring.gate {qid G1, max_choices 2}`; `option_rules` (4 rows) |
| C11 | Score 3 here also feeds Impact | **Not encoded** (OQ 4) |
| C12 | Not in severity; report tone (PARTNER) | `scored = no`; `report_rules.tone` |
| CS10 | Not in severity; report tone (SOLO) | `scored = no`; `report_rules.tone` |
| M4 | M4 = Never + M3 ≥ 2 = medical signal | Branch of MED_MALE |
| M5 | High = psychological pattern (good news for therapy) | `flags.MIND_LED_PATTERN` `ans(M5=often)` → dashboard_tag, printed false (OQ 10) |
| M10 | Sudden = medical flag. Not scored | `scored = no`; branch of MED_MALE |
| F8 | No + module D ≥ Mild = medical flag. Not scored | `scored = no`; branch of MED_FEMALE |
| T1 | No details are asked, ever | Content rule (no free text anywhere); `scored = no` |
| T7 | Score 0 here (Never safe) = pair with R6 | **Not encoded** (OQ 5) |
| T8 | Not in severity; drives Couple vs Individual format | `scored = no`; format effect **not encoded** (OQ 6) |
| D1 | Duration points 0–3 | `point_rules.DURATION` |
| D2 | Impact points 0–3 | `point_rules.IMPACT` |
| D3 | Prior-attempts points; ≥ 2 adds +1 | `point_rules.PRIOR_ATTEMPTS` (the D3 value itself is not added; matches Scoring step 9) |
| D4 | Not scored; report tone + counsellor note | `scored = no`; `report_rules.tone` |
| R1 | Any + (M3 ≥ 2 or F1 ≥ 2 or B1 ≥ 2) = MEDICAL flag | Flags tab wording used (MED_MALE / MED_GENERAL) (OQ 7) |
| R2 | Yes = MEDICAL flag | Branch of MED_MALE and MED_FEMALE (OQ 8) |
| R3 | Yes = MEDICAL (gynaecologist). Show if I2 = Female OR D chosen | `visibility_rules.R3` `any[ans(I2=female), chosen(D)]`; branch of MED_FEMALE |
| R4 | Yes = MEDICAL (urologist/andrologist). Show if I2 = Male OR C chosen | `visibility_rules.R4` `any[ans(I2=male), chosen(C)]`; branch of MED_MALE |
| R5 | Yes = CRISIS; support screen, then continue; crisis layout | `flags.CRISIS` |
| R6 | Yes = SAFETY; Individual only; helpline | `flags.SAFETY` |

### Session Tiers and Progress Assessment tabs

| Source | Stored as |
|---|---|
| Tiers 4/6/8/12 (plan EN/HI, pace EN/HI, typical case) | `qb_tiers` (content) |
| Band names Low/कम · Mild/हल्का · Moderate/मध्यम · High/ज़्यादा and ranges | `scoring.bands[].name_en/name_hi/min/max`; import fails if they differ from the tab |
| When: after sessions 4 and 8; 12 for 12-session plans | `progress.schedule [{4},{8},{12, plan_sessions 12}]` |
| Items asked: same core + same 1–2 modules + D2 + R5 + R6 | `progress.items {core: true, chosen_modules: true, qids [D2, R5, R6]}` |
| Items skipped: I1–I8, G1, D1, D3, D4, R1–R4 (reuse first answers) | `progress.reuse_qids` |
| Scoring: same item scoring and %; no new tier | Engine (same rules) |
| Change ≤ −10 → BETTER · −9…+9 → SAME · ≥ +10 → WORSE | `progress {better_at −10, worse_at 10, texts {better, same, worse}}` |
| Report: H_PROGRESS, PROGRESS_LINE per area, no plan box | `progress.texts {heading H_PROGRESS, line PROGRESS_LINE}` |
| Safety: CRISIS / SAFETY rules apply as before | Same `qb_flags` (R5, R6 are asked again) |
| Store: Progress ID = original + -P1, -P2, -P3 | `progress.id_suffix "-P"` |
| Name "MFB Intimacy Progress Assessment"; length; counsellor side-by-side view | Not stored (no report text key; product/UI decision) (OQ 17) |

## MFB Mind Assessment v1.0

### Scoring Rules tab

| # | Source rule | Stored as |
|---|---|---|
| 1 | Item score 0–3, reverse = 3 − answer | `scoring.scale` + `reverse` |
| 2 | Module %; unscored MC10, MD4, MR1–MR6 | `scored = no` for those (MR4 too); `rounding half_up` |
| 3 | Bands as Intimacy | `scoring.bands` |
| 4 | Primary; none → MCORE | `scoring.primary` |
| 5–7 | Severity, MD1 duration, MD2 impact | `point_rules` SEVERITY, DURATION (MD1), IMPACT (MD2) |
| 8 | Multi-area +2 (with MCORE) | `point_rules.MULTI_AREA` (same shape as Intimacy) |
| 9 | +1 if MD3 ≥ 2 | `point_rules.PRIOR_ATTEMPTS` |
| 10 | Isolation +1 if MC7 raw = Never | `point_rules.ISOLATION` 1 when `ans(MC7=never)` |
| 11–12 | Total; tiers 0–4/5–6/7–8/9+ | Engine sum; `scoring.tier_thresholds` |
| 13 | All mild cap 6 | `overrides.ALL_MILD` |
| 14 | Primary High and MD1 ≥ 2 → min 8 | `overrides.SEVERE_LONG` |
| 15 | Always Individual; K chosen and age 18–24 → PARENT_LINE | `module_kinds` H, L, W, K individual · `format_rules` 1 STUDIES_PARENT_LINE `all[chosen(K), age_band=18_24]` → individual + `add_text_key PARENT_LINE` · 2 ALWAYS_INDIVIDUAL `all[]` (OQ 11) |
| 16 | Pace | `scoring.pace` |
| 17 | Strengths: priority MC7, MC10, MC6, MC9, MC1, MC2, W8, K8 | `report_rules.strengths` |
| 18 | Stuck: Often then Sometimes; primary, second, MCORE | `report_rules.stuck` |
| 19 | Focus | `report_rules.focus` |
| 20 | Tone: MD4 = Yes/Fully and MC10 raw ≥ 2 → CLOSE_READY | `report_rules.tone` `all[ans(MD4 in [yes, fully_committed]), val(MC10≥2)]` |
| 21 | Flags never change tier; CRISIS → crisis layout | `qb_flags`; `report_rules.layouts.crisis` |
| 22 | Age stop | `flags.AGE_STOP` `ans(MI1=under_18)` |
| 23 | Store (incl. consultation booking ID) | Not a question-bank rule |
| 24 | Progress at 4, 8 (12) | `scoring.progress` |

### Flags & Safety tab

| Flag | Source trigger | Stored condition | Effects |
|---|---|---|---|
| MED_MIND_GENERAL | MR1 any condition AND (L or H chosen OR MCORE ≥ Moderate) | `all[any_except(MR1,[none_of_these]), any[chosen(L), chosen(H), band(core≥Moderate)]]` | report_block (short) |
| MED_ONSET | MR2 = Yes | `ans(MR2=yes)` | report_block, dashboard_tag |
| MED_PHYSICAL | MR3 = Yes | `ans(MR3=yes)` | report_block, dashboard_tag; first medical flag by `sort` ("top of the medical section") (OQ 20) |
| COPING_TAG | MR4 ≥ Sometimes | `val(MR4≥2)` | dashboard_tag, printed false |
| CRISIS | MR5 = Yes | `ans(MR5=yes)` | interrupt, layout crisis, report_block, notify coordinator |
| SAFETY | MR6 = Yes | `ans(MR6=yes)` | report_block, notify coordinator (no family member contacted without permission: operations rule) |
| AGE_STOP | MI1 = Under 18 | `ans(MI1=under_18)` | stop |

### Routing / Dev note column

| Question | Note | Stored as |
|---|---|---|
| MI1 | Under 18 = AGE_STOP | `flags.AGE_STOP` |
| MI2 | Used only for Hindi grammar in the report | `scoring.registration.sex_qid` (report grammar: Task 07) |
| MI3 | Orders gate options (K first for Student, W first for Working/Self-employed) | `option_rules` MG1.K `order_first` when `ans(MI3=student)`; MG1.W when `ans(MI3 in [working_job, self_employed_business])` |
| MI4 | NRI tag | `flags.NRI` (OQ 9) |
| MG1 | Max 2; order by MI3 | `scoring.gate {MG1, 2}`; option rules |
| MC7 | Raw Never adds the Isolation point | `point_rules.ISOLATION` |
| MC10 | Not in severity; report tone | `scored = no`; tone |
| H4 | H4 ≥ 2 shows MR3 | `visibility_rules.MR3` |
| MD1–MD3 | Duration, impact, +1 if ≥ 2 | point rules |
| MD4 | Report tone + counsellor note | tone |
| MR1 | Feeds MED_MIND_GENERAL | flag condition |
| MR2 | Yes = MED_ONSET | flag |
| MR3 | Show only if H chosen OR H4 ≥ 2; Yes = MED_PHYSICAL | `visibility_rules.MR3` `any[chosen(H), val(H4≥2)]`; flag |
| MR4 | ≥ Sometimes = COPING_TAG; never printed | `flags.COPING_TAG` |
| MR5 | Yes = CRISIS; support screen then continue | `flags.CRISIS` |
| MR6 | Yes = SAFETY | `flags.SAFETY` |

Session Tiers and Progress Assessment tabs map exactly as for Intimacy (`progress.items.qids [MD2, MR5, MR6]`,
`reuse_qids [MI1–MI5, MG1, MD1, MD3, MD4, MR1–MR4]`).

## Open questions

Each one is encoded with the most literal reading (or not encoded, where no literal reading exists) and
needs a decision from Dr. Neha Mehta or the owner.

1. **MED_MALE "age ≥ 40"** (Flags & Safety) — encoded with the **exact age** from registration (`{fact: age, op: gte, value: 40}`), not the I1 band (the 35–44 band straddles 40).
2. **"R1 has any condition"** / **"MR1 has any condition"** — encoded as any option except `none_of_these`. The workbook does not say whether "None of these" excludes the other options in the UI.
3. **Rounding of module %** ("rounded", Scoring step 2) — encoded as half up: 25.5 → 26 → Mild; 50.5 → 51 → Moderate; 75.5 → 76 → High.
4. **C11 "Score 3 here also feeds Impact"** — not encoded. Scoring step 7 says Impact = D2 only. Does C11 = Often raise Impact to 3, add +1, or only inform the counsellor?
5. **T7 "Score 0 here (Never safe) = pair with R6"** — not encoded. T7 is reverse-scored, so *raw* Never gives score 3, not 0. Which is meant, and what does "pair with R6" do (raise SAFETY, a counsellor tag, or nothing automatic)?
6. **T8 "drives Couple vs Individual format"** — not encoded. Scoring step 16 (Format) does not mention T8. Should a low T8 (e.g. Never/Rarely want to repair) force Individual?
7. **R1 note "Any + (M3 ≥ 2 or F1 ≥ 2 or B1 ≥ 2) = MEDICAL flag"** differs from the Flags & Safety tab (MED_MALE uses M3 with M4/R1/age; MED_GENERAL uses B1 or module F; F1 is not used anywhere). The Flags tab was encoded.
8. **R2 note "Yes = MEDICAL flag"** — on the Flags tab R2 only raises MED_MALE (male or C chosen) or MED_FEMALE (female or D chosen). A "Prefer not to say" client who chose neither C nor D gets no flag for R2 = Yes. Flags tab encoded.
9. **NRI** — I5 / MI4 notes say "NRI tag for report tone and session timing" and Report Text has NRI_LINE with no trigger. Encoded as flag NRI when "Outside India": dashboard tag + NRI_LINE block. Confirm.
10. **M5 "High = psychological pattern"** (and the spec's counsellor-view "M5 mind-led pattern signal for men") — encoded as a dashboard-only flag MIND_LED_PATTERN when M5 = Often. Confirm the threshold (Often only, or Sometimes+) and whether it should be male-only.
11. **PARENT_LINE "age 18–24"** — encoded with the age band `18_24` (same as exact age 18–24).
12. **No module chosen.** The gate says "up to 2" and Primary falls back to the core, so zero choices seem allowed, but no Format rule covers a willing partner with no chosen module (COUPLE_ONLY / INDIVIDUAL_ONLY need at least one module). What format applies? Is at least one choice required?
13. **Interpretation text for a Low chosen module** — Report Text has no `INTERP_<A–G>_LOW` / `INTERP_<H|L|W|K>_LOW`. If the primary module is Low, nothing is printed for it. Intended?
14. **DESIGNED_BY** = "Designed by Dr. Neha Mehta, Consultant Psychologist" (both banks). CLAUDE.md allows only "Designed by Dr. Neha Mehta" and bans unapproved credentials. Stored literally (report text comes only from Excel); the Excel needs a decision.
15. **Hindi product names** — neither README gives a Hindi name for the tests; `qb_tests.name_hi` is NULL.
16. **Intimacy R2–R6 are "Scored? = Yes"** while Mind MR2–MR6 are "No". No effect (flag items are never in a module %); stored literally.
17. **Progress Assessment name** ("MFB Intimacy Progress Assessment", "MFB Mind Progress Assessment") is not a Report Text key, so it is not stored as a text.
18. **Tier mix target and monthly alert** (README, Scoring step 12) — reporting / operations, not stored as a rule.
19. **SAFETY "Team notified"** — encoded as `notify: [coordinator]` (the only recipient the schema allows).
20. **MED_PHYSICAL "at the top of the medical section"** — expressed by `sort` (first medical flag); the report must print medical blocks in flag order.
