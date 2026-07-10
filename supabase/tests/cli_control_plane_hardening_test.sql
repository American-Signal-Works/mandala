BEGIN;
SELECT plan(77);

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
VALUES (
  '51000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'hardening-approver@example.test',
  '',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

INSERT INTO public.companies (id, name, created_by)
VALUES (
  '52000000-0000-0000-0000-000000000001',
  'Hardening Company',
  '51000000-0000-0000-0000-000000000001'
);

INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES (
  '52000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001',
  'owner'
);

INSERT INTO public.agent_workflows (
  id,
  company_id,
  workflow_key,
  workflow_type,
  name,
  version,
  status,
  spec,
  created_by,
  updated_by
)
VALUES (
  '53000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  'hardening_mock_action',
  'generic_mock_action',
  'Hardening Mock Action',
  '0.1.0',
  'active',
  '{"defaultMode":"mock","allowedActions":[{"actionType":"execute_mock_action","mode":"mock","requiresApproval":true}]}',
  '51000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001'
);

INSERT INTO public.company_approval_policies (
  company_id,
  workflow_type,
  action_type,
  minimum_role,
  require_human_approval,
  require_warning_acknowledgement
)
VALUES (
  '52000000-0000-0000-0000-000000000001',
  'generic_mock_action',
  'execute_mock_action',
  'approver',
  true,
  true
);

INSERT INTO public.workflow_runs (
  id,
  company_id,
  workflow_id,
  workflow_type,
  status,
  input,
  langgraph_thread_id,
  langgraph_checkpoint_id,
  langsmith_trace_id,
  langsmith_run_id,
  started_by
)
VALUES (
  '54000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '53000000-0000-0000-0000-000000000001',
  'generic_mock_action',
  'waiting_for_approval',
  '{}',
  'hardening-thread',
  'hardening-checkpoint',
  'hardening-trace',
  'hardening-run',
  '51000000-0000-0000-0000-000000000001'
);

INSERT INTO public.workflow_events (
  id,
  company_id,
  workflow_run_id,
  workflow_id,
  event_key,
  event_type,
  origin,
  source_ref,
  payload,
  freshness_state,
  validation_status,
  validation_result
)
VALUES (
  '55000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '54000000-0000-0000-0000-000000000001',
  '53000000-0000-0000-0000-000000000001',
  'hardening:event:1',
  'fixture_snapshot',
  'fixture',
  '{}',
  '{}',
  'fresh',
  'pass',
  '{"status":"pass"}'
);

INSERT INTO public.workflow_items (
  id,
  company_id,
  workflow_run_id,
  workflow_event_id,
  workflow_id,
  item_key,
  item_type,
  title,
  status
)
VALUES (
  '56000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '54000000-0000-0000-0000-000000000001',
  '55000000-0000-0000-0000-000000000001',
  '53000000-0000-0000-0000-000000000001',
  'hardening:item:1',
  'generic_action_review',
  'Review hardened mock action',
  'active'
);

INSERT INTO public.workflow_context_packets (
  id,
  company_id,
  workflow_run_id,
  workflow_item_id,
  sources,
  facts,
  freshness_state
)
VALUES (
  '57000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '54000000-0000-0000-0000-000000000001',
  '56000000-0000-0000-0000-000000000001',
  '[]',
  '{}',
  'fresh'
);

INSERT INTO public.workflow_recommendation_runs (
  id,
  company_id,
  workflow_run_id,
  workflow_item_id,
  context_packet_id,
  status,
  rationale_summary,
  warning_state,
  warnings,
  confidence,
  freshness_state,
  input,
  output
)
VALUES (
  '58000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '54000000-0000-0000-0000-000000000001',
  '56000000-0000-0000-0000-000000000001',
  '57000000-0000-0000-0000-000000000001',
  'ready_for_review',
  'Ready for hardening verification.',
  'pass',
  '[]',
  0.9,
  'fresh',
  '{}',
  '{}'
);

INSERT INTO public.workflow_evidence_snapshots (
  id,
  company_id,
  workflow_run_id,
  workflow_item_id,
  recommendation_run_id,
  source_refs,
  assumptions,
  warnings,
  evidence
)
VALUES (
  '59000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '54000000-0000-0000-0000-000000000001',
  '56000000-0000-0000-0000-000000000001',
  '58000000-0000-0000-0000-000000000001',
  '[]',
  '[]',
  '[]',
  '[]'
);

INSERT INTO public.workflow_action_drafts (
  id,
  company_id,
  workflow_run_id,
  workflow_item_id,
  recommendation_run_id,
  evidence_snapshot_id,
  action_type,
  status,
  payload,
  payload_hash
)
VALUES (
  '5a000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '54000000-0000-0000-0000-000000000001',
  '56000000-0000-0000-0000-000000000001',
  '58000000-0000-0000-0000-000000000001',
  '59000000-0000-0000-0000-000000000001',
  'execute_mock_action',
  'pending_review',
  '{"mode":"mock","operation":"hardening-control"}',
  encode(
    extensions.digest(
      convert_to('{"mode":"mock","operation":"hardening-control"}'::JSONB::TEXT, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
);

CREATE TEMP TABLE fixture_payloads (payload JSONB) ON COMMIT DROP;
CREATE TEMP TABLE fixture_results (label TEXT PRIMARY KEY, result JSONB) ON COMMIT DROP;
CREATE TEMP TABLE decision_results (result JSONB) ON COMMIT DROP;
CREATE TEMP TABLE execution_results (result JSONB) ON COMMIT DROP;
GRANT SELECT ON fixture_payloads TO authenticated;
GRANT SELECT, INSERT ON fixture_results, decision_results, execution_results TO authenticated;

INSERT INTO fixture_payloads VALUES (
  jsonb_build_object(
    'company_id', '52000000-0000-0000-0000-000000000001',
    'definition', jsonb_build_object(
      'id', '5b000000-0000-0000-0000-000000000001',
      'company_id', '52000000-0000-0000-0000-000000000001',
      'workflow_key', 'procurement_reorder_review',
      'workflow_type', 'procurement_reorder',
      'name', 'Hardening Fixture',
      'version', '0.1.0',
      'status', 'draft',
      'spec', jsonb_build_object(
        'workflowKey', 'procurement_reorder_review',
        'workflowType', 'procurement_reorder',
        'version', '0.1.0',
        'defaultMode', 'mock',
        'triggers', jsonb_build_array(jsonb_build_object('id', 'fixture_run', 'kind', 'fixture')),
        'nodes', jsonb_build_array(
          jsonb_build_object('kind', 'source_sync', 'allowedTools', jsonb_build_array('read_fixture_records')),
          jsonb_build_object('kind', 'validation', 'allowedTools', jsonb_build_array('validate_fixture_event')),
          jsonb_build_object('kind', 'routing', 'allowedTools', jsonb_build_array('route_work_item')),
          jsonb_build_object('kind', 'context_assembly', 'allowedTools', jsonb_build_array('assemble_context_packet')),
          jsonb_build_object('kind', 'recommendation', 'allowedTools', jsonb_build_array('compute_reorder_recommendation')),
          jsonb_build_object('kind', 'draft_action', 'allowedTools', jsonb_build_array('create_mock_action_draft')),
          jsonb_build_object('kind', 'human_approval', 'allowedTools', jsonb_build_array('record_human_decision')),
          jsonb_build_object('kind', 'mock_execution', 'allowedTools', jsonb_build_array('execute_mock_action')),
          jsonb_build_object('kind', 'audit', 'allowedTools', jsonb_build_array('write_workflow_audit_event'))
        ),
        'allowedActions', jsonb_build_array(
          jsonb_build_object('actionType', 'create_mock_purchase_order_draft', 'mode', 'mock', 'requiresApproval', false),
          jsonb_build_object('actionType', 'execute_mock_purchase_order', 'mode', 'mock', 'requiresApproval', true)
        )
      ),
      'skill_markdown', '# Hardening fixture',
      'compile_result', jsonb_build_object('ok', true)
    ),
    'run', jsonb_build_object(
      'id', '5c000000-0000-0000-0000-000000000001',
      'company_id', '52000000-0000-0000-0000-000000000001',
      'workflow_id', '5b000000-0000-0000-0000-000000000001',
      'workflow_type', 'procurement_reorder',
      'status', 'suppressed',
      'input', jsonb_build_object('scenarioId', 'no_action'),
      'langgraph_thread_id', 'hardening-fixture-thread',
      'langgraph_checkpoint_id', 'hardening-fixture-checkpoint',
      'langsmith_trace_id', 'hardening-fixture-trace',
      'langsmith_run_id', 'hardening-fixture-run',
      'started_by', '51000000-0000-0000-0000-000000000001',
      'started_at', now(),
      'completed_at', now()
    ),
    'event', jsonb_build_object(
      'id', '5d000000-0000-0000-0000-000000000001',
      'company_id', '52000000-0000-0000-0000-000000000001',
      'workflow_run_id', '5c000000-0000-0000-0000-000000000001',
      'workflow_id', '5b000000-0000-0000-0000-000000000001',
      'event_key', 'hardening-fixture:snapshot-1',
      'event_type', 'fixture_inventory_snapshot',
      'origin', 'fixture',
      'source_ref', jsonb_build_object('scenarioId', 'no_action', 'snapshotId', 'hardening-snapshot-1'),
      'payload', jsonb_build_object('synthetic', true),
      'freshness_state', 'fresh',
      'validation_status', 'pass',
      'validation_result', jsonb_build_object('status', 'pass'),
      'created_at', now()
    ),
    'item', NULL,
    'context_packet', NULL,
    'recommendation', NULL,
    'evidence', NULL,
    'draft', NULL,
    'audit_events', jsonb_build_array(jsonb_build_object(
      'id', '5e000000-0000-0000-0000-000000000001',
      'company_id', '52000000-0000-0000-0000-000000000001',
      'actor_type', 'system_agent',
      'actor_id', NULL,
      'workflow_run_id', '5c000000-0000-0000-0000-000000000001',
      'workflow_item_id', NULL,
      'event_type', 'event_validated',
      'summary', 'Hardening fixture event validated.',
      'payload', jsonb_build_object('synthetic', true),
      'trace', '{}',
      'created_at', now()
    ))
  )
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.persist_workflow_fixture_run(jsonb)', 'EXECUTE'),
  'authenticated cannot call the legacy fixture mutation'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.record_workflow_decision(uuid,uuid,text,text,boolean,jsonb)', 'EXECUTE'),
  'authenticated cannot call the legacy decision mutation'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.execute_mock_workflow_action(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'),
  'authenticated cannot call the legacy execution mutation'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.persist_workflow_fixture_run_controlled(jsonb,text,text)', 'EXECUTE'),
  'authenticated can call the controlled fixture mutation'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.record_workflow_decision_controlled(uuid,uuid,text,text,text,text,boolean,jsonb)', 'EXECUTE'),
  'authenticated can call the controlled decision mutation'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.execute_mock_workflow_action_controlled(uuid,uuid,uuid,text,text,jsonb,text,text)', 'EXECUTE'),
  'authenticated can call the controlled execution mutation'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.persist_workflow_fixture_run_controlled(jsonb,text,text)', 'EXECUTE'),
  'anonymous callers cannot call the controlled fixture mutation'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.record_workflow_decision_controlled(uuid,uuid,text,text,text,text,boolean,jsonb)', 'EXECUTE'),
  'anonymous callers cannot call the controlled decision mutation'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.execute_mock_workflow_action_controlled(uuid,uuid,uuid,text,text,jsonb,text,text)', 'EXECUTE'),
  'anonymous callers cannot call the controlled execution mutation'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'workflow_private.persist_workflow_fixture_run(jsonb)', 'EXECUTE'),
  'authenticated cannot call the private fixture core'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'workflow_private.record_workflow_decision(uuid,uuid,text,text,boolean,jsonb)', 'EXECUTE'),
  'authenticated cannot call the private decision core'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'workflow_private.execute_mock_workflow_action(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'),
  'authenticated cannot call the private execution checker'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'workflow_private.execute_mock_workflow_action_core(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'),
  'authenticated cannot call the private execution core'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'workflow_private.record_workflow_control_request(uuid,text,text,jsonb,text,text,text,uuid,uuid,text,text)', 'EXECUTE'),
  'authenticated cannot call the private control-audit implementation'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'workflow_private.persist_workflow_fixture_run_controlled(jsonb,text,text)', 'EXECUTE'),
  'authenticated cannot bypass the controlled fixture public wrapper'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'workflow_private.record_workflow_decision_controlled(uuid,uuid,text,text,text,text,boolean,jsonb)', 'EXECUTE'),
  'authenticated cannot bypass the controlled decision public wrapper'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'workflow_private.execute_mock_workflow_action_controlled(uuid,uuid,uuid,text,text,jsonb,text,text)', 'EXECUTE'),
  'authenticated cannot bypass the controlled execution public wrapper'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.workflow_control_requests'::REGCLASS),
  'workflow control requests retain RLS'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.workflow_execution_tokens', 'SELECT'),
  'execution tokens remain unselectable'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.workflow_runs', 'INSERT'),
  'authenticated callers cannot insert workflow runs directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.workflow_audit_events', 'INSERT'),
  'authenticated callers cannot insert workflow audit events directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.company_memberships', 'UPDATE'),
  'authenticated callers cannot update membership identity or role directly'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.disable_own_company_membership(uuid)', 'EXECUTE'),
  'authenticated callers can use the checked self-disable RPC'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'workflow_private.is_safe_standalone_control_intent(uuid,jsonb,text,text)', 'EXECUTE'),
  'standalone control-intent validation remains private'
);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.persist_workflow_fixture_run_controlled(payload, 'not-a-hash', 'cli') FROM fixture_payloads$$,
  '22023',
  'invalid_control_metadata',
  'invalid fixture input hash is rejected before mutation'
);
SELECT throws_ok(
  $$SELECT public.persist_workflow_fixture_run_controlled(payload, repeat('a', 64), 'terminal') FROM fixture_payloads$$,
  '22023',
  'invalid_control_metadata',
  'invalid fixture client surface is rejected before mutation'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.workflow_runs WHERE id = '5c000000-0000-0000-0000-000000000001'),
  0::BIGINT,
  'invalid control metadata leaves fixture state unchanged'
);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.execute_mock_workflow_action_controlled(
      '52000000-0000-0000-0000-000000000001',
      '5a000000-0000-0000-0000-000000000001',
      (SELECT (result #>> '{decision,id}')::UUID FROM decision_results LIMIT 1),
      (SELECT result #>> '{executionToken,rawToken}' FROM decision_results LIMIT 1),
      (SELECT result #>> '{executionToken,rawToken}' FROM decision_results LIMIT 1),
      '{"mode":"mock","operation":"hardening-control"}',
      repeat('e', 64),
      'cli'
    )$$,
  '22023',
  'invalid_execution_request',
  'execution capability cannot be persisted as an idempotency key'
);
SELECT lives_ok(
  $$INSERT INTO fixture_results
    SELECT 'first', public.persist_workflow_fixture_run_controlled(payload, repeat('a', 64), 'cli')
    FROM fixture_payloads$$,
  'controlled fixture mutation succeeds'
);
SELECT lives_ok(
  $$INSERT INTO fixture_results
    SELECT 'duplicate', public.persist_workflow_fixture_run_controlled(payload, repeat('b', 64), 'cli')
    FROM fixture_payloads$$,
  'controlled duplicate fixture mutation succeeds'
);
RESET ROLE;

SELECT is(
  jsonb_build_object(
    'controls', (SELECT count(*) FROM public.workflow_control_requests WHERE input_hash = repeat('a', 64)),
    'audits', (
      SELECT count(*)
      FROM public.workflow_audit_events audit
      JOIN public.workflow_control_requests control
        ON audit.payload ->> 'controlRequestId' = control.id::TEXT
      WHERE control.input_hash = repeat('a', 64)
        AND audit.event_type = 'control_request_recorded'
    )
  ),
  '{"controls":1,"audits":1}'::JSONB,
  'controlled fixture creates one linked control row and audit'
);
SELECT is(
  (
    SELECT jsonb_build_object(
      'intent', control.normalized_intent,
      'runMatches', control.workflow_run_id::TEXT = result.result #>> '{run,id}',
      'itemId', control.workflow_item_id
    )
    FROM public.workflow_control_requests control
    JOIN fixture_results result ON result.label = 'duplicate'
    WHERE control.input_hash = repeat('b', 64)
  ),
  '{"intent":{"kind":"run_fixture","duplicate":true},"runMatches":true,"itemId":null}'::JSONB,
  'duplicate fixture audit links only its returned suppressed run'
);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.record_workflow_control_request(
      '52000000-0000-0000-0000-000000000001',
      'cli',
      repeat('c', 64),
      '{"kind":"list_work_items","companyId":"52000000-0000-0000-0000-000000000001","risk":"read","metadata":{"Access_Token":"do-not-store"}}',
      'explicit',
      'resolved',
      'read'
    )$$,
  '22023',
  'invalid_control_request',
  'checked read audit rejects sensitive normalized-intent keys'
);
SELECT throws_ok(
  $$SELECT public.record_workflow_control_request(
      '52000000-0000-0000-0000-000000000001',
      'cli',
      repeat('c', 64),
      '{"kind":"execute_mock_action","companyId":"52000000-0000-0000-0000-000000000001","itemId":"56000000-0000-0000-0000-000000000001","risk":"mock_execution"}',
      'explicit',
      'executed',
      'mock_execution'
    )$$,
  '22023',
  'invalid_control_request',
  'standalone control RPC cannot claim a successful mutation'
);
RESET ROLE;

INSERT INTO public.workflow_control_requests (
  id,
  company_id,
  actor_id,
  client_surface,
  input_hash,
  normalized_intent,
  parser_kind,
  resolution_status,
  risk_class,
  workflow_item_id
)
VALUES
  (
    '5f000000-0000-0000-0000-000000000004',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    'cli',
    repeat('3', 64),
    '{"kind":"record_decision","companyId":"52000000-0000-0000-0000-000000000001","itemId":"56000000-0000-0000-0000-000000000001","decision":"reject","patchPointers":[],"patchCount":0,"warningsAcknowledged":false,"risk":"state_change"}',
    'langchain',
    'resolved',
    'state_change',
    '56000000-0000-0000-0000-000000000001'
  ),
  (
    '5f000000-0000-0000-0000-000000000005',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    'cli',
    repeat('4', 64),
    '{"kind":"record_decision","companyId":"52000000-0000-0000-0000-000000000001","itemId":"56000000-0000-0000-0000-000000000001","decision":"edit","patchPointers":["/operation"],"patchCount":1,"warningsAcknowledged":false,"risk":"state_change"}',
    'langchain',
    'resolved',
    'state_change',
    '56000000-0000-0000-0000-000000000001'
  ),
  (
    '5f000000-0000-0000-0000-000000000007',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    'cli',
    repeat('7', 64),
    '{"kind":"record_decision","companyId":"52000000-0000-0000-0000-000000000001","itemId":"56000000-0000-0000-0000-000000000001","decision":"approve","patchPointers":[],"patchCount":0,"warningsAcknowledged":false,"risk":"state_change"}',
    'langchain',
    'resolved',
    'state_change',
    '56000000-0000-0000-0000-000000000001'
  );

INSERT INTO workflow_private.workflow_control_request_bindings (
  control_request_id,
  company_id,
  actor_id,
  intent_digest
)
VALUES
  (
    '5f000000-0000-0000-0000-000000000004',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    encode(extensions.digest(convert_to(
      jsonb_build_object(
        'kind', 'record_decision',
        'companyId', '52000000-0000-0000-0000-000000000001',
        'itemId', '56000000-0000-0000-0000-000000000001',
        'decision', 'reject',
        'patches', '[]'::JSONB,
        'warningsAcknowledged', false
      )::TEXT,
      'UTF8'
    ), 'sha256'), 'hex')
  ),
  (
    '5f000000-0000-0000-0000-000000000005',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    encode(extensions.digest(convert_to(
      jsonb_build_object(
        'kind', 'record_decision',
        'companyId', '52000000-0000-0000-0000-000000000001',
        'itemId', '56000000-0000-0000-0000-000000000001',
        'decision', 'edit',
        'patches', jsonb_build_array(jsonb_build_object(
          'pointer', '/operation',
          'value', 'expected'
        )),
        'warningsAcknowledged', false
      )::TEXT,
      'UTF8'
    ), 'sha256'), 'hex')
  ),
  (
    '5f000000-0000-0000-0000-000000000007',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    encode(extensions.digest(convert_to(
      jsonb_build_object(
        'kind', 'record_decision',
        'companyId', '52000000-0000-0000-0000-000000000001',
        'itemId', '56000000-0000-0000-0000-000000000001',
        'decision', 'approve',
        'patches', '[]'::JSONB,
        'warningsAcknowledged', false
      )::TEXT,
      'UTF8'
    ), 'sha256'), 'hex')
  );

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.record_workflow_decision_controlled_reusing_request(
    '52000000-0000-0000-0000-000000000001',
    '5a000000-0000-0000-0000-000000000001',
    'approve',
    repeat('9', 64),
    'cli',
    '5f000000-0000-0000-0000-000000000004',
    NULL,
    false,
    NULL
  )$$,
  '23514',
  'control_request_correlation_mismatch',
  'a parsed reject control request cannot authorize an approve mutation'
);
SELECT throws_ok(
  $$SELECT public.record_workflow_decision_controlled_reusing_request(
    '52000000-0000-0000-0000-000000000001',
    '5a000000-0000-0000-0000-000000000001',
    'edit',
    repeat('9', 64),
    'cli',
    '5f000000-0000-0000-0000-000000000005',
    'change operation',
    false,
    '{"mode":"mock","operation":"different"}'
  )$$,
  '23514',
  'control_request_correlation_mismatch',
  'an edit cannot change a stored pointer to a different value'
);
SELECT throws_ok(
  $$SELECT public.record_workflow_decision_controlled_reusing_request(
    '52000000-0000-0000-0000-000000000001',
    '5a000000-0000-0000-0000-000000000001',
    'approve',
    repeat('9', 64),
    'cli',
    '5f000000-0000-0000-0000-000000000007',
    NULL,
    true,
    NULL
  )$$,
  '23514',
  'control_request_correlation_mismatch',
  'warning acknowledgement cannot be added outside the parsed control binding'
);
SELECT lives_ok(
  $$INSERT INTO decision_results
    SELECT public.record_workflow_decision_controlled(
      '52000000-0000-0000-0000-000000000001',
      '5a000000-0000-0000-0000-000000000001',
      'approve',
      repeat('d', 64),
      'cli',
      'sensitive reason must not persist in control intent',
      false,
      NULL
    )$$,
  'controlled decision mutation succeeds'
);
RESET ROLE;

SELECT is(
  jsonb_build_object(
    'controls', (SELECT count(*) FROM public.workflow_control_requests WHERE input_hash = repeat('d', 64)),
    'audits', (
      SELECT count(*)
      FROM public.workflow_audit_events audit
      JOIN public.workflow_control_requests control
        ON audit.payload ->> 'controlRequestId' = control.id::TEXT
      WHERE control.input_hash = repeat('d', 64)
        AND audit.event_type = 'control_request_recorded'
    )
  ),
  '{"controls":1,"audits":1}'::JSONB,
  'controlled decision creates one linked control row and audit'
);
SELECT is(
  (
    SELECT normalized_intent
    FROM public.workflow_control_requests
    WHERE input_hash = repeat('d', 64)
  ),
  jsonb_build_object(
    'kind', 'record_decision',
    'decision', 'approve',
    'actionDraftId', '5a000000-0000-0000-0000-000000000001',
    'workflowItemId', '56000000-0000-0000-0000-000000000001',
    'warningsAcknowledged', false,
    'edited', false
  ),
  'controlled decision stores only the server-derived intent projection'
);
SELECT ok(
  (
    SELECT normalized_intent::TEXT NOT LIKE '%sensitive reason%'
      AND NOT (normalized_intent ?| ARRAY['reason', 'editedPayload', 'payload'])
    FROM public.workflow_control_requests
    WHERE input_hash = repeat('d', 64)
  ),
  'controlled decision intent omits reason and edited payload'
);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.disable_own_company_membership('52000000-0000-0000-0000-000000000001')$$,
  '55000',
  'last_active_owner',
  'the last active owner cannot orphan a company'
);
RESET ROLE;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '51000000-0000-0000-0000-000000000002',
  'authenticated',
  'authenticated',
  'hardening-owner-two@example.test',
  '',
  now(),
  '{}',
  '{}',
  now(),
  now()
);
INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES (
  '52000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000002',
  'owner'
);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO execution_results
    SELECT public.execute_mock_workflow_action_controlled(
      '52000000-0000-0000-0000-000000000001',
      '5a000000-0000-0000-0000-000000000001',
      (SELECT (result #>> '{decision,id}')::UUID FROM decision_results LIMIT 1),
      (SELECT result #>> '{executionToken,rawToken}' FROM decision_results LIMIT 1),
      'cli:00000000-0000-4000-8000-000000000003',
      '{"mode":"mock","operation":"hardening-control"}',
      repeat('e', 64),
      'cli'
    )$$,
  'controlled mock execution succeeds'
);
RESET ROLE;

SELECT is(
  jsonb_build_object(
    'controls', (SELECT count(*) FROM public.workflow_control_requests WHERE input_hash = repeat('e', 64)),
    'audits', (
      SELECT count(*)
      FROM public.workflow_audit_events audit
      JOIN public.workflow_control_requests control
        ON audit.payload ->> 'controlRequestId' = control.id::TEXT
      WHERE control.input_hash = repeat('e', 64)
        AND audit.event_type = 'control_request_recorded'
    )
  ),
  '{"controls":1,"audits":1}'::JSONB,
  'controlled execution creates one linked control row and audit'
);
SELECT ok(
  (
    SELECT normalized_intent = jsonb_build_object(
        'kind', 'execute_mock_action',
        'actionDraftId', '5a000000-0000-0000-0000-000000000001',
        'decisionId', (SELECT result #>> '{decision,id}' FROM decision_results LIMIT 1),
        'workflowItemId', '56000000-0000-0000-0000-000000000001'
      )
      AND normalized_intent::TEXT NOT LIKE '%00000000-0000-4000-8000-000000000003%'
      AND normalized_intent::TEXT NOT LIKE '%hardening-control%'
      AND NOT (normalized_intent ?| ARRAY['rawToken', 'requestPayload', 'payload', 'idempotencyKey'])
    FROM public.workflow_control_requests
    WHERE input_hash = repeat('e', 64)
  ),
  'controlled execution intent omits token, request payload, and idempotency key'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.record_workflow_execution_failure(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated callers cannot author execution-failure audit events'
);
SELECT ok(
  pg_get_functiondef('workflow_private.record_workflow_execution_failure(uuid,uuid,text,text)'::REGPROCEDURE)
    LIKE '%token_revoked%idempotencyKeyHash%',
  'private failure projection supports revoked tokens without raw idempotency keys'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.transition_workflow_control_request(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated callers can finalize their own conversational control request'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'workflow_private.transition_workflow_control_request_internal(uuid,uuid,text,text,text,uuid,uuid,boolean)',
    'EXECUTE'
  ),
  'authenticated callers cannot bypass private control transitions'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'workflow_private.workflow_control_parser_leases',
    'SELECT'
  ),
  'parser lease records are not directly readable'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'workflow_private.workflow_control_request_bindings',
    'SELECT'
  ),
  'private pointer and value bindings are not directly readable'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.workflow_control_requests',
    'SELECT'
  ),
  'members cannot read conversational input HMACs from the base table'
);
SELECT ok(
  has_table_privilege(
    'authenticated',
    'public.workflow_control_request_audit',
    'SELECT'
  ),
  'members can read the tenant-filtered audit projection'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workflow_control_request_audit'
      AND column_name = 'input_hash'
  ),
  'the member-facing audit projection omits input hashes'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.configure_workflow_control_parser_trust(text)',
    'EXECUTE'
  ),
  'service role can provision parser binding trust'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.configure_workflow_control_parser_trust(text)',
    'EXECUTE'
  ),
  'authenticated callers cannot provision parser binding trust'
);

