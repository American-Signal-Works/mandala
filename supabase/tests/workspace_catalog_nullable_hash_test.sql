BEGIN;
SELECT plan(6);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'e1000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'nullable-hash-owner@example.test',
  '',
  now(),
  '{}',
  '{}',
  now(),
  now()
);
INSERT INTO public.companies (id, name, created_by) VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'Nullable Hash Workspace',
  'e1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.company_memberships (company_id, user_id, role, status)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'owner',
  'active'
);
INSERT INTO public.external_sources (id, company_id, source_key, kind, name)
VALUES (
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'nullable-catalog',
  'service',
  'Nullable Catalog Fixture'
);
INSERT INTO public.external_records (
  company_id, source_id, record_type, external_id, payload, pulled_at, updated_at
)
SELECT
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'product_vendor',
  'vendor-' || record_number,
  jsonb_build_object(
    'sku', 'SKU-' || record_number,
    'vendor_name', case
      when record_number = 257 then null
      else to_jsonb('Vendor'::text)
    end
  ),
  '2026-07-21T00:00:00Z'::timestamptz,
  case
    when record_number = 257 then '2026-07-21T02:00:00Z'::timestamptz
    else '2026-07-21T01:00:00Z'::timestamptz
  end
FROM generate_series(1, 257) record_number;

SELECT set_config(
  'request.jwt.claim.sub',
  'e1000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT public.refresh_workspace_data_catalog_v1(
  'e2000000-0000-4000-8000-000000000001'
);
SELECT set_config(
  'test.nullable_schema_hash',
  (
    SELECT schema_hash
    FROM public.workspace_data_catalogs
    WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
      AND source_id = 'e3000000-0000-4000-8000-000000000001'
      AND record_type = 'product_vendor'
  ),
  true
);
RESET ROLE;
ALTER TABLE public.external_records DISABLE TRIGGER external_records_touch;
UPDATE public.external_records
SET updated_at = '2026-07-21T03:00:00Z'::timestamptz
WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
  AND source_id = 'e3000000-0000-4000-8000-000000000001'
  AND record_type = 'product_vendor'
  AND external_id <> 'vendor-257';
ALTER TABLE public.external_records ENABLE TRIGGER external_records_touch;

SET LOCAL ROLE authenticated;
SELECT public.refresh_workspace_data_catalog_v1(
  'e2000000-0000-4000-8000-000000000001'
);

SELECT is(
  (
    SELECT schema_hash
    FROM public.workspace_data_catalogs
    WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
      AND source_id = 'e3000000-0000-4000-8000-000000000001'
      AND record_type = 'product_vendor'
  ),
  current_setting('test.nullable_schema_hash'),
  'schema identity stays stable when a nullable row leaves the 256-record sample'
);
SELECT is(
  (
    SELECT profile_status
    FROM public.workspace_data_catalogs
    WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
      AND source_id = 'e3000000-0000-4000-8000-000000000001'
      AND record_type = 'product_vendor'
  ),
  'ready',
  'nullable sample churn no longer marks an unchanged catalog as drifted'
);
SELECT ok(
  (
    SELECT
      field_profile @> '[{"path":"/vendor_name","type":"string"}]'::jsonb
      AND NOT field_profile @> '[{"path":"/vendor_name","type":"null"}]'::jsonb
    FROM public.workspace_data_catalogs
    WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
      AND source_id = 'e3000000-0000-4000-8000-000000000001'
      AND record_type = 'product_vendor'
  ),
  'null observations stay separate from the field base type'
);

RESET ROLE;
ALTER TABLE public.external_records DISABLE TRIGGER external_records_touch;
UPDATE public.external_records
SET updated_at = '2026-07-21T04:00:00Z'::timestamptz
WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
  AND source_id = 'e3000000-0000-4000-8000-000000000001'
  AND record_type = 'product_vendor'
  AND external_id = 'vendor-257';
ALTER TABLE public.external_records ENABLE TRIGGER external_records_touch;
UPDATE public.workspace_data_catalogs
SET profile_status = 'pending'
WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
  AND source_id = 'e3000000-0000-4000-8000-000000000001'
  AND record_type = 'product_vendor';
