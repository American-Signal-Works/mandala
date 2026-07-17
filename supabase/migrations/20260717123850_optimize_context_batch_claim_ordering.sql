-- Let Postgres read the next pending add records directly from queue order.
-- Ordering by a joined ledger expression forced a full 83K-row sort before
-- LIMIT. Admission/canary status is still checked on the bounded slice below.

CREATE INDEX context_index_outbox_pending_add_company_idx
  ON public.context_index_outbox(
    company_id, provider, available_at, created_at, id
  )
  WHERE delivery_state IN ('pending', 'retry') AND operation = 'add';

DO $migration$
DECLARE
  definition TEXT;
  updated_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_context_index_add_batch_v1(text,integer,integer,timestamp with time zone)'::regprocedure
  ) INTO definition;

  IF position(
    'ORDER BY
          CASE WHEN ledger.attempt_count > 0 THEN 0 ELSE 1 END,
          outbox.available_at, outbox.created_at, outbox.id'
    IN definition
  ) = 0 THEN
    RAISE EXCEPTION 'batch claim queue ordering fragment not found';
  END IF;
  updated_definition := replace(
    definition,
    'ORDER BY
          CASE WHEN ledger.attempt_count > 0 THEN 0 ELSE 1 END,
          outbox.available_at, outbox.created_at, outbox.id',
    'ORDER BY outbox.available_at, outbox.created_at, outbox.id'
  );

  IF position(
    'LIMIT LEAST(company_allowance * 4, 2400)'
    IN updated_definition
  ) = 0 THEN
    RAISE EXCEPTION 'batch claim preselection limit fragment not found';
  END IF;
  updated_definition := replace(
    updated_definition,
    'LIMIT LEAST(company_allowance * 4, 2400)',
    'LIMIT LEAST(company_allowance + 50, 650)'
  );

  EXECUTE updated_definition;
END
$migration$;

COMMENT ON INDEX public.context_index_outbox_pending_add_company_idx IS
  'Supports bounded Supermemory batch selection without sorting the full pending corpus.';