SELECT public.configure_workflow_control_parser_trust(
  'hardening-binding-secret-0000000000000000'
);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.record_workflow_control_request_with_binding(
    '52000000-0000-0000-0000-000000000001',
    'cli',
    repeat('8', 64),
    '{"kind":"run_fixture","companyId":"52000000-0000-0000-0000-000000000001","scenarioId":"trusted_fixture","risk":"state_change"}',
    'langchain',
    'resolved',
    'state_change',
    '{"kind":"run_fixture","companyId":"52000000-0000-0000-0000-000000000001","scenarioId":"trusted_fixture"}',
    repeat('0', 64)
  )$$,
  '42501',
  'parser_binding_forbidden',
  'an authenticated caller cannot mint a binding with an untrusted token'
);
SELECT lives_ok(
  $$SELECT public.record_workflow_control_request_with_binding(
    '52000000-0000-0000-0000-000000000001',
    'cli',
    repeat('8', 64),
    '{"kind":"run_fixture","companyId":"52000000-0000-0000-0000-000000000001","scenarioId":"trusted_fixture","risk":"state_change"}',
    'langchain',
    'resolved',
    'state_change',
    '{"kind":"run_fixture","companyId":"52000000-0000-0000-0000-000000000001","scenarioId":"trusted_fixture"}',
    encode(extensions.digest(convert_to(
      'hardening-binding-secret-0000000000000000',
      'UTF8'
    ), 'sha256'), 'hex')
  )$$,
  'a server token with matching service-role trust can mint a binding'
);
RESET ROLE;
SELECT is(
  jsonb_build_object(
    'controls', (
      SELECT count(*)
      FROM public.workflow_control_requests
      WHERE input_hash = repeat('8', 64)
    ),
    'bindings', (
      SELECT count(*)
      FROM workflow_private.workflow_control_request_bindings binding
      JOIN public.workflow_control_requests control
        ON control.id = binding.control_request_id
      WHERE control.input_hash = repeat('8', 64)
    )
  ),
  '{"controls":1,"bindings":1}'::JSONB,
  'trusted binding creation stores one public audit and one private digest'
);

