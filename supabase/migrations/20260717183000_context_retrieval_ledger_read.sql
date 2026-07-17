-- Give the server-side retrieval path the minimum ledger access it needs.
-- The ledger remains unavailable for direct table reads; callers must provide
-- one tenant and a bounded set of canonical record IDs.

CREATE FUNCTION public.get_context_retrieval_ledger_v1(
  p_company_id UUID,
  p_canonical_record_ids UUID[]
)
RETURNS TABLE (
  canonical_record_id UUID,
  source_key TEXT,
  record_type TEXT,
  canonical_version TEXT,
  policy_version BIGINT,
  policy_hash TEXT,
  content_hash TEXT,
  stable_custom_id TEXT,
  provider_document_id TEXT,
  status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM workflow_private.require_context_service_role();

  IF COALESCE(cardinality(p_canonical_record_ids), 0) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'context_retrieval_record_ids_out_of_bounds'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    ledger.canonical_record_id,
    ledger.source_key,
    ledger.record_type,
    ledger.canonical_version,
    ledger.policy_version,
    ledger.policy_hash,
    ledger.content_hash,
    ledger.stable_custom_id,
    ledger.provider_document_id,
    ledger.status
  FROM public.context_index_ledger ledger
  WHERE ledger.company_id = p_company_id
    AND ledger.provider = 'supermemory'
    AND ledger.status = 'indexed'
    AND ledger.provider_document_id IS NOT NULL
    AND ledger.canonical_record_id = ANY(p_canonical_record_ids)
  ORDER BY ledger.canonical_record_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_context_retrieval_ledger_v1(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_context_retrieval_ledger_v1(UUID, UUID[])
  TO service_role;

