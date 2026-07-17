-- Poll the most-overdue eligible provider work first. The availability clock
-- is the durable scheduling control used by retries and explicit canaries;
-- provider_accepted_at remains immutable evidence of the original upload.
DO $migration$
DECLARE
  definition TEXT;
  updated_definition TEXT;
  old_fragment TEXT := 'ORDER BY outbox.provider_accepted_at, outbox.id';
  new_fragment TEXT := 'ORDER BY outbox.available_at, outbox.provider_accepted_at, outbox.id';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_context_index_processing_v1(text,integer,integer,timestamp with time zone)'::regprocedure
  ) INTO definition;

  IF position(old_fragment IN definition) = 0
    AND position(new_fragment IN definition) = 0
  THEN
    RAISE EXCEPTION 'context processing order fragment not found';
  END IF;
  IF position(old_fragment IN definition) > 0 THEN
    updated_definition := replace(definition, old_fragment, new_fragment);
    EXECUTE updated_definition;
  END IF;
END
$migration$;

COMMENT ON FUNCTION public.claim_context_index_processing_v1(TEXT, INTEGER, INTEGER, TIMESTAMPTZ) IS
  'Claims up to 600 provider-accepted documents, prioritizes overdue availability, and accounts each bounded Supermemory status batch as one request.';