SET LOCAL ROLE authenticated;
SELECT public.refresh_workspace_data_catalog_v1(
  'e2000000-0000-4000-8000-000000000001'
);
RESET ROLE;
SELECT set_config(
  'test.normalized_schema_hash',
  (
    SELECT schema_hash
    FROM public.workspace_data_catalogs
    WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
      AND source_id = 'e3000000-0000-4000-8000-000000000001'
      AND record_type = 'product_vendor'
  ),
  true
);
SELECT set_config(
  'test.legacy_schema_hash',
  (
    WITH target AS (
      SELECT field_profile, relationship_profile
      FROM public.workspace_data_catalogs
      WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
        AND source_id = 'e3000000-0000-4000-8000-000000000001'
        AND record_type = 'product_vendor'
    ), legacy_fields AS (
      SELECT jsonb_agg(entry.value ORDER BY entry.path, entry.field_type) AS fields
      FROM target
      CROSS JOIN LATERAL (
        SELECT
          field ->> 'path' AS path,
          field ->> 'type' AS field_type,
          jsonb_build_object(
            'path', field ->> 'path',
            'type', field ->> 'type'
          ) AS value
        FROM jsonb_array_elements(target.field_profile) field
        UNION ALL
        SELECT
          field ->> 'path' AS path,
          'null' AS field_type,
          jsonb_build_object('path', field ->> 'path', 'type', 'null') AS value
        FROM jsonb_array_elements(target.field_profile) field
        WHERE coalesce((field ->> 'nullable')::boolean, false)
      ) entry
    )
    SELECT encode(extensions.digest(convert_to(
      jsonb_build_object(
        'fields', legacy_fields.fields,
        'relationships', target.relationship_profile
      )::text,
      'UTF8'
    ), 'sha256'), 'hex')
    FROM target CROSS JOIN legacy_fields
  ),
  true
);

INSERT INTO public.workspace_capability_mapping_versions (
  id,
  company_id,
  mapping_key,
  version,
  capability_version_id,
  status,
  confidence,
  spec,
  spec_hash,
  provenance,
  confirmed_by,
  confirmed_at,
  created_by
)
SELECT
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'nullable.product-vendor.read',
  1,
  version.id,
  'validated',
  1,
  '{"datasets":[{"alias":"vendors","sourceKey":"nullable-catalog","recordType":"product_vendor"}]}'::jsonb,
  repeat('a', 64),
  '{}',
  'e1000000-0000-4000-8000-000000000001',
  now(),
  'e1000000-0000-4000-8000-000000000001'
FROM public.capability_definition_versions version
JOIN public.capability_definitions definition
  ON definition.id = version.capability_definition_id
WHERE definition.capability_key = 'workspace.records.read'
  AND version.version = '1.0.0';

INSERT INTO public.workspace_capability_mapping_datasets (
  mapping_version_id,
  company_id,
  dataset_alias,
  source_key,
  record_type,
  expected_schema_hash,
  expected_schema_hashes,
  maximum_freshness_hours,
  required
) VALUES (
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'vendors',
  'nullable-catalog',
  'product_vendor',
  current_setting('test.legacy_schema_hash'),
  jsonb_build_array(current_setting('test.legacy_schema_hash')),
  72,
  true
);

UPDATE public.workspace_data_catalogs
SET profile_status = 'drifted'
WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
  AND source_id = 'e3000000-0000-4000-8000-000000000001'
  AND record_type = 'product_vendor';

SELECT set_config(
  'test.rebaseline_count',
  workflow_private.rebaseline_nullable_catalog_hashes_v1()::text,
  true
);

SELECT is(
  current_setting('test.rebaseline_count')::integer,
  1,
  'the rollout rebaseline recognizes one proven nullable-only hash change'
);
SELECT ok(
  (
    SELECT
      expected_schema_hash = current_setting('test.normalized_schema_hash')
      AND expected_schema_hashes = jsonb_build_array(
        current_setting('test.normalized_schema_hash')
      )
    FROM public.workspace_capability_mapping_datasets
    WHERE mapping_version_id = 'e4000000-0000-4000-8000-000000000001'
      AND dataset_alias = 'vendors'
  ),
  'the validated mapping is rebaselined to the normalized schema hash'
);
SELECT is(
  (
    SELECT profile_status
    FROM public.workspace_data_catalogs
    WHERE company_id = 'e2000000-0000-4000-8000-000000000001'
      AND source_id = 'e3000000-0000-4000-8000-000000000001'
      AND record_type = 'product_vendor'
  ),
  'ready',
  'the catalog returns to ready only after its legacy hash is proven'
);

SELECT * FROM finish();
ROLLBACK;
