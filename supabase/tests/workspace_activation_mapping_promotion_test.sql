BEGIN;
SELECT plan(8);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'd1000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'activation-mapping-owner@example.test',
  '',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.companies (id, name, created_by) VALUES (
  'd2000000-0000-4000-8000-000000000001',
  'Activation Mapping Workspace',
  'd1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.company_memberships (company_id, user_id, role, status)
VALUES (
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'owner',
  'active'
);

INSERT INTO public.external_sources (
  id, company_id, source_key, kind, name, sync_status, last_synced_at
) VALUES (
  'd3000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'activation-fixture',
  'service',
  'Activation Fixture',
  'idle',
  now()
);
INSERT INTO public.external_records (
  id, company_id, source_id, record_type, external_id, payload, pulled_at
) VALUES (
  'd4000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'support_ticket',
  'T-activation',
  '{"ticket_id":"T-activation","severity":5}',
  now()
);

INSERT INTO public.company_connector_installations (
  id, company_id, connector_definition_id, connector_version_id,
  display_name, status, installed_by
)
SELECT
  'd5000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  connector.id,
  version.id,
  'Workspace Data',
  'connected',
  'd1000000-0000-4000-8000-000000000001'
FROM public.connector_definitions connector
JOIN public.connector_definition_versions version
  ON version.connector_definition_id = connector.id
WHERE connector.connector_key = 'mandala.workspace-data'
  AND version.version = '1.0.0';

INSERT INTO public.company_connector_capability_grants (
  id, company_id, installation_id, capability_version_id,
  status, granted_by
)
SELECT
  'd6000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000001',
  version.id,
  'active',
  'd1000000-0000-4000-8000-000000000001'
FROM public.capability_definition_versions version
JOIN public.capability_definitions definition
  ON definition.id = version.capability_definition_id
WHERE definition.capability_key = 'workspace.records.read'
  AND version.version = '1.0.0';

INSERT INTO public.company_connector_health (
  installation_id, company_id, status, observed_schema_hash
)
SELECT
  'd5000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'healthy',
  version.schema_hash
FROM public.company_connector_installations installation
JOIN public.connector_definition_versions version
  ON version.id = installation.connector_version_id
WHERE installation.id = 'd5000000-0000-4000-8000-000000000001';

INSERT INTO public.company_capability_policies (
  company_id, capability_version_id, enabled, minimum_role,
  allow_model_processing, require_human_approval, max_rows, max_bytes,
  updated_by
)
SELECT
  'd2000000-0000-4000-8000-000000000001',
  version.id,
  true,
  'member',
  false,
  true,
  100,
  262144,
  'd1000000-0000-4000-8000-000000000001'
FROM public.capability_definition_versions version
JOIN public.capability_definitions definition
  ON definition.id = version.capability_definition_id
WHERE definition.capability_key = 'workspace.records.read'
  AND version.version = '1.0.0';

SELECT set_config(
  'request.jwt.claim.sub',
  'd1000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT public.refresh_workspace_data_catalog_v1(
  'd2000000-0000-4000-8000-000000000001'
);
SELECT set_config(
  'test.activation_mapping_version_id',
  public.publish_workspace_capability_mapping_v1(
    'd2000000-0000-4000-8000-000000000001',
    'workspace.records.read.activation',
    (
      SELECT version.id
      FROM public.capability_definition_versions version
      JOIN public.capability_definitions definition
        ON definition.id = version.capability_definition_id
      WHERE definition.capability_key = 'workspace.records.read'
        AND version.version = '1.0.0'
    ),
    0.95,
    '{
      "schemaVersion":"mandala.workspace-data/v1",
      "capabilityKey":"workspace.records.read",
      "capabilityVersion":"1.0.0",
      "datasets":[
        {
          "alias":"tickets",
          "recordType":"support_ticket",
          "entityPath":"/ticket_id",
          "maximumFreshnessHours":24,
          "required":true
        }
      ],
      "output":{
        "collection":"records",
        "entityKey":"ticket_id",
        "fields":[
          {
            "name":"ticket_id",
            "expression":{"op":"first","dataset":"tickets","path":"/ticket_id"},
            "required":true,
            "modelAllowed":true,
            "classification":"internal"
          }
        ]
      },
      "bounds":{
        "maximumInputRows":100,
        "maximumOutputRows":20,
        "maximumOutputBytes":65536
      }
    }'::jsonb,
    '{"kind":"test_fixture"}'::jsonb,
    true
  ) ->> 'mappingVersionId',
  true
);

RESET ROLE;

