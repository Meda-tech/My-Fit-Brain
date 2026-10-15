-- ==============================================================================
-- Task 03b — checks to run in the Supabase SQL Editor AFTER (docs/tasks/03b-apply.md):
--   1. supabase/migrations/20261016100000_qb_rule_decisions.sql
--   2. supabase/seed/question-bank/IA-1.2.patch-and-publish.sql
--   3. supabase/seed/question-bank/MA-1.1.patch-and-publish.sql
-- Read-only except section 7, which is always rolled back. Expected results are in the comments.
-- ==============================================================================

-- 1. Versions — expect IA 1.1 retired, IA 1.2 live, MA 1.0 retired, MA 1.1 live
select test_code, version_label, status, published_at, retired_at, change_note
from public.qb_versions order by test_code, created_at;

-- 2. Row counts
-- IA 1.1 (retired, unchanged): 13 · 99 · 384 · 69 · 77 · 4 · 1 · 6 · 3 · 2 · 4 · 8 · 6 · 1 · 6
-- IA 1.2 (live):               13 · 99 · 384 · 70 · 77 · 4 · 1 · 6 · 3 · 2 · 4 · 12 · 7 · 1 · 12
-- MA 1.0 (retired, unchanged):  9 · 58 · 227 · 51 · 42 · 4 · 1 · 6 · 2 · 1 · 2 · 8 · 2 · 1 · 5
-- MA 1.1 (live):                9 · 58 · 227 · 51 · 42 · 4 · 1 · 6 · 2 · 1 · 2 · 8 · 2 · 1 · 7
select v.test_code, v.version_label, v.status,
  (select count(*) from public.qb_modules x where x.version_id = v.id) as modules,
  (select count(*) from public.qb_questions x where x.version_id = v.id) as questions,
  (select count(*) from public.qb_options x where x.version_id = v.id) as options,
  (select count(*) from public.qb_texts x where x.version_id = v.id) as texts,
  (select count(*) from public.qb_item_texts x where x.version_id = v.id) as item_texts,
  (select count(*) from public.qb_tiers x where x.version_id = v.id) as tiers,
  (select count(*) from public.qb_scoring x where x.version_id = v.id) as scoring,
  (select count(*) from public.qb_point_rules x where x.version_id = v.id) as point_rules,
  (select count(*) from public.qb_overrides x where x.version_id = v.id) as overrides,
  (select count(*) from public.qb_visibility_rules x where x.version_id = v.id) as visibility_rules,
  (select count(*) from public.qb_option_rules x where x.version_id = v.id) as option_rules,
  (select count(*) from public.qb_flags x where x.version_id = v.id) as flags,
  (select count(*) from public.qb_format_rules x where x.version_id = v.id) as format_rules,
  (select count(*) from public.qb_report_rules x where x.version_id = v.id) as report_rules,
  (select count(*) from public.qb_test_cases x where x.version_id = v.id) as test_cases
from public.qb_versions v order by v.test_code, v.created_at;

-- 3. Validation of the live versions — expect no rows
select v.test_code, v.version_label, x.*
from public.qb_versions v, public.qb_validate_version(v.id) x
where v.status = 'live';

-- 4. The retired versions are unchanged — expect every column true
select
  (select scored from public.qb_questions q join public.qb_versions v on v.id = q.version_id
    where v.test_code = 'IA' and v.version_label = '1.1' and q.qid = 'R5') = 'yes' as ia11_r5_still_scored_yes,
  not exists (select 1 from public.qb_options o join public.qb_versions v on v.id = o.version_id
    where v.version_label in ('1.0', '1.1') and v.status = 'retired' and o.exclusive) as retired_have_no_exclusive,
  (select effects -> 'notify' from public.qb_flags f join public.qb_versions v on v.id = f.version_id
    where v.test_code = 'IA' and v.version_label = '1.1' and f.key = 'CRISIS') = '["coordinator"]'::jsonb as ia11_crisis_notify_unchanged,
  not (select gate ? 'min_choices' from public.qb_scoring s join public.qb_versions v on v.id = s.version_id
    where v.test_code = 'MA' and v.version_label = '1.0') as ma10_gate_unchanged;

-- 5. The decisions are present in the live versions — expect every column true
with ia as (select id from public.qb_versions where test_code = 'IA' and status = 'live'),
     ma as (select id from public.qb_versions where test_code = 'MA' and status = 'live')
