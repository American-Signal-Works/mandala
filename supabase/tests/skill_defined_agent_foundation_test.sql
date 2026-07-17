BEGIN;
SELECT plan(37);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '71000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'skill-owner@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '71000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'other-viewer@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

INSERT INTO public.companies (id, name, created_by)
VALUES
  (
    '72000000-0000-0000-0000-000000000001',
    'Mandala Bean Co. Security Test',
    '71000000-0000-0000-0000-000000000001'
  ),
  (
    '72000000-0000-0000-0000-000000000002',
    'Other Company',
    '71000000-0000-0000-0000-000000000002'
  );

INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES
  (
    '72000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000001',
    'owner'
  ),
  (
    '72000000-0000-0000-0000-000000000002',
    '71000000-0000-0000-0000-000000000002',
    'viewer'
  );

SELECT is(
  (SELECT count(*) FROM public.capability_definitions),
  9::BIGINT,
  'the platform catalog includes eight synthetic capabilities and one generic workspace read capability'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.connector_definition_versions
    WHERE manifest::TEXT ~* '(password|access.?token|api.?key|credential.?value)'
  ),
  'synthetic connector definitions contain no credential material'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.capability_field_classifications
    WHERE classification = 'secret'
      AND (model_allowed OR terminal_allowed)
  ),
  0::BIGINT,
  'secret fields can never be exposed to the model or terminal'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.install_agent_workflow_version(uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'anonymous callers cannot install workflows'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.install_agent_workflow_version(uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'authenticated owners and admins may call the checked installer'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.agent_workflows', 'INSERT'),
  'authenticated callers cannot bypass the workflow installer'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.company_connector_installations',
    'INSERT'
  ),
  'authenticated callers cannot write connector installations directly'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.company_approval_policies',
    'UPDATE'
  ),
  'approval policy writes must use the audited RPC'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.workflow_resume_outbox',
    'SELECT'
  ),
  'runtime resume checkpoints and payloads are not exposed through the Data API'
);
SELECT ok(
  'security_invoker=true' = ANY (
    SELECT unnest(reloptions)
    FROM pg_class
    WHERE oid = 'public.workflow_control_request_audit'::regclass
  ),
  'the compatibility audit view executes with caller permissions'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workflow_control_request_audit'
      AND column_name = 'input_hash'
  ),
  'the compatibility audit view does not expose the raw input hash'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '71000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.install_agent_workflow_version(
    '72000000-0000-0000-0000-000000000001',
    '# Mandala Bean Co. reorder skill',
    '{
      "workflowKey":"mandala_bean_reorder",
      "workflowType":"procurement_reorder",
      "name":"Mandala Bean Co. Reorder",
      "version":"1.0.0",
      "compilerVersion":"1.0.0",
      "spec":{
        "schemaVersion":"mandala.ai/v1",
        "compilerVersion":"1.0.0",
        "sourceDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "manifestDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "identity":{"id":"mandala_bean_reorder","name":"Mandala Bean Co. Reorder","version":"1.0.0","description":"Lifecycle test."},
        "workflow":{"type":"procurement_reorder","status":"draft","default_mode":"mock","triggers":[{"id":"manual_test","kind":"manual","description":"Lifecycle test."}]},
        "capabilityBindings":[{"id":"commerce.catalog.read","version":"1.0.0","access":"read","connectorId":"mandala.synthetic-commerce","schemaDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","toolName":"read_catalog","healthy":true,"granted":true,"alias":"inventory.read","useInPrompt":true}],
        "graph":[],
        "rules":[],
        "records":{"item":{"type":"generic_review","key":{"value":"test"},"title":{"value":"Test"},"priority":{"value":50},"related":{}},"recommendation":{"rationale":{"value":"Test"},"confidence":{"value":1},"output":{}}},
        "evidence":{"requirements":["Test"],"assumptions":[],"source_capabilities":["commerce.catalog.read"]},
        "approvals":[],
        "actions":[],
        "tests":[],
        "guidance":{"purpose":"Test","investigation":"Test","decision":"Test","exceptions":"Test","outputQuality":"Test"}
      }
    }'::JSONB,
    '{"ok":true,"diagnostics":{}}'::JSONB
  )$$,
  'an owner can install one immutable compiled skill version'
);
SELECT lives_ok(
  $$SELECT public.configure_company_connector_installation(
    '72000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000101',
    'Mandala Bean Co. synthetic commerce'
  )$$,
  'an owner can configure the credential-free synthetic connector'
);
SELECT lives_ok(
  $$SELECT public.set_company_connector_health(
    '72000000-0000-0000-0000-000000000001',
    (
      SELECT id
      FROM public.company_connector_installations
      WHERE company_id = '72000000-0000-0000-0000-000000000001'
    ),
    'healthy',
    (
      SELECT schema_hash
      FROM public.connector_definition_versions
      WHERE id = '60000000-0000-0000-0000-000000000101'
    ),
    '{"providerStatus":"synthetic","latencyMs":0}'::JSONB
  )$$,
  'an owner can record a healthy schema-compatible connector check'
);
SELECT lives_ok(
  $$SELECT public.set_company_capability_policy(
    '72000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000101',
    true,
    'member',
    true,
    true,
    1000,
    1048576
  )$$,
  'an owner can enable bounded model use for a read capability'
);
SELECT lives_ok(
  $$SELECT public.set_company_connector_capability_grant(
    '72000000-0000-0000-0000-000000000001',
    (
      SELECT id
      FROM public.company_connector_installations
      WHERE company_id = '72000000-0000-0000-0000-000000000001'
    ),
    '61000000-0000-0000-0000-000000000101',
    'active'
  )$$,
  'an owner can grant an offered capability'
);
SELECT lives_ok(
  $$SELECT public.create_workflow_binding_snapshot(
    '72000000-0000-0000-0000-000000000001',
    (
      SELECT id
      FROM public.agent_workflows
      WHERE company_id = '72000000-0000-0000-0000-000000000001'
        AND workflow_key = 'mandala_bean_reorder'
        AND version = '1.0.0'
    ),
    jsonb_build_array(jsonb_build_object(
      'requirementKey', 'inventory.read',
      'grantId', (
        SELECT id
        FROM public.company_connector_capability_grants
        WHERE company_id = '72000000-0000-0000-0000-000000000001'
          AND capability_version_id = '61000000-0000-0000-0000-000000000101'
      )
    ))
  )$$,
  'an owner can resolve authorized capabilities into a frozen snapshot'
);
SELECT lives_ok(
  $$SELECT public.activate_agent_workflow(
    '72000000-0000-0000-0000-000000000001',
    (
      SELECT id
      FROM public.agent_workflows
      WHERE company_id = '72000000-0000-0000-0000-000000000001'
        AND workflow_key = 'mandala_bean_reorder'
    ),
    (
      SELECT id
      FROM public.workflow_binding_snapshots
      WHERE company_id = '72000000-0000-0000-0000-000000000001'
    ),
    NULL
  )$$,
  'a healthy compiled workflow can be activated with compare-and-swap'
);
RESET ROLE;