INSERT INTO public.agent_workflows (
  id, company_id, workflow_key, workflow_type, name, version, status,
  spec, skill_markdown, compile_result, created_by, updated_by,
  skill_source_hash, compiler_version, compiled_manifest_hash, compiled_at,
  compiler_diagnostics
) VALUES
  (
    'd7000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'workspace-activation-test',
    'runtime_test',
    'Workspace activation test',
    '1.0.0',
    'draft',
    '{
      "schemaVersion":"mandala.ai/v1",
      "compilerVersion":"1.0.0",
      "capabilityBindings":[{
        "alias":"tickets",
        "id":"workspace.records.read",
        "version":"1.0.0",
        "access":"read"
      }],
      "actions":[],
      "approvals":[],
      "records":{}
    }',
    '# Workspace activation test',
    '{"ok":true}',
    'd1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    repeat('1', 64),
    '1.0.0',
    repeat('a', 64),
    now(),
    '{}'
  ),
  (
    'd7000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    'workspace-activation-missing-source',
    'runtime_test',
    'Workspace activation missing source',
    '1.0.0',
    'draft',
    '{
      "schemaVersion":"mandala.ai/v1",
      "compilerVersion":"1.0.0",
      "capabilityBindings":[{
        "alias":"tickets",
        "id":"workspace.records.read",
        "version":"1.0.0",
        "access":"read"
      }],
      "actions":[],
      "approvals":[],
      "records":{}
    }',
    '# Workspace activation missing source',
    '{"ok":true}',
    'd1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    repeat('2', 64),
    '1.0.0',
    repeat('c', 64),
    now(),
    '{}'
  );

INSERT INTO public.workflow_binding_snapshots (
  id, company_id, workflow_id, manifest_hash, grant_digest, created_by, created_at
) VALUES
  (
    'd8000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    repeat('b', 64),
    'd1000000-0000-4000-8000-000000000001',
    now() - interval '1 minute'
  ),
  (
    'd8000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    repeat('b', 64),
    'd1000000-0000-4000-8000-000000000001',
    now()
  ),
  (
    'd8000000-0000-4000-8000-000000000003',
    'd2000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000002',
    repeat('c', 64),
    repeat('b', 64),
    'd1000000-0000-4000-8000-000000000001',
    now()
  );

INSERT INTO public.workflow_capability_bindings (
  company_id, binding_snapshot_id, requirement_key, grant_id,
  capability_version_id
)
SELECT
  'd2000000-0000-4000-8000-000000000001',
  snapshot_id,
  'tickets',
  'd6000000-0000-4000-8000-000000000001',
  grant_record.capability_version_id
FROM unnest(array[
  'd8000000-0000-4000-8000-000000000001'::uuid,
  'd8000000-0000-4000-8000-000000000002'::uuid,
  'd8000000-0000-4000-8000-000000000003'::uuid
]) snapshot_id
CROSS JOIN public.company_connector_capability_grants grant_record
WHERE grant_record.id = 'd6000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.bind_workspace_mappings_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'requirementKey', 'tickets',
      'mappingVersionId', current_setting('test.activation_mapping_version_id')::uuid
    ))
  )$$,
  'the real-data Sandbox snapshot can freeze its confirmed workspace mapping'
);

RESET ROLE;
UPDATE public.external_records
SET payload = payload || '{"severity":6}'::jsonb
WHERE id = 'd4000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.activate_agent_workflow(
    'd2000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000002',
    null
  )$$,
  'activation promotes confirmed mappings into the newer readiness snapshot'
);

SELECT is(
  (
    SELECT profile_status
    FROM public.workspace_data_catalogs
    WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
      AND source_id = 'd3000000-0000-4000-8000-000000000001'
      AND record_type = 'support_ticket'
  ),
  'ready',
  'activation refreshes catalogs that a concurrent connector sync marked pending'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workflow_workspace_mapping_bindings
    WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
      AND binding_snapshot_id = 'd8000000-0000-4000-8000-000000000002'
  ),
  1,
  'the active snapshot has a workspace mapping for every workspace requirement'
);

SELECT is(
  (
    SELECT mapping_version_id
    FROM public.workflow_workspace_mapping_bindings
    WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
      AND binding_snapshot_id = 'd8000000-0000-4000-8000-000000000002'
      AND requirement_key = 'tickets'
  ),
  current_setting('test.activation_mapping_version_id')::uuid,
  'activation carries forward the exact confirmed mapping version'
);

SELECT throws_ok(
  $$SELECT public.activate_agent_workflow(
    'd2000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000003',
    null
  )$$,
  '55000',
  'workspace_mapping_snapshot_not_ready',
  'activation fails honestly when no confirmed real-data mapping snapshot exists'
);

RESET ROLE;

SELECT is(
  (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = 'workflow_private.ensure_workspace_mappings_for_activation()'::regprocedure
  ),
  true,
  'the activation invariant runs behind a security-definer trigger boundary'
);
SELECT ok(
  (
    SELECT proconfig @> array['search_path=""']
    FROM pg_proc
    WHERE oid = 'workflow_private.ensure_workspace_mappings_for_activation()'::regprocedure
  ),
  'the activation trigger function pins an empty search path'
);

SELECT * FROM finish();
ROLLBACK;
