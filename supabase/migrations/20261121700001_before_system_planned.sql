-- Before the system, part 2 (owner, 2026-11-21). Run after 20261121700000_before_system.sql.
--
-- REMOVES NO ROWS. For purchases from before the system, the journey steps that are not done lose their planned time
-- (planned_at set to empty), as the go-live rule already did for the calls it closed: nothing of theirs is planned or
-- due. Steps already done keep their times.
--
-- Checks: docs/tasks/31-before-system-verify.sql (and docs/tasks/23-calls-go-live-verify.sql)

BEGIN;

UPDATE public.purchase_stages s SET planned_at = NULL
FROM public.purchases pu
WHERE pu.id = s.purchase_id AND s.done_at IS NULL AND s.planned_at IS NOT NULL AND public.before_system(pu);

COMMIT;