INSERT INTO public.workflow_control_requests (
  id,
  company_id,
  actor_id,
  client_surface,
  input_hash,
  normalized_intent,
  parser_kind,
  resolution_status,
  risk_class,
  workflow_item_id,
  langsmith_trace_id,
  langsmith_run_id
)
VALUES
  (
    '5f000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    'cli',
    repeat('1', 64),
    '{"kind":"list_work_items","companyId":"52000000-0000-0000-0000-000000000001","risk":"read"}',
    'langchain',
    'resolved',
    'read',
    NULL,
    'read-trace',
    'read-run'
  ),
  (
    '5f000000-0000-0000-0000-000000000002',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    'cli',
    repeat('2', 64),
    '{"kind":"execute_mock_action","companyId":"52000000-0000-0000-0000-000000000001","itemId":"56000000-0000-0000-0000-000000000001","risk":"mock_execution"}',
    'langchain',
    'resolved',
    'mock_execution',
    '56000000-0000-0000-0000-000000000001',
    'mutation-trace',
    'mutation-run'
  ),
  (
    '5f000000-0000-0000-0000-000000000003',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    'cli',
    repeat('f', 64),
    '{"kind":"run_fixture","companyId":"52000000-0000-0000-0000-000000000001","scenarioId":"no_action","risk":"state_change"}',
    'langchain',
    'resolved',
    'state_change',
    NULL,
    'fixture-parser-trace',
    'fixture-parser-run'
  );

