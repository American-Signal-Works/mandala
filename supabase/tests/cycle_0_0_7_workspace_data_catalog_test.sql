BEGIN;
SELECT plan(24);

SELECT has_table('public', 'workspace_data_catalogs', 'workspace imports have a generic catalog');
SELECT has_table('public', 'workspace_capability_mapping_versions', 'capability mappings are versioned');
SELECT has_table('public', 'workflow_workspace_mapping_bindings', 'compiled bindings can freeze mapping versions');
SELECT has_function(
  'public', 'refresh_workspace_data_catalog_v1', ARRAY['uuid'],
  'catalog profiling is available through a checked generic function'
);
SELECT is(
  has_function_privilege('anon', 'public.refresh_workspace_data_catalog_v1(uuid)', 'EXECUTE'),
  false,
  'anonymous callers cannot refresh catalogs'
);
SELECT is(
  (SELECT count(*)::INTEGER
   FROM public.connector_definitions
   WHERE connector_key = 'mandala.workspace-data' AND status = 'active'),
  1,
  'one generic workspace-data provider is registered'
);
SELECT is(
  (SELECT count(*)::INTEGER
   FROM public.capability_definitions
   WHERE capability_key = 'workspace.records.read' AND effect = 'read'),
  1,
  'a workflow-neutral read capability supports differently shaped data'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'catalog-owner@example.test', '', now(), '{}', '{}', now(), now()),
  ('c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'catalog-other@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by) VALUES
  ('c2000000-0000-4000-8000-000000000001', 'Catalog Workspace', 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002', 'Other Workspace', 'c1000000-0000-4000-8000-000000000002');
INSERT INTO public.company_memberships (company_id, user_id, role, status) VALUES
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'owner', 'active');
INSERT INTO public.external_sources (id, company_id, source_key, kind, name) VALUES
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'helpdesk', 'service', 'Helpdesk');
INSERT INTO public.external_records (
  id, company_id, source_id, record_type, external_id, payload, pulled_at
) VALUES (
  'c4000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001',
  'support_ticket',
  'T-42',
  '{"ticket_id":"T-42","severity":5,"summary":"Needs attention"}',
  now()
);

SELECT is(
  (SELECT profile_status FROM public.workspace_data_catalogs
   WHERE company_id = 'c2000000-0000-4000-8000-000000000001'
     AND record_type = 'support_ticket'),
  'pending',
  'an import automatically creates a pending catalog entry'
);

SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.refresh_workspace_data_catalog_v1('c2000000-0000-4000-8000-000000000001')$$,
  'an owner can profile imported data'
);
SELECT is(
  (SELECT profile_status FROM public.workspace_data_catalogs
   WHERE company_id = 'c2000000-0000-4000-8000-000000000001'
     AND record_type = 'support_ticket'),
  'ready',
  'the generic profile becomes ready'
);
SELECT is(
  (SELECT record_count::INTEGER FROM public.workspace_data_catalogs
   WHERE company_id = 'c2000000-0000-4000-8000-000000000001'
     AND record_type = 'support_ticket'),
  1,
  'profiling preserves the exact record count maintained during import'
);
SELECT ok(
  (SELECT field_profile @> '[{"path":"/severity","type":"number"}]'::JSONB
   FROM public.workspace_data_catalogs
   WHERE company_id = 'c2000000-0000-4000-8000-000000000001'
     AND record_type = 'support_ticket'),
  'the catalog records fields and inferred JSON types'
);
SELECT matches(
  (SELECT schema_hash FROM public.workspace_data_catalogs
   WHERE company_id = 'c2000000-0000-4000-8000-000000000001'
     AND record_type = 'support_ticket'),
  '^[a-f0-9]{64}$',
  'the catalog freezes a deterministic schema hash'
);

SELECT set_config(
  'test.mapping_result',
  public.publish_workspace_capability_mapping_v1(
    'c2000000-0000-4000-8000-000000000001',
    'workspace.records.read.tickets',
    (SELECT version.id
     FROM public.capability_definition_versions version
     JOIN public.capability_definitions definition
       ON definition.id = version.capability_definition_id
     WHERE definition.capability_key = 'workspace.records.read'
       AND version.version = '1.0.0'),
    0.95,
    '{
      "schemaVersion":"mandala.workspace-data/v1",
      "capabilityKey":"workspace.records.read",
      "capabilityVersion":"1.0.0",
      "datasets":[
        {"alias":"tickets","recordType":"support_ticket","entityPath":"/ticket_id","maximumFreshnessHours":24,"required":true},
        {"alias":"optional-notes","recordType":"support_note","entityPath":"/ticket_id","maximumFreshnessHours":24,"required":false}
      ],
      "output":{"collection":"records","entityKey":"ticket_id","fields":[
        {"name":"ticket_id","expression":{"op":"first","dataset":"tickets","path":"/ticket_id"},"required":true,"modelAllowed":true,"classification":"internal"},
        {"name":"severity","expression":{"op":"max","dataset":"tickets","path":"/severity"},"required":true,"modelAllowed":true,"classification":"internal"}
      ]},
      "signal":{"id":"high-severity-ticket","all":[{"left":"severity","operator":"gte","right":{"value":4}}]},
      "bounds":{"maximumInputRows":100,"maximumOutputRows":20,"maximumOutputBytes":65536}
    }'::JSONB,
    '{"kind":"test_fixture"}'::JSONB,
    true
  )::TEXT,
  true
);
SELECT is(
  current_setting('test.mapping_result')::JSONB ->> 'status',
  'validated',
  'a confirmed declarative mapping becomes validated'
);
SELECT is(
  (SELECT count(*)::INTEGER
   FROM public.workspace_capability_mapping_datasets
   WHERE mapping_version_id =
     (current_setting('test.mapping_result')::JSONB ->> 'mappingVersionId')::UUID),
  2,
  'the validated mapping freezes required and optional dataset state'
);
SELECT is(
  (SELECT count(*)::INTEGER
   FROM public.workspace_capability_mapping_datasets
   WHERE mapping_version_id =
     (current_setting('test.mapping_result')::JSONB ->> 'mappingVersionId')::UUID
     AND dataset_alias = 'optional-notes'
     AND expected_schema_hash IS NULL),
  1,
  'an absent optional dataset is frozen as unavailable instead of guessed'
);

