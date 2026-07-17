-- Cycle 0.0.8 Slice 5: persist bounded provider provenance separately from
-- canonical facts and governed-memory references.
--
-- The existing controlled persistence RPC validates an exact transport shape.
-- To preserve that reviewed boundary, application code places the optional
-- provenance envelope under one reserved facts key. This trigger extracts the
-- envelope before storage, so canonical facts never retain provider context.

ALTER TABLE public.workflow_context_packets
  ADD COLUMN operational_context JSONB;

ALTER TABLE public.workflow_context_packets
  ADD CONSTRAINT workflow_context_packets_operational_context_object
  CHECK (
    operational_context IS NULL
    OR jsonb_typeof(operational_context) = 'object'
  );

COMMENT ON COLUMN public.workflow_context_packets.operational_context IS
  'Bounded Context-provider provenance and canonical citations. Retrieved text is not stored here and remains untrusted evidence.';

CREATE FUNCTION workflow_private.extract_context_packet_operational_context_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  reserved_key CONSTANT TEXT := '__mandalaOperationalContextV1';
  expected_keys CONSTANT TEXT[] := ARRAY[
    'provider', 'status', 'requestId', 'scope', 'queryHash', 'filterHash',
    'policyVersion', 'bounds', 'resultCount', 'characterCount',
    'tokenEstimate', 'latencyMs', 'fallbackReason', 'indexSnapshotMarker',
    'citations'
  ];
  scope_keys CONSTANT TEXT[] := ARRAY['companyId', 'workspaceScopeId'];
  bounds_keys CONSTANT TEXT[] := ARRAY[
    'maximumResults', 'maximumCharacters', 'maximumTokens', 'maximumAgeHours',
    'minimumConfidence', 'timeoutMs'
  ];
  citation_keys CONSTANT TEXT[] := ARRAY[
    'providerReference', 'providerDocumentId', 'stableCustomId',
    'canonicalRecordId', 'canonicalRecordVersion', 'sourceId', 'sourceKey',
    'recordType', 'rank', 'score', 'providerUpdatedAt', 'sourceObservedAt',
    'freshness', 'contentHash', 'policyHash'
  ];
  uuid_pattern CONSTANT TEXT :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  hash_pattern CONSTANT TEXT := '^[0-9a-f]{64}$';
  envelope JSONB;
