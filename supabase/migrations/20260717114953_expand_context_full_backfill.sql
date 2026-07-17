-- Expand the policy-governed Context index from a 10K canary ceiling to the
-- full current Dirt King corpus while preserving the existing provider,
-- retention, field-allowlist, rate, daily-operation, and spend gates.

ALTER TABLE public.context_index_operation_controls
  DROP CONSTRAINT context_index_operation_controls_canary_record_limit_check,
  ADD CONSTRAINT context_index_operation_controls_canary_record_limit_check
    CHECK (canary_record_limit BETWEEN 0 AND 100000);

ALTER TABLE public.context_index_jobs
  DROP CONSTRAINT context_index_jobs_requested_limit_check,
  ADD CONSTRAINT context_index_jobs_requested_limit_check
    CHECK (requested_limit BETWEEN 0 AND 100000);

-- Keep the stable v1 RPC signatures while widening only their validated
-- corpus bounds. Assert the expected source text so schema drift fails the
-- migration instead of silently changing an unrelated function fragment.
DO $migration$
DECLARE
  definition TEXT;
  updated_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.configure_context_index_operations_v1(uuid,text,boolean,integer,integer,integer,bigint,text,timestamp with time zone)'::regprocedure
  ) INTO definition;
  IF position('p_canary_record_limit NOT BETWEEN 0 AND 10000' IN definition) = 0 THEN
    RAISE EXCEPTION 'configure_context_index_operations_v1 bound not found';
  END IF;
  updated_definition := replace(
    definition,
    'p_canary_record_limit NOT BETWEEN 0 AND 10000',
    'p_canary_record_limit NOT BETWEEN 0 AND 100000'
  );
  EXECUTE updated_definition;

  SELECT pg_get_functiondef(
    'public.reconcile_context_index_work_v1(uuid,text,integer,timestamp with time zone)'::regprocedure
  ) INTO definition;
  IF position('p_requested_limit NOT BETWEEN 0 AND 10000' IN definition) = 0 THEN
    RAISE EXCEPTION 'reconcile_context_index_work_v1 bound not found';
  END IF;
  updated_definition := replace(
    definition,
    'p_requested_limit NOT BETWEEN 0 AND 10000',
    'p_requested_limit NOT BETWEEN 0 AND 100000'
  );
  EXECUTE updated_definition;
END
$migration$;

COMMENT ON COLUMN public.context_index_operation_controls.canary_record_limit IS
  'Maximum distinct canonical records admitted to the provider. Field policy, retention, rate, daily operation, and spend gates remain independently enforced.';
