BEGIN;
SELECT plan(15);

-- Fixture users/companies (mirrors agent_workflow_harness_test.sql pattern)
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('30000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'er-owner-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'er-viewer-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'er-owner-b@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by)
VALUES
  ('40000000-0000-0000-0000-000000000001', 'ER Fixture Company A', '30000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', 'ER Fixture Company B', '30000000-0000-0000-0000-000000000003');

INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'owner'),
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'viewer'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 'owner');

INSERT INTO public.external_sources (id, company_id, source_key, kind, name)
VALUES
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'test_source', 'inventory_platform', 'Test Source A'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 'second_source', 'project_board', 'Second Source A'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'test_source', 'inventory_platform', 'Test Source B');

INSERT INTO public.external_records (id, company_id, source_id, record_type, external_id, payload)
VALUES
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'inventory_position', 'SKU-A@wh1', '{"sku":"SKU-A","available":5}'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'inventory_position', 'SKU-B@wh1', '{"sku":"SKU-B","available":9}');

-- Structure
SELECT has_table('public', 'external_sources', 'external_sources exists');
SELECT has_table('public', 'external_records', 'external_records exists');
SELECT has_table('public', 'external_record_links', 'external_record_links exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.external_records'::regclass),
  'external_records has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.external_sources'::regclass),
  'external_sources has RLS enabled'
);

-- Dedup constraint: the same identity from the same source must fail.
SELECT throws_ok(
  $$INSERT INTO public.external_records (company_id, source_id, record_type, external_id)
    VALUES ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'inventory_position', 'SKU-A@wh1')$$,
  '23505',
  NULL,
  'duplicate external_id per source+type is rejected'
);

-- Different connector instances may use the same record type and external ID.
SELECT lives_ok(
  $$INSERT INTO public.external_records (company_id, source_id, record_type, external_id)
    VALUES ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'inventory_position', 'SKU-A@wh1')$$,
  'the same external identity is allowed for a different source'
);
DELETE FROM public.external_records
WHERE source_id = '50000000-0000-0000-0000-000000000003';

-- Composite tenant FK: a record cannot reference another company's source
SELECT throws_ok(
  $$INSERT INTO public.external_records (company_id, source_id, record_type, external_id)
    VALUES ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'vendor', 'X-1')$$,
  '23503',
  NULL,
  'cross-company source reference is rejected'
);

-- RLS: company A viewer sees only company A records
SELECT set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.external_records),
  1,
  'viewer of company A sees exactly company A records'
);
SELECT is(
  (SELECT external_id FROM public.external_records LIMIT 1),
  'SKU-A@wh1',
  'the visible record belongs to company A'
);

-- RLS: viewer cannot write records or sources
SELECT throws_ok(
  $$INSERT INTO public.external_records (company_id, source_id, record_type, external_id)
    VALUES ('40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'vendor', 'V-NEW')$$,
  '42501',
  NULL,
  'viewer cannot insert external_records'
);
SELECT throws_ok(
  $$INSERT INTO public.external_sources (company_id, source_key, kind, name)
    VALUES ('40000000-0000-0000-0000-000000000001', 'rogue', 'x', 'Rogue')$$,
  '42501',
  NULL,
  'viewer cannot insert external_sources'
);

SELECT throws_ok(
  $$SELECT config FROM public.external_sources$$,
  '42501',
  NULL,
  'members cannot read connector config'
);

-- Owners/admins can manage non-sensitive source metadata.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.external_sources (company_id, source_key, kind, name)
    VALUES ('40000000-0000-0000-0000-000000000001', 'owner_managed', 'curated', 'Owner Managed')$$,
  'owner can insert non-sensitive source metadata'
);

-- RLS: company B owner cannot see company A records
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.external_records WHERE company_id = '40000000-0000-0000-0000-000000000001'),
  0,
  'company B owner sees zero company A records'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
