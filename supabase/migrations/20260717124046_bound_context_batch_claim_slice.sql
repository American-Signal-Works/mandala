-- Materialize and lock the bounded queue slice before joining policies,
-- ledgers, and canonical records. This prevents the planner from validating
-- every pending row before honoring LIMIT.

DO $migration$
DECLARE
  definition TEXT;
  updated_definition TEXT;
  original_fragment TEXT := 'WITH base AS MATERIALIZED (
        SELECT outbox.id
        FROM public.context_index_outbox outbox
        JOIN public.context_index_ledger ledger';
  replacement_fragment TEXT := 'WITH queue_slice AS MATERIALIZED (
        SELECT outbox.id
        FROM public.context_index_outbox outbox
        WHERE outbox.company_id = controls.company_id
          AND outbox.provider = controls.provider
          AND outbox.delivery_state IN (''pending'', ''retry'')
          AND outbox.operation = ''add''
          AND outbox.available_at <= p_now
          AND outbox.attempt_count < controls.max_attempts
        ORDER BY outbox.available_at, outbox.created_at, outbox.id
        LIMIT LEAST(company_allowance + 50, 650)
        FOR UPDATE OF outbox SKIP LOCKED
      ), base AS MATERIALIZED (
        SELECT outbox.id
        FROM queue_slice
        JOIN public.context_index_outbox outbox ON outbox.id = queue_slice.id
        JOIN public.context_index_ledger ledger';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_context_index_add_batch_v1(text,integer,integer,timestamp with time zone)'::regprocedure
  ) INTO definition;

  IF position(original_fragment IN definition) = 0 THEN
    RAISE EXCEPTION 'batch claim base fragment not found';
  END IF;
  updated_definition := replace(
    definition,
    original_fragment,
    replacement_fragment
  );
  EXECUTE updated_definition;
END
$migration$;