RESET ROLE;
UPDATE public.external_records
SET payload = payload || '{"customer_tier":"priority"}'::JSONB
WHERE id = 'c4000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.refresh_workspace_data_catalog_v1('c2000000-0000-4000-8000-000000000001')$$,
  'catalog refresh detects a changed imported schema'
);
SELECT is(
  (SELECT profile_status FROM public.workspace_data_catalogs
   WHERE company_id = 'c2000000-0000-4000-8000-000000000001'
     AND source_key = 'helpdesk'
     AND record_type = 'support_ticket'),
  'drifted',
  'a changed schema remains blocked until a mapping is confirmed again'
);
SELECT public.publish_workspace_capability_mapping_v1(
  'c2000000-0000-4000-8000-000000000001',
  'workspace.records.read.tickets',
  (SELECT capability_version_id
   FROM public.workspace_capability_mapping_versions
   WHERE id = (current_setting('test.mapping_result')::JSONB ->> 'mappingVersionId')::UUID),
  0.95,
  (SELECT spec
   FROM public.workspace_capability_mapping_versions
   WHERE id = (current_setting('test.mapping_result')::JSONB ->> 'mappingVersionId')::UUID),
  '{"kind":"test_fixture","note":"review pending"}'::JSONB,
  false
);
SELECT is(
  (SELECT profile_status FROM public.workspace_data_catalogs
   WHERE company_id = 'c2000000-0000-4000-8000-000000000001'
     AND source_key = 'helpdesk'
     AND record_type = 'support_ticket'),
  'drifted',
  'an unconfirmed mapping does not acknowledge genuine catalog drift'
);
SELECT public.publish_workspace_capability_mapping_v1(
  'c2000000-0000-4000-8000-000000000001',
  'workspace.records.read.tickets',
  (SELECT capability_version_id
   FROM public.workspace_capability_mapping_versions
   WHERE id = (current_setting('test.mapping_result')::JSONB ->> 'mappingVersionId')::UUID),
  0.95,
  (SELECT spec
   FROM public.workspace_capability_mapping_versions
   WHERE id = (current_setting('test.mapping_result')::JSONB ->> 'mappingVersionId')::UUID),
  '{"kind":"test_fixture","note":"reviewed schema"}'::JSONB,
  true
);
SELECT is(
  (SELECT profile_status FROM public.workspace_data_catalogs
   WHERE company_id = 'c2000000-0000-4000-8000-000000000001'
     AND source_key = 'helpdesk'
     AND record_type = 'support_ticket'),
  'ready',
  'a confirmed mapping acknowledges the exact reviewed catalog hash'
);

RESET ROLE;
INSERT INTO public.external_sources (id, company_id, source_key, kind, name) VALUES
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'second-helpdesk', 'service', 'Second Helpdesk');
INSERT INTO public.external_records (
  id, company_id, source_id, record_type, external_id, payload, pulled_at
) VALUES (
  'c4000000-0000-4000-8000-000000000002',
  'c2000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000002',
  'support_ticket',
  'T-99',
  '{"ticket_id":"T-99","severity":4,"summary":"Second source"}',
  now()
);
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT public.refresh_workspace_data_catalog_v1('c2000000-0000-4000-8000-000000000001');
SELECT lives_ok(
  $$SELECT public.publish_workspace_capability_mapping_v1(
    'c2000000-0000-4000-8000-000000000001',
    'workspace.records.read.multisource',
    (SELECT capability_version_id FROM public.workspace_capability_mapping_versions
     WHERE id = (current_setting('test.mapping_result')::JSONB ->> 'mappingVersionId')::UUID),
    0.95,
    (SELECT spec FROM public.workspace_capability_mapping_versions
     WHERE id = (current_setting('test.mapping_result')::JSONB ->> 'mappingVersionId')::UUID),
    '{"kind":"test_fixture"}'::JSONB,
    true
  )$$,
  'read mappings accept every matching source instead of selecting one silently'
);
SELECT is(
  (SELECT jsonb_array_length(dataset.expected_schema_hashes)
   FROM public.workspace_capability_mapping_datasets dataset
   JOIN public.workspace_capability_mapping_versions mapping
     ON mapping.id = dataset.mapping_version_id
   WHERE mapping.company_id = 'c2000000-0000-4000-8000-000000000001'
     AND mapping.mapping_key = 'workspace.records.read.multisource'
     AND dataset.dataset_alias = 'tickets'
   ORDER BY mapping.version DESC
   LIMIT 1),
  2,
  'the frozen read mapping preserves both source schemas'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::INTEGER FROM public.workspace_data_catalogs
   WHERE company_id = 'c2000000-0000-4000-8000-000000000001'),
  0,
  'catalog RLS prevents cross-workspace reads'
);
SELECT throws_ok(
  $$SELECT public.refresh_workspace_data_catalog_v1('c2000000-0000-4000-8000-000000000001')$$,
  '42501',
  'forbidden',
  'another workspace owner cannot refresh this catalog'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