INSERT INTO public.workflow_control_requests (
  id,
  company_id,
  actor_id,
  client_surface,
  input_hash,
  normalized_intent,
  parser_kind,
  resolution_status,
  risk_class
)
VALUES (
  '5f000000-0000-0000-0000-000000000006',
  '52000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001',
  'cli',
  repeat('6', 64),
  '{"kind":"run_fixture","companyId":"52000000-0000-0000-0000-000000000001","scenarioId":"different_scenario","risk":"state_change"}',
  'langchain',
  'resolved',
  'state_change'
);

INSERT INTO workflow_private.workflow_control_request_bindings (
  control_request_id,
  company_id,
  actor_id,
  intent_digest
)
VALUES
  (
    '5f000000-0000-0000-0000-000000000003',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    encode(extensions.digest(convert_to(
      jsonb_build_object(
        'kind', 'run_fixture',
        'companyId', '52000000-0000-0000-0000-000000000001',
        'scenarioId', 'no_action'
      )::TEXT,
      'UTF8'
    ), 'sha256'), 'hex')
  ),
  (
    '5f000000-0000-0000-0000-000000000006',
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    encode(extensions.digest(convert_to(
      jsonb_build_object(
        'kind', 'run_fixture',
        'companyId', '52000000-0000-0000-0000-000000000001',
        'scenarioId', 'different_scenario'
      )::TEXT,
      'UTF8'
    ), 'sha256'), 'hex')
  );

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.transition_workflow_control_request(
    '52000000-0000-0000-0000-000000000001',
    '5f000000-0000-0000-0000-000000000001',
    'executed'
  )$$,
  'a conversational read can transition to executed'
);
RESET ROLE;
SELECT is(
  (SELECT resolution_status FROM public.workflow_control_requests WHERE id = '5f000000-0000-0000-0000-000000000001'),
  'executed',
  'the existing read control row reaches its terminal status'
);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.transition_workflow_control_request(
    '52000000-0000-0000-0000-000000000001',
    '5f000000-0000-0000-0000-000000000001',
    'failed'
  )$$,
  '23514',
  'invalid_control_transition',
  'a terminal control request cannot transition again'
);
SELECT throws_ok(
  $$SELECT public.transition_workflow_control_request(
    '52000000-0000-0000-0000-000000000001',
    '5f000000-0000-0000-0000-000000000002',
    'executed'
  )$$,
  '23514',
  'invalid_control_transition',
  'a public transition cannot claim that a mutation executed'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.transition_workflow_control_request(
    '52000000-0000-0000-0000-000000000001',
    '5f000000-0000-0000-0000-000000000002',
    'blocked'
  )$$,
  '42501',
  'control_request_forbidden',
  'one actor cannot transition another actor control request'
);
RESET ROLE;