SELECT is(
  (
    SELECT jsonb_build_object(
      'status', status,
      'sourceHashLength', length(skill_source_hash),
      'manifestHashLength', length(compiled_manifest_hash),
      'compilerVersion', compiler_version
    )
    FROM public.agent_workflows
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND workflow_key = 'mandala_bean_reorder'
  ),
  '{"status":"draft","sourceHashLength":64,"manifestHashLength":64,"compilerVersion":"1.0.0"}'::JSONB,
  'the installed version records deterministic compiler provenance'
);
SELECT throws_ok(
  $$UPDATE public.agent_workflows
    SET name = 'Mutated'
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND workflow_key = 'mandala_bean_reorder'$$,
  '55000',
  'activated_workflow_immutable',
  'an activated compiled version cannot be edited in place'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_audit_events
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND event_type = 'workflow_version_installed'
  ),
  1::BIGINT,
  'workflow installation records a company audit event'
);
SELECT is(
  (
    SELECT jsonb_build_object('status', status, 'schemaMatched',
      observed_schema_hash = (
        SELECT schema_hash
        FROM public.connector_definition_versions
        WHERE id = '60000000-0000-0000-0000-000000000101'
      )
    )
    FROM public.company_connector_health
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
  ),
  '{"status":"healthy","schemaMatched":true}'::JSONB,
  'connector health stores the observed schema compatibility result'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_capability_bindings binding
    JOIN public.workflow_binding_snapshots snapshot
      ON snapshot.id = binding.binding_snapshot_id
     AND snapshot.company_id = binding.company_id
    WHERE snapshot.company_id = '72000000-0000-0000-0000-000000000001'
      AND length(snapshot.grant_digest) = 64
      AND length(snapshot.manifest_hash) = 64
  ),
  1::BIGINT,
  'a snapshot freezes one tenant-consistent binding and both digests'
);
SELECT is(
  (
    SELECT jsonb_build_object(
      'key', workflow_key,
      'sequence', activation_sequence
    )
    FROM public.workflow_activations
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
  ),
  '{"key":"mandala_bean_reorder","sequence":1}'::JSONB,
  'activation updates the single authoritative workflow pointer'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_activation_events
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND event_type = 'activated'
  ),
  1::BIGINT,
  'activation appends an immutable lifecycle event'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '71000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.activate_agent_workflow(
    '72000000-0000-0000-0000-000000000001',
    (SELECT workflow_id FROM public.workflow_activations WHERE company_id = '72000000-0000-0000-0000-000000000001'),
    (SELECT binding_snapshot_id FROM public.workflow_activations WHERE company_id = '72000000-0000-0000-0000-000000000001'),
    NULL
  )$$,
  '40001',
  'stale_workflow_activation',
  'a stale activation cannot overwrite the current pointer'
);
SELECT throws_ok(
  $$SELECT public.set_company_capability_policy(
    '72000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000106',
    true,
    'approver',
    false,
    false,
    100,
    262144
  )$$,
  '22023',
  'human_approval_required_for_mutation',
  'a mutating capability cannot disable human approval'
);
SELECT lives_ok(
  $$SELECT public.set_company_approval_policy_controlled(
    '72000000-0000-0000-0000-000000000001',
    'procurement_reorder',
    'execute_mock_purchase_order',
    'approver',
    true,
    true
  )$$,
  'an owner can update the existing approval policy through an audited RPC'
);
SELECT lives_ok(
  $$SELECT public.set_company_connector_capability_grant(
    '72000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.company_connector_installations WHERE company_id = '72000000-0000-0000-0000-000000000001'),
    '61000000-0000-0000-0000-000000000101',
    'revoked'
  )$$,
  'revoking a connector capability succeeds through the checked RPC'
);
SELECT throws_ok(
  $$SELECT public.rollback_agent_workflow(
    '72000000-0000-0000-0000-000000000001',
    (SELECT workflow_id FROM public.workflow_activations WHERE company_id = '72000000-0000-0000-0000-000000000001'),
    (SELECT binding_snapshot_id FROM public.workflow_activations WHERE company_id = '72000000-0000-0000-0000-000000000001'),
    (SELECT workflow_id FROM public.workflow_activations WHERE company_id = '72000000-0000-0000-0000-000000000001')
  )$$,
  '22023',
  'binding_snapshot_not_activatable',
  'a revoked grant invalidates the frozen snapshot before rollback or activation'
);
SELECT lives_ok(
  $$SELECT public.deactivate_agent_workflow(
    '72000000-0000-0000-0000-000000000001',
    'mandala_bean_reorder',
    (SELECT workflow_id FROM public.workflow_activations WHERE company_id = '72000000-0000-0000-0000-000000000001')
  )$$,
  'an owner can explicitly deactivate the current workflow pointer'
);
RESET ROLE;

SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_binding_snapshot_events
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND event_type = 'invalidated'
  ),
  1::BIGINT,
  'grant revocation appends one snapshot invalidation event'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_activation_events
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND event_type = 'deactivated'
  ),
  1::BIGINT,
  'deactivation appends an immutable lifecycle event'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '71000000-0000-0000-0000-000000000002',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  (
    SELECT count(*)
    FROM public.company_connector_installations
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
  ),
  0::BIGINT,
  'RLS hides another company connector installation'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_binding_snapshots
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
  ),
  0::BIGINT,
  'RLS hides another company workflow binding snapshots'
);
SELECT throws_ok(
  $$SELECT public.set_company_capability_policy(
    '72000000-0000-0000-0000-000000000001',
    '61000000-0000-0000-0000-000000000101',
    true
  )$$,
  '42501',
  'forbidden',
  'a user from another company cannot change capability policy'
);
RESET ROLE;

SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_audit_events
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND event_type IN (
        'workflow_version_installed',
        'connector_installation_configured',
        'connector_health_recorded',
        'capability_policy_changed',
        'connector_capability_grant_changed',
        'workflow_binding_snapshot_created',
        'workflow_activated',
        'approval_policy_changed',
        'workflow_deactivated'
      )
  ),
  10::BIGINT,
  'every successful lifecycle change is represented in the company audit log'
);

SELECT * FROM finish();
ROLLBACK;
