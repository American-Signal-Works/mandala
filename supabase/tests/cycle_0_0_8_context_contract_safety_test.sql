BEGIN;
SELECT plan(54);

SELECT has_table(
  'public', 'context_workspace_settings',
  'Context workspace settings are persisted'
);
SELECT has_table(
  'public', 'context_workspace_setting_audits',
  'Context setting history is persisted separately'
);
SELECT has_table(
  'public', 'context_indexing_policy_versions',
  'provider-indexing policies are versioned'
);
SELECT has_function(
  'public',
  'set_context_workspace_configuration_v1',
  ARRAY['uuid', 'bigint', 'text', 'boolean', 'text', 'text'],
  'workspace settings change through one checked RPC'
);
SELECT has_function(
  'public',
  'publish_context_indexing_policy_v1',
  ARRAY[
    'uuid', 'text', 'text', 'bigint', 'boolean', 'text[]',
    'integer', 'text', 'integer', 'integer', 'text'
  ],
  'indexing policies publish through one checked RPC'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.set_context_workspace_configuration_v1(uuid,bigint,text,boolean,text,text)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot change Context or Sandbox settings'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.publish_context_indexing_policy_v1(uuid,text,text,bigint,boolean,text[],integer,text,integer,integer,text)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot publish indexing policies'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_workspace_settings'::REGCLASS),
  true,
  'settings use row level security'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_workspace_setting_audits'::REGCLASS),
  true,
  'setting audits use row level security'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_indexing_policy_versions'::REGCLASS),
  true,
  'indexing-policy versions use row level security'
);
SELECT is(
  has_table_privilege('authenticated', 'public.context_workspace_settings', 'SELECT'),
  true,
  'authenticated members may read settings through RLS'
);
SELECT is(
  has_table_privilege('authenticated', 'public.context_workspace_settings', 'INSERT'),
  false,
  'authenticated callers cannot insert settings directly'
);
SELECT is(
  has_table_privilege('service_role', 'public.context_workspace_settings', 'UPDATE'),
  false,
  'the service role cannot bypass the audited settings mutation RPC'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'context-owner@example.test', '', now(), '{}', '{}', now(), now()),
  ('d1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'context-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('d1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'context-viewer@example.test', '', now(), '{}', '{}', now(), now()),
  ('d1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'other-owner@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'Context Workspace', 'd1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002', 'Other Context Workspace', 'd1000000-0000-4000-8000-000000000004');
INSERT INTO public.company_memberships (company_id, user_id, role, status) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 'viewer', 'active'),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000004', 'owner', 'active');
INSERT INTO public.external_sources (
  id, company_id, source_key, kind, name
) VALUES (
  'd3000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'helpdesk',
  'service',
  'Helpdesk'
);

SELECT is(
  (SELECT provider FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  'off',
  'new workspaces default Context to Off'
);
SELECT is(
  (SELECT sandbox_enabled FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  true,
  'new workspaces default Sandbox to On'
);
SELECT is(
  (SELECT readiness FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  'disabled',
  'an Off provider starts in disabled readiness'
);
SELECT is(
  (SELECT configuration_version FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  1::BIGINT,
  'new workspaces start at configuration version one'
);
SELECT is(
  (SELECT count(*)::INTEGER FROM public.context_workspace_setting_audits
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
     AND change_kind = 'initialized'),
  1,
  'safe initialization emits one immutable audit row'
);
SELECT is(
  (SELECT actor_id FROM public.context_workspace_setting_audits
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
     AND configuration_version = 1),
  'd1000000-0000-4000-8000-000000000001'::UUID,
  'initialization is attributed to the workspace creator'
);

SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::INTEGER FROM public.context_workspace_settings),
  1,
  'a viewer reads settings for their own workspace'
);
SELECT is(
  (SELECT count(*)::INTEGER FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000002'),
  0,
  'a viewer cannot read another workspace setting'
);
SELECT is(
  (SELECT count(*)::INTEGER FROM public.context_workspace_setting_audits),
  1,
  'a viewer reads only their own workspace audit history'
);
SELECT throws_ok(
  $$UPDATE public.context_workspace_settings
    SET sandbox_enabled = false
    WHERE company_id = 'd2000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table context_workspace_settings',
  'members cannot bypass the settings RPC with a direct write'
);
SELECT throws_ok(
  $$SELECT public.set_context_workspace_configuration_v1(
    'd2000000-0000-4000-8000-000000000001', 1, 'off', false,
    'disabled', 'Viewer attempted to disable Sandbox.'
  )$$,
  '42501',
  'forbidden',
  'a viewer cannot change Context or Sandbox settings'
);
SELECT throws_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'support_ticket', 0, true, ARRAY['/ticket_id'], 65536,
    'internal', 30, 1, 'Viewer attempted to publish.'
  )$$,
  '42501',
  'forbidden',
  'a viewer cannot publish provider-indexing policy'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.set_context_workspace_configuration_v1(
    'd2000000-0000-4000-8000-000000000001', 1, 'supermemory', false,
    'not_ready', 'Admin selected the future provider while it remains not ready.'
  )$$,
  'an admin can update Context and Sandbox together through the checked RPC'
);
SELECT is(
  (SELECT provider FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  'supermemory',
  'the provider selection is persisted'
);
SELECT is(
  (SELECT sandbox_enabled FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  false,
  'the explicit Sandbox Off setting is persisted'
);
SELECT is(
  (SELECT readiness FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  'not_ready',
  'provider readiness is persisted independently'
);
SELECT is(
  (SELECT configuration_version FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  2::BIGINT,
  'a successful mutation increments the configuration version'
);
SELECT is(
  (SELECT count(*)::INTEGER FROM public.context_workspace_setting_audits
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  2,
  'the mutation appends one setting audit row'
);
SELECT is(
  (SELECT actor_id FROM public.context_workspace_setting_audits
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
     AND configuration_version = 2),
  'd1000000-0000-4000-8000-000000000002'::UUID,
  'the setting mutation audit identifies the admin actor'
);
SELECT throws_ok(
  $$SELECT public.set_context_workspace_configuration_v1(
    'd2000000-0000-4000-8000-000000000001', 1, 'off', true,
    'disabled', 'Stale writer attempted a change.'
  )$$,
  '40001',
  'stale_context_workspace_configuration',
  'optimistic concurrency rejects a stale settings writer'
);
SELECT throws_ok(
  $$SELECT public.set_context_workspace_configuration_v1(
    'd2000000-0000-4000-8000-000000000001', 2, 'off', true,
    'ready', 'Invalid readiness transition.'
  )$$,
  '22023',
  'invalid_context_workspace_configuration',
  'Context Off cannot claim provider readiness'
);

SELECT lives_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'support_ticket', 0, true, ARRAY['/ticket_id', '/summary'], 65536,
    'confidential', 30, 1, 'Approved bounded helpdesk projection.'
  )$$,
  'an admin can publish the first safe-field indexing policy'
);
SELECT is(
  (SELECT policy_version FROM public.context_indexing_policy_versions
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
     AND source_key = 'helpdesk' AND record_type = 'support_ticket'),
  1::BIGINT,
  'the first policy starts at version one'
);
SELECT is(
  (SELECT indexing_enabled FROM public.context_indexing_policy_versions
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
     AND source_key = 'helpdesk' AND record_type = 'support_ticket'),
  true,
  'the approved policy explicitly enables indexing'
);
SELECT is(
  (SELECT approved_field_paths FROM public.context_indexing_policy_versions
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
     AND source_key = 'helpdesk' AND record_type = 'support_ticket'),
  ARRAY['/ticket_id', '/summary']::TEXT[],
  'only explicit JSON-pointer fields are approved'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::INTEGER FROM public.workflow_audit_events
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
     AND event_type = 'context_indexing_policy_published'),
  1,
  'policy publication also emits the shared company security audit event'
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'secret_ticket', 0, true, ARRAY['/ticket_id'], 65536,
    'secret', 30, 1, 'Secret fields must not be indexed.'
  )$$,
  '22023',
  'invalid_context_indexing_policy',
  'secret classification is rejected'
);
SELECT throws_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'root_payload', 0, true, ARRAY['/'], 65536,
    'internal', 30, 1, 'Whole payload indexing must be rejected.'
  )$$,
  '22023',
  'invalid_context_indexing_policy',
  'a root payload path cannot bypass the field allowlist'
);
SELECT throws_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'credential_payload', 0, true, ARRAY['/ticket_id', '/api_access_token'], 65536,
    'internal', 30, 1, 'Sensitive provider fields must be rejected.'
  )$$,
  '22023',
  'invalid_context_indexing_policy',
  'sensitive field names cannot be approved for provider persistence'
);
SELECT throws_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'api_key_payload', 0, true, ARRAY['/ticket_id', '/apiKey'], 65536,
    'internal', 30, 1, 'Camel-case credential aliases must be rejected.'
  )$$,
  '22023',
  'invalid_context_indexing_policy',
  'camel-case API key aliases cannot be approved for provider persistence'
);
SELECT throws_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'private_key_payload', 0, true, ARRAY['/ticket_id', '/private_key'], 65536,
    'internal', 30, 1, 'Private-key aliases must be rejected.'
  )$$,
  '22023',
  'invalid_context_indexing_policy',
  'snake-case private-key aliases cannot be approved for provider persistence'
);
SELECT throws_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'disabled_ticket', 0, false, ARRAY['/ticket_id'], 65536,
    'internal', 30, 1, 'Disabled policies must remain empty.'
  )$$,
  '22023',
  'invalid_context_indexing_policy',
  'a disabled policy cannot retain approved fields'
);
SELECT throws_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'support_ticket', 0, true, ARRAY['/ticket_id'], 65536,
    'internal', 30, 1, 'Stale policy writer.'
  )$$,
  '40001',
  'stale_context_indexing_policy',
  'optimistic concurrency rejects a stale policy writer'
);
SELECT lives_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'd2000000-0000-4000-8000-000000000001', 'helpdesk',
    'support_ticket', 1, false, ARRAY[]::TEXT[], 65536,
    'internal', 30, 1, 'Disable provider persistence for this record type.'
  )$$,
  'a new immutable version can explicitly disable indexing'
);
SELECT is(
  (SELECT indexing_enabled FROM public.context_indexing_policy_versions
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
     AND source_key = 'helpdesk' AND record_type = 'support_ticket'
   ORDER BY policy_version DESC LIMIT 1),
  false,
  'the latest version makes the scope default-deny again'
);
SELECT throws_ok(
  $$INSERT INTO public.context_indexing_policy_versions(
    company_id, source_key, record_type, policy_version, indexing_enabled,
    approved_field_paths, maximum_content_bytes, classification, retention_days,
    projection_version, reason, created_by
  ) VALUES (
    'd2000000-0000-4000-8000-000000000001', 'helpdesk', 'bypass', 1,
    false, ARRAY[]::TEXT[], 65536, 'internal', 30, 1, 'Direct insert.',
    'd1000000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'permission denied for table context_indexing_policy_versions',
  'authenticated callers cannot bypass policy publication with direct inserts'
);

RESET ROLE;
SELECT throws_ok(
  $$UPDATE public.context_workspace_setting_audits
    SET reason = 'tampered'
    WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
      AND configuration_version = 2$$,
  '55000',
  'immutable_workflow_record',
  'setting audit rows are immutable even to a privileged writer'
);
SELECT throws_ok(
  $$UPDATE public.context_indexing_policy_versions
    SET reason = 'tampered'
    WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
      AND source_key = 'helpdesk' AND record_type = 'support_ticket'
      AND policy_version = 1$$,
  '55000',
  'immutable_workflow_record',
  'published policy versions are immutable even to a privileged writer'
);

SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::INTEGER FROM public.context_workspace_settings
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  0,
  'another workspace owner cannot read the first workspace setting'
);
SELECT is(
  (SELECT count(*)::INTEGER FROM public.context_indexing_policy_versions
   WHERE company_id = 'd2000000-0000-4000-8000-000000000001'),
  0,
  'another workspace owner cannot read the first workspace policies'
);
SELECT throws_ok(
  $$SELECT public.set_context_workspace_configuration_v1(
    'd2000000-0000-4000-8000-000000000001', 2, 'off', true,
    'disabled', 'Cross-tenant mutation attempt.'
  )$$,
  '42501',
  'forbidden',
  'another workspace owner cannot mutate the first workspace setting'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