CREATE TEMP TABLE parser_lease_results (
  label TEXT PRIMARY KEY,
  result JSONB
) ON COMMIT DROP;
GRANT SELECT, INSERT ON parser_lease_results TO authenticated;

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO parser_lease_results VALUES (
    'first',
    public.acquire_workflow_control_parser_lease('52000000-0000-0000-0000-000000000001')
  )$$,
  'the first parser lease is acquired'
);
SELECT lives_ok(
  $$INSERT INTO parser_lease_results VALUES (
    'second',
    public.acquire_workflow_control_parser_lease('52000000-0000-0000-0000-000000000001')
  )$$,
  'the second parser lease is acquired'
);
SELECT throws_ok(
  $$SELECT public.acquire_workflow_control_parser_lease('52000000-0000-0000-0000-000000000001')$$,
  'P0001',
  'parser_concurrency_limit_exceeded',
  'a third concurrent parser request is rejected'
);
SELECT lives_ok(
  $$SELECT public.release_workflow_control_parser_lease(
    '52000000-0000-0000-0000-000000000001',
    (SELECT (result ->> 'leaseId')::UUID FROM parser_lease_results WHERE label = 'first')
  )$$,
  'a parser lease can be released by its actor'
);
SELECT lives_ok(
  $$INSERT INTO parser_lease_results VALUES (
    'third',
    public.acquire_workflow_control_parser_lease('52000000-0000-0000-0000-000000000001')
  )$$,
  'released concurrency becomes available immediately'
);
RESET ROLE;