BEGIN
  IF NEW.facts ? reserved_key THEN
    envelope := NEW.facts -> reserved_key;
    IF envelope <> 'null'::JSONB AND jsonb_typeof(envelope) <> 'object' THEN
      RAISE EXCEPTION 'invalid_context_packet_operational_context'
        USING ERRCODE = '22023';
    END IF;
    NEW.operational_context := NULLIF(envelope, 'null'::JSONB);
    NEW.facts := NEW.facts - reserved_key;
  END IF;

  envelope := NEW.operational_context;
  IF envelope IS NULL THEN
    RETURN NEW;
  END IF;

  IF (
    jsonb_typeof(envelope) <> 'object'
    OR pg_column_size(envelope) > 262144
    OR NOT envelope ?& expected_keys
    OR envelope - expected_keys <> '{}'::JSONB
    OR envelope::TEXT ~* '"(excerpt|memory|chunk|retrievedText|rawText)"[[:space:]]*:'
  ) THEN
    RAISE EXCEPTION 'invalid_context_packet_operational_context'
      USING ERRCODE = '22023';
  END IF;

  IF (
    jsonb_typeof(envelope -> 'scope') <> 'object'
    OR NOT (envelope -> 'scope') ?& scope_keys
    OR (envelope -> 'scope') - scope_keys <> '{}'::JSONB
    OR envelope -> 'scope' ->> 'companyId' IS DISTINCT FROM NEW.company_id::TEXT
    OR envelope -> 'scope' ->> 'workspaceScopeId' IS DISTINCT FROM NEW.company_id::TEXT
  ) THEN
    RAISE EXCEPTION 'invalid_context_packet_operational_context'
      USING ERRCODE = '22023';
  END IF;

  IF (
    jsonb_typeof(envelope -> 'provider') <> 'string'
    OR envelope ->> 'provider' NOT IN ('off', 'supermemory')
    OR jsonb_typeof(envelope -> 'status') <> 'string'
    OR envelope ->> 'status' NOT IN (
      'disabled', 'complete', 'empty', 'partial', 'timeout', 'unavailable', 'failed'
    )
    OR jsonb_typeof(envelope -> 'requestId') <> 'string'
    OR envelope ->> 'requestId' !~ uuid_pattern
    OR jsonb_typeof(envelope -> 'queryHash') <> 'string'
    OR envelope ->> 'queryHash' !~ hash_pattern
    OR jsonb_typeof(envelope -> 'filterHash') <> 'string'
    OR envelope ->> 'filterHash' !~ hash_pattern
    OR jsonb_typeof(envelope -> 'policyVersion') <> 'number'
    OR (envelope ->> 'policyVersion')::NUMERIC < 1
    OR (envelope ->> 'policyVersion')::NUMERIC
      <> trunc((envelope ->> 'policyVersion')::NUMERIC)
    OR jsonb_typeof(envelope -> 'resultCount') <> 'number'
    OR (envelope ->> 'resultCount')::NUMERIC NOT BETWEEN 0 AND 20
    OR (envelope ->> 'resultCount')::NUMERIC
      <> trunc((envelope ->> 'resultCount')::NUMERIC)
    OR jsonb_typeof(envelope -> 'characterCount') <> 'number'
    OR (envelope ->> 'characterCount')::NUMERIC NOT BETWEEN 0 AND 50000
    OR (envelope ->> 'characterCount')::NUMERIC
      <> trunc((envelope ->> 'characterCount')::NUMERIC)
    OR jsonb_typeof(envelope -> 'tokenEstimate') <> 'number'
    OR (envelope ->> 'tokenEstimate')::NUMERIC NOT BETWEEN 0 AND 16000
    OR (envelope ->> 'tokenEstimate')::NUMERIC
      <> trunc((envelope ->> 'tokenEstimate')::NUMERIC)
    OR jsonb_typeof(envelope -> 'latencyMs') <> 'number'
    OR (envelope ->> 'latencyMs')::NUMERIC NOT BETWEEN 0 AND 120000
    OR (envelope ->> 'latencyMs')::NUMERIC
      <> trunc((envelope ->> 'latencyMs')::NUMERIC)
    OR jsonb_typeof(envelope -> 'fallbackReason') NOT IN ('string', 'null')
    OR (
      envelope ->> 'fallbackReason' IS NOT NULL
      AND envelope ->> 'fallbackReason' NOT IN (
        'context_off', 'timeout', 'provider_unavailable', 'provider_error',
        'policy_rejected', 'bounds_exceeded'
      )
    )
    OR jsonb_typeof(envelope -> 'indexSnapshotMarker') NOT IN ('string', 'null')
    OR length(COALESCE(envelope ->> 'indexSnapshotMarker', '')) > 500
  ) THEN
    RAISE EXCEPTION 'invalid_context_packet_operational_context'
      USING ERRCODE = '22023';
  END IF;

  IF (
    jsonb_typeof(envelope -> 'bounds') <> 'object'
    OR NOT (envelope -> 'bounds') ?& bounds_keys
    OR (envelope -> 'bounds') - bounds_keys <> '{}'::JSONB
    OR jsonb_typeof(envelope -> 'bounds' -> 'maximumResults') <> 'number'
    OR (envelope -> 'bounds' ->> 'maximumResults')::NUMERIC NOT BETWEEN 1 AND 20
    OR (envelope -> 'bounds' ->> 'maximumResults')::NUMERIC
      <> trunc((envelope -> 'bounds' ->> 'maximumResults')::NUMERIC)
    OR jsonb_typeof(envelope -> 'bounds' -> 'maximumCharacters') <> 'number'
    OR (envelope -> 'bounds' ->> 'maximumCharacters')::NUMERIC NOT BETWEEN 1 AND 50000
    OR (envelope -> 'bounds' ->> 'maximumCharacters')::NUMERIC
      <> trunc((envelope -> 'bounds' ->> 'maximumCharacters')::NUMERIC)
    OR jsonb_typeof(envelope -> 'bounds' -> 'maximumTokens') <> 'number'
    OR (envelope -> 'bounds' ->> 'maximumTokens')::NUMERIC NOT BETWEEN 1 AND 16000
    OR (envelope -> 'bounds' ->> 'maximumTokens')::NUMERIC
      <> trunc((envelope -> 'bounds' ->> 'maximumTokens')::NUMERIC)
    OR jsonb_typeof(envelope -> 'bounds' -> 'maximumAgeHours') <> 'number'
    OR (envelope -> 'bounds' ->> 'maximumAgeHours')::NUMERIC NOT BETWEEN 1 AND 87600
    OR (envelope -> 'bounds' ->> 'maximumAgeHours')::NUMERIC
      <> trunc((envelope -> 'bounds' ->> 'maximumAgeHours')::NUMERIC)
    OR jsonb_typeof(envelope -> 'bounds' -> 'minimumConfidence') <> 'number'
    OR (envelope -> 'bounds' ->> 'minimumConfidence')::NUMERIC NOT BETWEEN 0 AND 1
    OR jsonb_typeof(envelope -> 'bounds' -> 'timeoutMs') <> 'number'
    OR (envelope -> 'bounds' ->> 'timeoutMs')::NUMERIC NOT BETWEEN 100 AND 10000
    OR (envelope -> 'bounds' ->> 'timeoutMs')::NUMERIC
      <> trunc((envelope -> 'bounds' ->> 'timeoutMs')::NUMERIC)
  ) THEN
    RAISE EXCEPTION 'invalid_context_packet_operational_context'
      USING ERRCODE = '22023';
  END IF;

  IF (
    (envelope ->> 'resultCount')::INTEGER
      > (envelope -> 'bounds' ->> 'maximumResults')::INTEGER
    OR (envelope ->> 'characterCount')::INTEGER
      > (envelope -> 'bounds' ->> 'maximumCharacters')::INTEGER
    OR (envelope ->> 'tokenEstimate')::INTEGER
      > (envelope -> 'bounds' ->> 'maximumTokens')::INTEGER
    OR (
      envelope ->> 'status' = 'disabled'
      AND envelope ->> 'fallbackReason' IS DISTINCT FROM 'context_off'
    )
    OR (
      envelope ->> 'provider' = 'off'
      AND envelope ->> 'status' IS DISTINCT FROM 'disabled'
    )
    OR (
      envelope ->> 'status' IN (
        'disabled', 'empty', 'timeout', 'unavailable', 'failed'
      )
      AND (
        (envelope ->> 'resultCount')::INTEGER <> 0
        OR (envelope ->> 'characterCount')::INTEGER <> 0
        OR (envelope ->> 'tokenEstimate')::INTEGER <> 0
      )
    )
    OR (
      envelope ->> 'status' = 'complete'
      AND (envelope ->> 'resultCount')::INTEGER = 0
    )
  ) THEN
    RAISE EXCEPTION 'invalid_context_packet_operational_context'
      USING ERRCODE = '22023';
  END IF;

  IF (
    jsonb_typeof(envelope -> 'citations') <> 'array'
    OR jsonb_array_length(envelope -> 'citations') > 20
    OR (envelope ->> 'resultCount')::INTEGER
      <> jsonb_array_length(envelope -> 'citations')
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(envelope -> 'citations') AS citation
      WHERE jsonb_typeof(citation) <> 'object'
        OR NOT citation ?& citation_keys
        OR citation - citation_keys <> '{}'::JSONB
        OR jsonb_typeof(citation -> 'providerReference') <> 'string'
        OR length(citation ->> 'providerReference') NOT BETWEEN 1 AND 500
        OR jsonb_typeof(citation -> 'providerDocumentId') NOT IN ('string', 'null')
        OR (
          citation ->> 'providerDocumentId' IS NOT NULL
          AND length(citation ->> 'providerDocumentId') NOT BETWEEN 1 AND 500
        )
        OR jsonb_typeof(citation -> 'stableCustomId') <> 'string'
        OR citation ->> 'stableCustomId' !~ '^ctx_[0-9a-f]{64}$'
        OR jsonb_typeof(citation -> 'canonicalRecordId') <> 'string'
        OR citation ->> 'canonicalRecordId' !~ uuid_pattern
        OR jsonb_typeof(citation -> 'canonicalRecordVersion') <> 'string'
        OR length(COALESCE(citation ->> 'canonicalRecordVersion', '')) NOT BETWEEN 1 AND 200
        OR jsonb_typeof(citation -> 'sourceId') <> 'string'
        OR citation ->> 'sourceId' !~ uuid_pattern
        OR jsonb_typeof(citation -> 'sourceKey') <> 'string'
        OR length(COALESCE(citation ->> 'sourceKey', '')) NOT BETWEEN 1 AND 150
        OR jsonb_typeof(citation -> 'recordType') <> 'string'
        OR length(COALESCE(citation ->> 'recordType', '')) NOT BETWEEN 1 AND 150
        OR jsonb_typeof(citation -> 'rank') <> 'number'
        OR (citation ->> 'rank')::NUMERIC NOT BETWEEN 1 AND 20
        OR (citation ->> 'rank')::NUMERIC
          <> trunc((citation ->> 'rank')::NUMERIC)
        OR jsonb_typeof(citation -> 'score') NOT IN ('number', 'null')
        OR (
          citation ->> 'score' IS NOT NULL
          AND (citation ->> 'score')::NUMERIC NOT BETWEEN 0 AND 1
        )
        OR jsonb_typeof(citation -> 'providerUpdatedAt') NOT IN ('string', 'null')
        OR (
          citation ->> 'providerUpdatedAt' IS NOT NULL
          AND citation ->> 'providerUpdatedAt'
            !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
        )
        OR jsonb_typeof(citation -> 'sourceObservedAt') <> 'string'
        OR citation ->> 'sourceObservedAt'
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
        OR jsonb_typeof(citation -> 'freshness') <> 'string'
        OR citation ->> 'freshness' NOT IN ('fresh', 'stale', 'unknown')
        OR jsonb_typeof(citation -> 'contentHash') <> 'string'
        OR citation ->> 'contentHash' !~ hash_pattern
        OR jsonb_typeof(citation -> 'policyHash') <> 'string'
        OR citation ->> 'policyHash' !~ hash_pattern
    )
  ) THEN
    RAISE EXCEPTION 'invalid_context_packet_operational_context'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER workflow_context_packets_extract_operational_context_v1