select
  -- D2: exclusive "None of these"
  (select array_agg(qid || '.' || option_code order by qid) from public.qb_options
    where version_id in (select id from ia union all select id from ma) and exclusive)
    = array['MR1.none_of_these', 'R1.none_of_these'] as d2_exclusive,
  -- D4, D5, D6, D8: new flags in order
  (select array_agg(key order by sort) from public.qb_flags where version_id = (select id from ia))
    = array['AGE_STOP', 'CRISIS', 'SAFETY', 'MED_MALE', 'MED_FEMALE', 'MED_ONSET', 'MED_GENERAL', 'NRI',
            'MIND_LED_PATTERN', 'SEPARATION_THOUGHTS', 'RELATIONSHIP_SAFETY_CHECK', 'LOW_REPAIR_MOTIVATION'] as d4_d5_d6_d8_flags,
  (select bool_and(effects @> '{"force_format": "individual", "printed": false}') from public.qb_flags
    where version_id = (select id from ia) and key in ('RELATIONSHIP_SAFETY_CHECK', 'LOW_REPAIR_MOTIVATION')) as d5_d6_force_individual,
  -- D8: MED_ONSET text copied exactly from Mind
  (select (t.text_en, t.text_hi) = (m.text_en, m.text_hi)
    from public.qb_texts t, public.qb_texts m
    where t.version_id = (select id from ia) and t.key = 'MED_ONSET'
      and m.version_id = (select id from ma) and m.key = 'MED_ONSET') as d8_text_copied,
  -- D12: gate min 1 in both, IA catch-all format rule last
  (select bool_and((gate ->> 'min_choices')::int = 1) from public.qb_scoring
    where version_id in (select id from ia union all select id from ma)) as d12_min_choices,
  (select key from public.qb_format_rules where version_id = (select id from ia) order by sort desc limit 1)
    = 'DEFAULT_INDIVIDUAL' as d12_default_format,
  -- D13: interpretation fallback
  (select bool_and(interpretation ->> 'fallback' = 'core') from public.qb_report_rules
    where version_id in (select id from ia union all select id from ma)) as d13_fallback,
  -- D16: R2–R6 not scored
  (select bool_and(scored = 'no') from public.qb_questions
    where version_id = (select id from ia) and qid in ('R2', 'R3', 'R4', 'R5', 'R6')) as d16_r2_r6_not_scored,
  -- D19: CRISIS and SAFETY notify coordinator + counsellor
  (select bool_and(effects -> 'notify' = '["coordinator", "counsellor"]'::jsonb) from public.qb_flags
    where version_id in (select id from ia union all select id from ma) and key in ('CRISIS', 'SAFETY')) as d19_notify,
  -- Step 4: Worked example D keeps Couple with T7 = Sometimes; 6 + 2 manual cases
  (select answers ->> 'T7' from public.qb_test_cases
    where version_id = (select id from ia) and name = 'Worked example D') = 'sometimes' as worked_d_t7,
  (select count(*) from public.qb_test_cases where version_id = (select id from ia) and source = 'manual') = 6 as ia_manual_cases,
  (select count(*) from public.qb_test_cases where version_id = (select id from ma) and source = 'manual') = 2 as ma_manual_cases;

-- 6. Test names (D15, D17) — expect Hindi names and progress names filled
select code, name_en, name_hi, progress_name_en, progress_name_hi from public.qb_tests order by sort;

-- 7. The retired versions stay frozen — expect "rejected as expected" twice
do $$
begin
  begin
    update public.qb_questions q set scored = 'no'
    from public.qb_versions v where v.id = q.version_id and v.test_code = 'IA' and v.version_label = '1.1' and q.qid = 'R5';
    raise notice 'IA 1.1 edit: ALLOWED (unexpected)';
  exception when insufficient_privilege then
    raise notice 'IA 1.1 edit: rejected as expected';
  end;
  begin
    update public.qb_options o set exclusive = true
    from public.qb_versions v where v.id = o.version_id and v.test_code = 'MA' and v.version_label = '1.0'
      and o.qid = 'MR1' and o.option_code = 'none_of_these';
    raise notice 'MA 1.0 edit: ALLOWED (unexpected)';
  exception when insufficient_privilege then
    raise notice 'MA 1.0 edit: rejected as expected';
  end;
end;
$$;