UPDATE workflow_private.workflow_control_parser_leases
SET created_at = now() - INTERVAL '2 minutes',
    expires_at = now() - INTERVAL '1 minute',
    released_at = now() - INTERVAL '1 minute'
WHERE actor_id = '51000000-0000-0000-0000-000000000001';

INSERT INTO workflow_private.workflow_control_parser_leases (
  company_id,
  actor_id,
  created_at,
  expires_at,
  released_at
)
SELECT
  '52000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001',
  now(),
  now() + INTERVAL '15 seconds',
  now()
FROM generate_series(1, 12);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.acquire_workflow_control_parser_lease('52000000-0000-0000-0000-000000000001')$$,
  'P0001',
  'parser_rate_limit_exceeded',
  'the per-actor parser request quota is enforced'
);
SELECT throws_ok(
  $$SELECT public.persist_workflow_fixture_run_controlled_reusing_request(
    payload,
    repeat('9', 64),
    'cli',
    '5f000000-0000-0000-0000-000000000006'
  ) FROM fixture_payloads$$,
  '23514',
  'control_request_correlation_mismatch',
  'a parsed fixture scenario cannot be reused for a different fixture run'
);
SELECT lives_ok(
  $$INSERT INTO fixture_results
    SELECT 'reused', public.persist_workflow_fixture_run_controlled_reusing_request(
      payload,
      repeat('9', 64),
      'cli',
      '5f000000-0000-0000-0000-000000000003'
    )
    FROM fixture_payloads$$,
  'a fixture mutation atomically reuses its conversational control request'
);
RESET ROLE;