BEFORE INSERT ON public.workflow_context_packets
FOR EACH ROW
EXECUTE FUNCTION workflow_private.extract_context_packet_operational_context_v1();

REVOKE ALL ON FUNCTION workflow_private.extract_context_packet_operational_context_v1()
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION workflow_private.get_workflow_context_provenance_v1(
  p_company_id UUID,
  p_context_packet_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  provenance JSONB;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL OR p_context_packet_id IS NULL THEN
    RAISE EXCEPTION 'invalid_context_packet_request' USING ERRCODE = '22023';
  END IF;

  PERFORM workflow_private.require_company_role(p_company_id, 'viewer', actor);

  SELECT packet.operational_context
  INTO provenance
  FROM public.workflow_context_packets AS packet
  WHERE packet.company_id = p_company_id
    AND packet.id = p_context_packet_id;

  RETURN provenance;
END
$$;

CREATE FUNCTION public.get_workflow_context_provenance_v1(
  p_company_id UUID,
  p_context_packet_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.get_workflow_context_provenance_v1(
    p_company_id,
    p_context_packet_id
  )
$$;

REVOKE ALL ON FUNCTION workflow_private.get_workflow_context_provenance_v1(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_workflow_context_provenance_v1(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workflow_context_provenance_v1(UUID, UUID)
TO authenticated;
