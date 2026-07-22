BEGIN;
SELECT plan(3);

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

SELECT * FROM finish();
ROLLBACK;
