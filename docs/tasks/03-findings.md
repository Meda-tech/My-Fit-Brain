# Task 03 — Findings (Step 0)

Date: 2026-10-15 · Branch: `task-03-question-bank` (root, `admin/`, `clients/`), branched from
`task-02-foundation` because Tasks 01 and 02 are not yet merged into `main`.

Files (real names use dots, not underscores):
- `docs/questionbank/MFB_Intimacy_Assessment_QuestionBank_v1.1_1.xlsx`
- `docs/questionbank/MFB_Mind_Assessment_QuestionBank_v1.0_1.xlsx`
- `docs/spec/MFB_Assessments_Developer_Spec_v1.1_1.docx`

## 1. Tabs, headers, row counts (data rows, excluding the header)

### Intimacy v1.1
| Tab | Rows | Headers |
|---|---|---|
| README | 19 (title in row 1) | title: "MFB Intimacy Assessment v1.1 (Developer Question Bank)" |
| Questions | 99 | ID · Module · Module name (EN) · Module name (HI) · Type · Question (EN) · Question (HI) · Options / Scale (EN \|\| HI) · Reverse · Scored? · Routing / Dev note · Path |
| Scoring Rules | 28 | Step · Rule · Detail · Dev note |
| Session Tiers | 4 tiers + blank row + "Bands" sub-header + 4 bands | Sessions · Plan name (EN) · Plan name (HI) · Pace (EN) · Pace (HI) · Typical case |
| Report Text | 63 | Key · Module · Band · Text (EN) · Text (HI) |
| Strengths & Stuck | 77 | Item ID · Kind · Trigger · Text (EN) · Text (HI) |
| Flags & Safety | 6 | Flag · Trigger rule · Effect · Text (EN) · Text (HI) |
| Worked Examples | 6 cases (A–F) + blank + note row | Case · Profile · Primary band pts · D1 · D2 · Multi-area · Prior · Trust · Total points · Tier (formula) · Override note · Expected tier · Format |
| Progress Assessment | 11 | Rule · Detail |
| Change Log | 11 | # · Change in v1.1 · Where |

### Mind v1.0
| Tab | Rows | Headers |
|---|---|---|
| README | 16 | title: "MFB Mind Assessment v1.0 (Developer Question Bank)" |
| Questions | 58 | same as Intimacy **without Path** |
| Scoring Rules | 24 | Step · Rule · Detail · Dev note |
| Session Tiers | 4 tiers + "Bands" sub-header + 4 bands (no blank row) | same as Intimacy |
| Report Text | 44 | same |
| Strengths & Stuck | 42 | same |
| Flags & Safety | 7 | same |
| Worked Examples | 5 cases (A–E) + blank + note row | same, `MD1`, `MD2`, `Isolation` instead of `D1`, `D2`, `Trust` |
| Progress Assessment | 9 | Rule · Detail |
| Change Log | **missing** (the brief says "same tabs"; Mind has no Change Log) | — |

Expected question counts match: Intimacy 99, Mind 58.

## 2. Distinct values (Questions tab)

| Column | Intimacy | Mind |
|---|---|---|
| Module | INTAKE 8 · GATE 1 · CORE 12 · SOLO_CORE 10 · A 8 · B 8 · C 10 · D 8 · E 8 · F 8 · G 8 · DOSE 4 · FLAG 6 | INTAKE 5 · GATE 1 · MCORE 10 · H 8 · L 8 · W 8 · K 8 · DOSE 4 · FLAG 6 |
| Type | number 1 (I1) · single 12 · multi 2 · likert 75 · yn 9 | single 9 · multi 2 · likert 43 · yn 4 |
| Reverse | string `"FALSE"` 74 · `"TRUE"` 15 · boolean `true` 4 · `false` 6 (CS1–CS10 rows are real booleans) | boolean only: `false` 50 · `true` 8 |
| Scored? | Yes 79 · No 17 · Points 3 (D1–D3) | Yes 41 · No 14 · Points 3 (MD1–MD3) |
| Path | ALL 50 · PARTNER 39 · SOLO 10 | (no column → every question `all`) |

Notes:
- Intimacy R2–R6 are `Scored? = Yes` while Mind MR2–MR6 are `No`. FLAG items are never part of a
  module % (only core + chosen modules are scored), so this has no effect; stored literally.
- MR4 is a likert item inside the FLAG module, `Scored? = No`.
- F8 is a reverse yn item (`No(0) | Yes(3)`), unscored.

## 3. Option formats

