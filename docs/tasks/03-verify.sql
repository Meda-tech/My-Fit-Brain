-- ==============================================================================
-- Task 03 — checks to run in the Supabase SQL Editor (testing database) AFTER:
--   1. supabase/migrations/20261016000000_question_bank.sql
--   2. supabase/seed/question-bank/IA-1.1.load-and-publish.sql
--   3. supabase/seed/question-bank/MA-1.0.load-and-publish.sql
-- Every check that writes is undone (rolled back). Expected results are in the comments.
-- Run the sections one at a time if the editor shows only the last result.
-- ==============================================================================

-- 1. Versions (expect IA 1.1 live, MA 1.0 live)
select test_code, version_label, status, published_at, change_note
from public.qb_versions order by test_code, created_at;

-- 2. Row counts per live version
-- Expect IA: modules 13, questions 99, options 384, texts 69, item_texts 77, tiers 4, scoring 1,
--   point_rules 6, overrides 3, visibility_rules 2, option_rules 4, flags 8, format_rules 6,
--   report_rules 1, test_cases 6
-- Expect MA: modules 9, questions 58, options 227, texts 51, item_texts 42, tiers 4, scoring 1,
--   point_rules 6, overrides 2, visibility_rules 1, option_rules 2, flags 8, format_rules 2,
--   report_rules 1, test_cases 5
select v.test_code, v.version_label,
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
from public.qb_versions v where v.status = 'live' order by v.test_code;

-- 3. Validation of both live versions (expect no rows)
select v.test_code, x.*
from public.qb_versions v, public.qb_validate_version(v.id) x
where v.status = 'live';

-- 4. Freeze, copy and publish checks. Each NOTICE should end in "as expected".
do $$
declare
  v_live uuid;
  v_new uuid;
  v_status text;
  v_diff integer;
begin
  select id into v_live from public.qb_versions where test_code = 'IA' and status = 'live';
  if v_live is null then
    raise exception 'Load IA 1.1 first.';
  end if;

  -- 4a. Editing a row of a live version fails (also for the service role / SQL Editor).
  begin
    update public.qb_questions set text_en = text_en || ' ' where version_id = v_live and qid = 'C1';
    raise notice '4a. editing a live row: ALLOWED (unexpected)';
  exception when insufficient_privilege then
    raise notice '4a. editing a live row: rejected as expected (%)', sqlerrm;
  end;
  begin
    delete from public.qb_options where version_id = v_live and qid = 'C1';
    raise notice '4a. deleting a live row: ALLOWED (unexpected)';
  exception when insufficient_privilege then
    raise notice '4a. deleting a live row: rejected as expected';
  end;
  begin
    update public.qb_versions set status = 'retired' where id = v_live;
    raise notice '4a. direct status change: ALLOWED (unexpected)';
  exception when insufficient_privilege then
    raise notice '4a. direct status change: rejected as expected';
  end;

  -- 4b + 4c inside one block that is always undone.
  begin
    v_new := public.qb_start_new_version('IA', '99.0');

    -- 4b. Full copy: same row count in every table.
    select count(*) into v_diff
    from (
      select t, (count(*) filter (where version_id = v_live)) as a, (count(*) filter (where version_id = v_new)) as b
      from (
        select 'modules' t, version_id from public.qb_modules
        union all select 'questions', version_id from public.qb_questions
        union all select 'options', version_id from public.qb_options
        union all select 'texts', version_id from public.qb_texts
        union all select 'item_texts', version_id from public.qb_item_texts
        union all select 'tiers', version_id from public.qb_tiers
        union all select 'scoring', version_id from public.qb_scoring
        union all select 'point_rules', version_id from public.qb_point_rules
        union all select 'overrides', version_id from public.qb_overrides
        union all select 'visibility_rules', version_id from public.qb_visibility_rules
        union all select 'option_rules', version_id from public.qb_option_rules
        union all select 'flags', version_id from public.qb_flags
        union all select 'format_rules', version_id from public.qb_format_rules
        union all select 'report_rules', version_id from public.qb_report_rules
        union all select 'test_cases', version_id from public.qb_test_cases
      ) rows_by_table
      group by t
    ) per_table
    where a <> b;
    if v_diff = 0 then
      raise notice '4b. qb_start_new_version: full copy, same row counts as expected';
    else
      raise notice '4b. qb_start_new_version: % table(s) differ (unexpected)', v_diff;
    end if;

    -- A draft can be edited.
    update public.qb_questions set text_en = text_en where version_id = v_new and qid = 'C1';

    -- 4c. Publishing a second version retires the first.
    perform public.qb_submit_for_review(v_new);
    perform public.qb_publish(v_new, 'Verification only (rolled back)');
    select status into v_status from public.qb_versions where id = v_live;
    if v_status = 'retired' and (select status from public.qb_versions where id = v_new) = 'live' then
      raise notice '4c. publishing 99.0 retired 1.1 as expected';
    else
      raise notice '4c. after publish, 1.1 is % (unexpected)', v_status;
    end if;

    raise exception 'undo';
  exception when others then
    if sqlerrm <> 'undo' then
      raise notice '4b/4c failed (unexpected): %', sqlerrm;
    end if;
  end;

  -- 4d. Nothing above was kept.
  if (select status from public.qb_versions where id = v_live) = 'live'
     and not exists (select 1 from public.qb_versions where test_code = 'IA' and version_label = '99.0') then
    raise notice '4d. checks were rolled back as expected';
  end if;
end;
$$;

-- 5. A signed-in client (not staff) can read live questions, never rules, texts or test cases.
--    Run these four statements together. Expect: questions and options > 0, every other count 0.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c11e","role":"authenticated"}', true);
select 'qb_versions (live only)' as table_name, count(*) as visible_rows from public.qb_versions
union all select 'qb_questions (expect > 0)', count(*) from public.qb_questions
union all select 'qb_options (expect > 0)', count(*) from public.qb_options
union all select 'qb_flags (expect 0)', count(*) from public.qb_flags
union all select 'qb_texts (expect 0)', count(*) from public.qb_texts
union all select 'qb_test_cases (expect 0)', count(*) from public.qb_test_cases
union all select 'qb_scoring (expect 0)', count(*) from public.qb_scoring
union all select 'qb_audit_log (expect 0)', count(*) from public.qb_audit_log;
rollback;

-- 6. Permissions: active super admins can edit and approve content
select email, role, can_edit_content, can_approve_content from public.profiles order by role, email;