SELECT is(
  jsonb_build_object(
    'count', (SELECT count(*) FROM public.workflow_control_requests WHERE input_hash = repeat('f', 64)),
    'status', (SELECT resolution_status FROM public.workflow_control_requests WHERE id = '5f000000-0000-0000-0000-000000000003')
  ),
  '{"count":1,"status":"executed"}'::JSONB,
  'the mutation transitions one existing control row instead of inserting a duplicate'
);
SELECT is(
  (
    SELECT jsonb_build_object(
      'trace', langsmith_trace_id,
      'run', langsmith_run_id
    )
    FROM public.workflow_control_requests
    WHERE id = '5f000000-0000-0000-0000-000000000003'
  ),
  '{"trace":"fixture-parser-trace","run":"fixture-parser-run"}'::JSONB,
  'the terminal transition preserves LangSmith correlation'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_audit_events
    WHERE event_type = 'control_request_transitioned'
      AND payload ->> 'controlRequestId' = '5f000000-0000-0000-0000-000000000003'
  ),
  1::BIGINT,
  'the atomic mutation records one terminal control audit event'
);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.disable_own_company_membership('52000000-0000-0000-0000-000000000001')$$,
  'checked self-disable RPC succeeds for the current user'
);
RESET ROLE;
SELECT is(
  (
    SELECT jsonb_build_object(
      'companyId', company_id,
      'userId', user_id,
      'role', role,
      'status', status
    )
    FROM public.company_memberships
    WHERE company_id = '52000000-0000-0000-0000-000000000001'
      AND user_id = '51000000-0000-0000-0000-000000000001'
  ),
  '{"companyId":"52000000-0000-0000-0000-000000000001","userId":"51000000-0000-0000-0000-000000000001","role":"owner","status":"disabled"}'::JSONB,
  'self-disable preserves company and role identity'
);

SELECT * FROM finish();
ROLLBACK;