| Format | Questions |
|---|---|
| ` / ` separator, no values | I1, MI1 (age bands: `Under 18 / 18–24 / 25–34 / 35–44 / 45–54 / 55+`) |
| ` \| ` separator, no values | I2–I8, M10, D4, R1, MI2–MI5, MD4, MR1 |
| ` \| ` separator, letter code prefix `X: `, no values | G1 (A–G), MG1 (H, L, W, K) — HI labels carry the same prefix |
| FREQ likert `Never(0) \| Rarely(1) \| Sometimes(2) \| Often(3)` (HI has no numbers) | 75 Intimacy, 43 Mind |
| YN `No(0) \| Yes(3)` (HI `नहीं \| हाँ`) | B4, F4, F8, T1, R2–R6, MR2, MR3, MR5, MR6 |
| ` \| ` separator, value with a space `Label (n)` in EN **and** HI | D1–D3, MD1–MD3 |

EN and HI option counts match for every question. Some labels contain ` / ` inside a single option
(`Self-employed / business`, `गृहिणी / गृहस्थ`), so ` / ` is only a separator when there is no ` | `.

## 4. Report Text keys

Intimacy (63): INTERP_CORE_{LOW,MILD,MODERATE,HIGH} · INTERP_{A..G}_{MILD,MODERATE,HIGH} (no `_LOW`
for modules A–G) · FOCUS_{A..G} · INTERP_SOLO_{LOW,MILD,MODERATE,HIGH} (module `SOLO_CORE`) · TITLE ·
SUBTITLE · DESIGNED_BY · H_SNAPSHOT · SNAPSHOT_NOTE · H_STRENGTHS · H_STUCK · H_MEANS · H_PLAN · H_FOCUS ·
H_MEDICAL · H_NEXT · PLAN_LINE · FORMAT_IND · FORMAT_IND_PLUS · FORMAT_COUPLE · FORMAT_MIXED ·
CLOSE_READY · CLOSE_GENTLE · NRI_LINE · DISCLAIMER · CRISIS_NEXT · H_PROGRESS · PROGRESS_LINE ·
PROGRESS_BETTER · PROGRESS_SAME · PROGRESS_WORSE.

Mind (44): INTERP_MCORE_{LOW,MILD,MODERATE,HIGH} · INTERP_{H,L,W,K}_{MILD,MODERATE,HIGH} ·
FOCUS_{H,L,W,K} · TITLE · SUBTITLE · DESIGNED_BY · H_SNAPSHOT · SNAPSHOT_NOTE · H_STRENGTHS · H_STUCK ·
H_MEANS · H_PLAN · H_FOCUS · H_MEDICAL · H_NEXT · PLAN_LINE · PARENT_LINE · CLOSE_READY · CLOSE_GENTLE ·
NRI_LINE · CRISIS_NEXT · H_PROGRESS · PROGRESS_LINE · PROGRESS_BETTER · PROGRESS_SAME · PROGRESS_WORSE ·
DISCLAIMER. (No FORMAT_* keys: Mind PLAN_LINE says "individual sessions" directly.)

Flags & Safety texts are stored with the report texts, key = flag name: Intimacy MED_MALE, MED_FEMALE,
MED_GENERAL, CRISIS, SAFETY, AGE_STOP · Mind MED_MIND_GENERAL, MED_ONSET, MED_PHYSICAL, COPING_TAG
(text is literally "(no client-facing text)", never printed), CRISIS, SAFETY, AGE_STOP. No key clashes.

## 5. Strengths & Stuck triggers

| Trigger text | Stored as | Intimacy | Mind |
|---|---|---|---|
| `raw answer = Often (3)` | `often` | 18 STRENGTH | 8 STRENGTH |
| `raw answer = Often (3) or Sometimes (2)` | `often_or_sometimes` | 6 STUCK (CS2–CS8) | 34 STUCK |
| `raw answer = Often (3) or Sometimes (2) / Yes` | `often_sometimes_or_yes` | 53 STUCK | — |

Every qid in the strengths priority lists (Scoring step 18 / 17) has a STRENGTH text.

## 6. Other observations

- **Test names in Hindi:** neither README has a Hindi test name. `qb_tests.name_hi` is NULL for IA and MA.
  (Report TITLE has Hindi, e.g. "MFB इंटिमेसी असेसमेंट — आपकी रिपोर्ट", but that is a report heading, not
  the product name.) Needs a Hindi product name from the content team.
- **DESIGNED_BY** text is "Designed by Dr. Neha Mehta, Consultant Psychologist" in both banks. CLAUDE.md
  allows "Designed by Dr. Neha Mehta" only and bans unapproved credentials. Stored literally (report
  text comes only from Excel); listed as an open question.
- **Worked Examples:** "Total points" and "Tier (formula)" are formulas with no cached values (empty
  strings). Only "Expected tier" and "Format" are literal.
- **Mind README** states format is always Individual; Mind PARENT_LINE for module K + age 18–24.
- **Repository structure risk (not changed in this task):** `admin/` and `clients/` are separate git
  repositories nested in the root repo as gitlinks without `.gitmodules`. A fresh clone of the root repo
  (e.g. by Vercel) gets empty `admin/` and `clients/` folders, so npm workspaces and
  `packages/questionbank` will only build where all three repos are checked out together. See
  `docs/deploy/vercel.md`.
