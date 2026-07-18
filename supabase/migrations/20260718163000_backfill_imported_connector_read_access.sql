-- Existing imported connector records were already authorized and available
-- to Mandala before the explicit connector-access envelope was introduced.
-- Preserve that read access without granting any write permission or enabling
-- background provider calls. Future connections must set this envelope during
-- their normal authorization flow.

UPDATE public.external_sources AS source
SET config = jsonb_set(
  source.config,
  '{access}',
  '{"status":"connected","permissions":{"read":true,"write":false}}'::JSONB,
  true
)
WHERE NOT source.config ? 'access'
  AND jsonb_array_length(
    COALESCE(source.config -> 'businessEvidenceRoles', '[]'::JSONB)
  ) > 0
  AND EXISTS (
    SELECT 1
    FROM public.external_records AS record
    WHERE record.source_id = source.id
      AND record.company_id = source.company_id
  );
