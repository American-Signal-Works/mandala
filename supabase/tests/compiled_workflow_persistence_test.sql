BEGIN;
SELECT plan(33);

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
    '81000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'compiled-owner@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '81000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'compiled-viewer@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

INSERT INTO public.companies (id, name, created_by)
VALUES (
  '82000000-0000-0000-0000-000000000001',
  'Compiled Persistence Company',
  '81000000-0000-0000-0000-000000000001'
);

INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'owner'
  ),
  (
    '82000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000002',
    'viewer'
  );

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.persist_compiled_workflow_review_controlled(uuid,uuid,uuid,jsonb,text,text)',
    'EXECUTE'
  ),
  'authenticated owners and admins can call the checked sandbox persister'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.persist_compiled_workflow_review_controlled(uuid,uuid,uuid,jsonb,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot persist compiled workflow reviews'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'workflow_private.compiled_workflow_persistence_receipts',
    'SELECT'
  ),
  'compiled persistence receipts remain private'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '81000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.install_agent_workflow_version(
    '82000000-0000-0000-0000-000000000001',
    '# Coffee reorder sandbox skill',
    jsonb_build_object(
      'workflowKey', 'coffee_reorder',
      'workflowType', 'procurement_reorder',
      'name', 'Coffee Reorder',
      'version', '1.0.0',
      'compilerVersion', '1.0.0',
      'spec', '{
        "schemaVersion":"mandala.ai/v1",
        "compilerVersion":"1.0.0",
        "sourceDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "manifestDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "identity":{"id":"coffee_reorder","name":"Coffee Reorder","version":"1.0.0","description":"Sandbox reorder review."},
        "workflow":{"type":"procurement_reorder","status":"draft","default_mode":"mock","triggers":[{"id":"manual_test","kind":"manual","description":"Run sandbox test."}]},
        "capabilityBindings":[
          {"id":"commerce.inventory.read","version":"1.0.0","access":"read","connectorId":"mandala.synthetic-commerce","schemaDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","toolName":"read_inventory","healthy":true,"granted":true,"alias":"inventory","useInPrompt":true},
          {"id":"procurement.purchase-order.mock-execute","version":"1.0.0","access":"execute","connectorId":"mandala.synthetic-commerce","schemaDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","toolName":"execute_mock_purchase_order","healthy":true,"granted":true,"alias":"purchase_order","useInPrompt":false}
        ],
        "graph":[],
        "rules":[],
        "records":{
          "item":{"type":"coffee_reorder_review","key":{"value":"coffee-001"},"title":{"value":"Review coffee reorder"},"priority":{"value":80},"related":{}},
          "recommendation":{"rationale":{"value":"Inventory is low."},"confidence":{"value":0.9},"output":{}},
          "draft":{"action":"execute_mock_purchase_order","payload":{},"edit_policy":{"editable":true,"require_reason":true,"immutable_paths":[["vendor"]],"array_length_paths":[],"positive_integer_paths":[["quantity"]],"non_empty_string_paths":[]}}
        },
        "evidence":{"requirements":["Current inventory"],"assumptions":[],"source_capabilities":["commerce.inventory.read"]},
        "approvals":[{"action":"execute_mock_purchase_order","minimum_role":"approver","human_required":true,"warning_acknowledgement":true}],
        "actions":[{"id":"execute_mock_purchase_order","capability":"procurement.purchase-order.mock-execute","mode":"mock","requires_approval":true}],
        "tests":[],
        "guidance":{"purpose":"Test","investigation":"Inspect","decision":"Review","exceptions":"Block","outputQuality":"Cite evidence"}
      }'::JSONB
    ),
    '{"ok":true,"diagnostics":{}}'::JSONB
  )$$,
  'an owner installs the immutable compiled sandbox workflow'
);
SELECT lives_ok(
  $$SELECT public.configure_company_connector_installation(
    '82000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000101',
    'Synthetic commerce'
  )$$,
  'the synthetic connector is installed'
);
SELECT lives_ok(
  $$SELECT public.set_company_connector_health(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.company_connector_installations WHERE company_id = '82000000-0000-0000-0000-000000000001'),
    'healthy',
    (SELECT schema_hash FROM public.connector_definition_versions WHERE id = '60000000-0000-0000-0000-000000000101'),
    '{"providerStatus":"synthetic"}'::JSONB
  )$$,
  'the connector is healthy and schema-compatible'
);
SELECT lives_ok(
  $$SELECT public.set_company_capability_policy(
      '82000000-0000-0000-0000-000000000001',
      capability_id,
      true,
      CASE WHEN capability_id = '61000000-0000-0000-0000-000000000106'::UUID THEN 'approver' ELSE 'member' END,
      capability_id <> '61000000-0000-0000-0000-000000000106'::UUID,
      true,
      1000,
      1048576
    )
    FROM unnest(ARRAY[
      '61000000-0000-0000-0000-000000000102'::UUID,
      '61000000-0000-0000-0000-000000000106'::UUID
    ]) capability_id$$,
  'read and mock-write capability policies are enabled'
);
SELECT lives_ok(
  $$SELECT public.set_company_connector_capability_grant(
      '82000000-0000-0000-0000-000000000001',
      (SELECT id FROM public.company_connector_installations WHERE company_id = '82000000-0000-0000-0000-000000000001'),
      capability_id,
      'active'
    )
    FROM unnest(ARRAY[
      '61000000-0000-0000-0000-000000000102'::UUID,
      '61000000-0000-0000-0000-000000000106'::UUID
    ]) capability_id$$,
  'both manifest capabilities are granted'
);
SELECT lives_ok(
  $$SELECT public.set_company_approval_policy_controlled(
    '82000000-0000-0000-0000-000000000001',
    'procurement_reorder',
    'execute_mock_purchase_order',
    'approver',
    true,
    true
  )$$,
  'the mock action has a human approval policy'
);
SELECT lives_ok(
  $$SELECT public.create_workflow_binding_snapshot(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'coffee_reorder'),
    jsonb_build_array(
      jsonb_build_object(
        'requirementKey', 'inventory',
        'grantId', (SELECT id FROM public.company_connector_capability_grants WHERE company_id = '82000000-0000-0000-0000-000000000001' AND capability_version_id = '61000000-0000-0000-0000-000000000102')
      ),
      jsonb_build_object(
        'requirementKey', 'purchase_order',
        'grantId', (SELECT id FROM public.company_connector_capability_grants WHERE company_id = '82000000-0000-0000-0000-000000000001' AND capability_version_id = '61000000-0000-0000-0000-000000000106')
      )
    )
  )$$,
  'the sandbox run receives a valid frozen binding snapshot'
);
SELECT lives_ok(
  $$SELECT public.install_agent_workflow_version(
    '82000000-0000-0000-0000-000000000001',
    '# Spoofed unsafe workflow',
    jsonb_build_object(
      'workflowKey', 'spoofed_reorder',
      'workflowType', 'procurement_reorder',
      'name', 'Spoofed Reorder',
      'version', '1.0.0',
      'compilerVersion', '1.0.0',
      'spec', '{
        "schemaVersion":"mandala.ai/v1",
        "compilerVersion":"1.0.0",
        "sourceDigest":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "manifestDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        "identity":{"id":"spoofed_reorder","name":"Spoofed Reorder","version":"1.0.0","description":"Caller claims compiler success."},
        "workflow":{"type":"procurement_reorder","status":"draft","default_mode":"mock","triggers":[{"id":"manual_test","kind":"manual","description":"Test."}]},
        "capabilityBindings":[{"id":"commerce.inventory.read","version":"1.0.0","access":"read","connectorId":"mandala.synthetic-commerce","schemaDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","toolName":"read_inventory","healthy":true,"granted":true,"alias":"inventory","useInPrompt":true}],
        "graph":[],
        "rules":[],
        "records":{"item":{"type":"spoofed_review","key":{"value":"spoof"},"title":{"value":"Spoof"},"priority":{"value":50},"related":{}},"recommendation":{"rationale":{"value":"Spoof"},"confidence":{"value":1},"output":{}},"draft":{"action":"execute_mock_purchase_order","payload":{},"edit_policy":{"editable":false,"require_reason":true,"immutable_paths":[],"array_length_paths":[],"positive_integer_paths":[],"non_empty_string_paths":[]}}},
        "evidence":{"requirements":["Inventory"],"assumptions":[],"source_capabilities":["commerce.inventory.read"]},
        "approvals":[{"action":"execute_mock_purchase_order","minimum_role":"approver","human_required":true,"warning_acknowledgement":true}],
        "actions":[{"id":"execute_mock_purchase_order","capability":"procurement.purchase-order.mock-execute","mode":"mock","requires_approval":true}],
        "tests":[],
        "guidance":{"purpose":"Spoof","investigation":"Spoof","decision":"Spoof","exceptions":"Spoof","outputQuality":"Spoof"}
      }'::JSONB
    ),
    '{"ok":true,"diagnostics":{}}'::JSONB
  )$$,
  'an admin-submitted compiler result remains subject to database enforcement'
);
SELECT lives_ok(
  $$SELECT public.create_workflow_binding_snapshot(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'spoofed_reorder'),
    jsonb_build_array(jsonb_build_object(
      'requirementKey', 'inventory',
      'grantId', (SELECT id FROM public.company_connector_capability_grants WHERE company_id = '82000000-0000-0000-0000-000000000001' AND capability_version_id = '61000000-0000-0000-0000-000000000102')
    ))
  )$$,
  'the spoofed workflow can freeze only the read capability actually granted'
);
SELECT throws_ok(
  $$SELECT public.activate_agent_workflow(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'spoofed_reorder'),
    (SELECT snapshot.id FROM public.workflow_binding_snapshots snapshot JOIN public.agent_workflows workflow ON workflow.id = snapshot.workflow_id AND workflow.company_id = snapshot.company_id WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001' AND workflow.workflow_key = 'spoofed_reorder'),
    NULL
  )$$,
  '42501',
  'unsafe_compiled_workflow_binding',
  'caller-supplied compiler success cannot activate an unbound write action'
);
RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.workflow_activations WHERE company_id = '82000000-0000-0000-0000-000000000001'),
  0::BIGINT,
  'sandbox persistence is tested before activation'
);

CREATE TEMP TABLE compiled_test_payloads (payload JSONB NOT NULL);
GRANT SELECT ON compiled_test_payloads TO authenticated;
INSERT INTO compiled_test_payloads(payload)
SELECT jsonb_build_object(
  'company_id', '82000000-0000-0000-0000-000000000001',
  'definition', jsonb_build_object(
    'id', workflow.id,
    'company_id', workflow.company_id,
    'workflow_key', workflow.workflow_key,
    'workflow_type', workflow.workflow_type,
    'name', workflow.name,
    'version', workflow.version,
    'status', workflow.status,
    'spec', '{}'::JSONB,
    'skill_markdown', workflow.skill_markdown,
    'compile_result', workflow.compile_result
  ),
  'run', '{
    "id":"83000000-0000-0000-0000-000000000001",
    "company_id":"82000000-0000-0000-0000-000000000001",
    "workflow_id":"83000000-0000-0000-0000-000000000099",
    "workflow_type":"procurement_reorder",
    "status":"waiting_for_approval",
    "input":{"manifestDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","trigger":{"id":"manual_test","kind":"manual","input":{"sku":"COFFEE-001"}}},
    "langgraph_thread_id":"compiled-thread-1",
    "langgraph_checkpoint_id":"compiled-checkpoint-1",
    "langsmith_trace_id":"compiled-trace-1",
    "langsmith_run_id":"compiled-run-1",
    "started_by":"81000000-0000-0000-0000-000000000001",
    "started_at":"2026-07-14T03:00:00Z",
    "completed_at":null
  }'::JSONB || jsonb_build_object('workflow_id', workflow.id),
  'event', '{
    "id":"84000000-0000-0000-0000-000000000001",
    "company_id":"82000000-0000-0000-0000-000000000001",
    "workflow_run_id":"83000000-0000-0000-0000-000000000001",
    "workflow_id":"83000000-0000-0000-0000-000000000099",
    "event_key":"procurement_reorder:manual:manual_test:coffee-001",
    "event_type":"procurement_reorder_manual",
    "origin":"manual",
    "source_ref":{},
    "payload":{"manifestDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","trigger":{"id":"manual_test","kind":"manual","input":{"sku":"COFFEE-001"}}},
    "freshness_state":"fresh",
    "validation_status":"warn",
    "validation_result":{"status":"warn","issues":[{"code":"rule:recent_sales_spike","message":"Recent sales spike requires human acknowledgement.","kind":"warning"}],"reasons":[],"warnings":["Recent sales spike requires human acknowledgement."],"suppressRecommendation":false},
    "created_at":"2026-07-14T03:00:00Z"
  }'::JSONB || jsonb_build_object('workflow_id', workflow.id),
  'item', '{
    "id":"85000000-0000-0000-0000-000000000001",
    "company_id":"82000000-0000-0000-0000-000000000001",
    "workflow_run_id":"83000000-0000-0000-0000-000000000001",
    "workflow_event_id":"84000000-0000-0000-0000-000000000001",
    "workflow_id":"83000000-0000-0000-0000-000000000099",
    "item_key":"coffee-reorder-001",
    "item_type":"coffee_reorder_review",
    "title":"Review coffee reorder",
    "status":"active",
    "priority":80,
    "related_records":{"sku":"COFFEE-001"},
    "resolution_state":{"manifestDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
    "created_at":"2026-07-14T03:00:00Z",
    "updated_at":"2026-07-14T03:00:00Z"
  }'::JSONB || jsonb_build_object('workflow_id', workflow.id),
  'context_packet', '{
    "id":"86000000-0000-0000-0000-000000000001",
    "company_id":"82000000-0000-0000-0000-000000000001",
    "workflow_run_id":"83000000-0000-0000-0000-000000000001",
    "workflow_item_id":"85000000-0000-0000-0000-000000000001",
    "sources":[],
    "facts":{"onHand":4},
    "memory_refs":[],
    "freshness_state":"fresh",
    "warnings":[],
    "created_at":"2026-07-14T03:00:00Z"
  }'::JSONB,
  'recommendation', '{
    "id":"87000000-0000-0000-0000-000000000001",
    "company_id":"82000000-0000-0000-0000-000000000001",
    "workflow_run_id":"83000000-0000-0000-0000-000000000001",
    "workflow_item_id":"85000000-0000-0000-0000-000000000001",
    "context_packet_id":"86000000-0000-0000-0000-000000000001",
    "status":"ready_for_review",
    "rationale_summary":"Inventory is low.",
    "warning_state":"pass",
    "warnings":[],
    "confidence":0.9,
    "freshness_state":"fresh",
    "input":{"onHand":4},
    "output":{"quantity":24},
    "langsmith_trace_id":"compiled-trace-1",
    "langsmith_run_id":"compiled-run-1",
    "created_at":"2026-07-14T03:00:00Z"
  }'::JSONB,
  'evidence', '{
    "id":"88000000-0000-0000-0000-000000000001",
    "company_id":"82000000-0000-0000-0000-000000000001",
    "workflow_run_id":"83000000-0000-0000-0000-000000000001",
    "workflow_item_id":"85000000-0000-0000-0000-000000000001",
    "recommendation_run_id":"87000000-0000-0000-0000-000000000001",
    "source_refs":[],
    "assumptions":[],
    "warnings":[],
    "evidence":[{"requirement":"Current inventory"}],
    "created_at":"2026-07-14T03:00:00Z"
  }'::JSONB,
  'draft', '{
    "id":"89000000-0000-0000-0000-000000000001",
    "company_id":"82000000-0000-0000-0000-000000000001",
    "workflow_run_id":"83000000-0000-0000-0000-000000000001",
    "workflow_item_id":"85000000-0000-0000-0000-000000000001",
    "recommendation_run_id":"87000000-0000-0000-0000-000000000001",
    "evidence_snapshot_id":"88000000-0000-0000-0000-000000000001",
    "action_type":"execute_mock_purchase_order",
    "status":"pending_review",
    "payload":{"vendor":"Synthetic Coffee Supply","quantity":24},
    "payload_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "edit_policy":{"editable":true,"requireReason":true,"immutablePaths":[["vendor"]],"arrayLengthPaths":[],"positiveIntegerPaths":[["quantity"]],"nonEmptyStringPaths":[]},
    "created_at":"2026-07-14T03:00:00Z",
    "updated_at":"2026-07-14T03:00:00Z"
  }'::JSONB,
  'audit_events', '[
    {
      "id":"8a000000-0000-0000-0000-000000000002",
      "company_id":"82000000-0000-0000-0000-000000000001",
      "actor_type":"user",
      "actor_id":"81000000-0000-0000-0000-000000000001",
      "workflow_run_id":"83000000-0000-0000-0000-000000000001",
      "workflow_item_id":"85000000-0000-0000-0000-000000000001",
      "event_type":"event_validated",
      "summary":"Validated compiled workflow event: warn.",
      "payload":{"validation":{"status":"warn","issues":[{"code":"rule:recent_sales_spike","message":"Recent sales spike requires human acknowledgement.","kind":"warning"}],"reasons":[],"warnings":["Recent sales spike requires human acknowledgement."],"suppressRecommendation":false}},
      "trace":{},
      "created_at":"2026-07-14T03:00:00Z"
    },
    {
      "id":"8a000000-0000-0000-0000-000000000001",
      "company_id":"82000000-0000-0000-0000-000000000001",
      "actor_type":"user",
      "actor_id":"81000000-0000-0000-0000-000000000001",
      "workflow_run_id":"83000000-0000-0000-0000-000000000001",
      "workflow_item_id":"85000000-0000-0000-0000-000000000001",
      "event_type":"recommendation_created",
      "summary":"Created a compiled workflow recommendation for human review.",
      "payload":{"workflowItemId":"85000000-0000-0000-0000-000000000001"},
      "trace":{},
      "created_at":"2026-07-14T03:00:00Z"
    }
  ]'::JSONB
)
FROM public.agent_workflows workflow
WHERE workflow.company_id = '82000000-0000-0000-0000-000000000001'
  AND workflow.workflow_key = 'coffee_reorder';

SELECT set_config(
  'request.jwt.claim.sub',
  '81000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.persist_compiled_workflow_review_controlled(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'spoofed_reorder'),
    (SELECT snapshot.id FROM public.workflow_binding_snapshots snapshot JOIN public.agent_workflows workflow ON workflow.id = snapshot.workflow_id AND workflow.company_id = snapshot.company_id WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001' AND workflow.workflow_key = 'spoofed_reorder'),
    (SELECT payload FROM compiled_test_payloads),
    repeat('9', 64),
    'api'
  )$$,
  '42501',
  'unsafe_compiled_workflow_binding',
  'caller-supplied compiler success cannot persist an unbound write action'
);
SELECT lives_ok(
  $$SELECT public.persist_compiled_workflow_review_controlled(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'coffee_reorder'),
    (SELECT snapshot.id FROM public.workflow_binding_snapshots snapshot JOIN public.agent_workflows workflow ON workflow.id = snapshot.workflow_id AND workflow.company_id = snapshot.company_id WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001' AND workflow.workflow_key = 'coffee_reorder'),
    (SELECT payload FROM compiled_test_payloads),
    repeat('1', 64),
    'api'
  )$$,
  'a valid pre-activation sandbox review persists atomically'
);
RESET ROLE;

SELECT is(
  (
    SELECT jsonb_build_object(
      'status', status,
      'bindingSnapshotId', workflow_binding_snapshot_id,
      'startedBy', started_by
    )
    FROM public.workflow_runs
    WHERE id = '83000000-0000-0000-0000-000000000001'
  ),
  (
    SELECT jsonb_build_object(
      'status', 'waiting_for_approval',
      'bindingSnapshotId', snapshot.id,
      'startedBy', '81000000-0000-0000-0000-000000000001'
    )
    FROM public.workflow_binding_snapshots snapshot
    JOIN public.agent_workflows workflow
      ON workflow.id = snapshot.workflow_id
     AND workflow.company_id = snapshot.company_id
    WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001'
      AND workflow.workflow_key = 'coffee_reorder'
  ),
  'the run is pinned to the supplied immutable binding snapshot'
);
SELECT is(
  (
    SELECT jsonb_build_object(
      'items', (SELECT count(*) FROM public.workflow_items WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001'),
      'contexts', (SELECT count(*) FROM public.workflow_context_packets WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001'),
      'recommendations', (SELECT count(*) FROM public.workflow_recommendation_runs WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001'),
      'evidence', (SELECT count(*) FROM public.workflow_evidence_snapshots WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001'),
      'drafts', (SELECT count(*) FROM public.workflow_action_drafts WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001')
    )
  ),
  '{"items":1,"contexts":1,"recommendations":1,"evidence":1,"drafts":1}'::JSONB,
  'the complete existing workflow review graph is inserted'
);
SELECT is(
  (
    SELECT jsonb_build_object(
      'eventIssue', event.validation_result #>> '{issues,0,code}',
      'auditIssue', audit.payload #>> '{validation,issues,0,code}',
      'legacyWarning', event.validation_result #>> '{warnings,0}'
    )
    FROM public.workflow_events event
    JOIN public.workflow_audit_events audit
      ON audit.workflow_run_id = event.workflow_run_id
     AND audit.event_type = 'event_validated'
    WHERE event.id = '84000000-0000-0000-0000-000000000001'
  ),
  '{"eventIssue":"rule:recent_sales_spike","auditIssue":"rule:recent_sales_spike","legacyWarning":"Recent sales spike requires human acknowledgement."}'::JSONB,
  'structured validation issues and legacy messages persist in event and audit JSONB'
);
SELECT is(
  (
    SELECT jsonb_build_object(
      'action', action_type,
      'status', status,
      'hashMatches', payload_hash = encode(extensions.digest(convert_to(payload::TEXT, 'UTF8'), 'sha256'), 'hex')
    )
    FROM public.workflow_action_drafts
    WHERE id = '89000000-0000-0000-0000-000000000001'
  ),
  '{"action":"execute_mock_purchase_order","status":"pending_review","hashMatches":true}'::JSONB,
  'the database recomputes the declared mock draft payload hash'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_audit_events
    WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001'
      AND event_type = 'compiled_workflow_sandbox_persisted'
      AND payload -> 'test' = 'true'::JSONB
  ),
  1::BIGINT,
  'a database-owned audit event identifies the run as a sandbox test'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_control_requests
    WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001'
      AND normalized_intent ->> 'kind' = 'run_compiled_workflow_test'
  ),
  1::BIGINT,
  'the controlled mutation records one sanitized control-plane event'
);
SELECT is(
  (
    SELECT count(*)
    FROM workflow_private.compiled_workflow_persistence_receipts
    WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001'
  ),
  1::BIGINT,
  'the transaction records one private idempotency receipt'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '81000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.persist_compiled_workflow_review_controlled(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'coffee_reorder'),
    (SELECT snapshot.id FROM public.workflow_binding_snapshots snapshot JOIN public.agent_workflows workflow ON workflow.id = snapshot.workflow_id AND workflow.company_id = snapshot.company_id WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001' AND workflow.workflow_key = 'coffee_reorder'),
    (SELECT payload FROM compiled_test_payloads),
    repeat('1', 64),
    'api'
  )$$,
  'an identical retry returns its stored result'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.workflow_runs WHERE company_id = '82000000-0000-0000-0000-000000000001'),
  1::BIGINT,
  'an identical retry does not duplicate the workflow graph'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '81000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.persist_compiled_workflow_review_controlled(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'coffee_reorder'),
    (SELECT snapshot.id FROM public.workflow_binding_snapshots snapshot JOIN public.agent_workflows workflow ON workflow.id = snapshot.workflow_id AND workflow.company_id = snapshot.company_id WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001' AND workflow.workflow_key = 'coffee_reorder'),
    jsonb_set((SELECT payload FROM compiled_test_payloads), '{item,title}', '"Changed title"'),
    repeat('1', 64),
    'api'
  )$$,
  '22023',
  'idempotency_key_reused',
  'an input hash cannot be reused with a changed payload'
);
SELECT throws_ok(
  $$SELECT public.persist_compiled_workflow_review_controlled(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'coffee_reorder'),
    (SELECT snapshot.id FROM public.workflow_binding_snapshots snapshot JOIN public.agent_workflows workflow ON workflow.id = snapshot.workflow_id AND workflow.company_id = snapshot.company_id WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001' AND workflow.workflow_key = 'coffee_reorder'),
    jsonb_set((SELECT payload FROM compiled_test_payloads), '{draft,payload,mode}', '"live"'),
    repeat('2', 64),
    'api'
  )$$,
  '22023',
  'unsafe_compiled_workflow_action',
  'a sandbox persistence request cannot smuggle a live action mode'
);
SELECT throws_ok(
  $$SELECT public.persist_compiled_workflow_review_controlled(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'coffee_reorder'),
    (SELECT snapshot.id FROM public.workflow_binding_snapshots snapshot JOIN public.agent_workflows workflow ON workflow.id = snapshot.workflow_id AND workflow.company_id = snapshot.company_id WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001' AND workflow.workflow_key = 'coffee_reorder'),
    jsonb_set((SELECT payload FROM compiled_test_payloads), '{item,item_type}', '"undeclared_review"'),
    repeat('3', 64),
    'api'
  )$$,
  '22023',
  'invalid_compiled_review_graph',
  'the item record type must be declared by the compiled manifest'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  '81000000-0000-0000-0000-000000000002',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.persist_compiled_workflow_review_controlled(
    '82000000-0000-0000-0000-000000000001',
    (SELECT id FROM public.agent_workflows WHERE company_id = '82000000-0000-0000-0000-000000000001' AND workflow_key = 'coffee_reorder'),
    (SELECT snapshot.id FROM public.workflow_binding_snapshots snapshot JOIN public.agent_workflows workflow ON workflow.id = snapshot.workflow_id AND workflow.company_id = snapshot.company_id WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001' AND workflow.workflow_key = 'coffee_reorder'),
    (SELECT payload FROM compiled_test_payloads),
    repeat('4', 64),
    'api'
  )$$,
  '42501',
  'forbidden',
  'a viewer cannot persist a sandbox workflow graph'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  '81000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.record_workflow_decision_controlled(
    '82000000-0000-0000-0000-000000000001',
    '89000000-0000-0000-0000-000000000001',
    'approve',
    repeat('5', 64),
    'api',
    'Approved sandbox recommendation.',
    true,
    NULL
  )$$,
  'approving a compiled review records the human decision'
);
RESET ROLE;
SELECT is(
  (
    SELECT jsonb_build_object(
      'eventType', event_type,
      'nodeKey', node_key,
      'status', status,
      'decision', payload ->> 'decision',
      'snapshotMatches', binding_snapshot_id = (
        SELECT snapshot.id FROM public.workflow_binding_snapshots snapshot JOIN public.agent_workflows workflow ON workflow.id = snapshot.workflow_id AND workflow.company_id = snapshot.company_id WHERE snapshot.company_id = '82000000-0000-0000-0000-000000000001' AND workflow.workflow_key = 'coffee_reorder'
      ),
      'dedupeLength', length(dedupe_key)
    )
    FROM public.workflow_resume_outbox
    WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001'
  ),
  '{"eventType":"resume_after_approval","nodeKey":"human_approval","status":"pending","decision":"approve","snapshotMatches":true,"dedupeLength":64}'::JSONB,
  'approval enqueues one deterministic durable LangGraph resume request'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_resume_outbox
    WHERE workflow_run_id = '83000000-0000-0000-0000-000000000001'
  ),
  1::BIGINT,
  'one compiled decision produces exactly one resume outbox row'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_resume_outbox outbox
    JOIN public.workflow_runs workflow_run
      ON workflow_run.id = outbox.workflow_run_id
     AND workflow_run.company_id = outbox.company_id
    WHERE outbox.checkpoint ->> 'langGraphThreadId' = workflow_run.langgraph_thread_id
      AND outbox.checkpoint ->> 'langGraphCheckpointId' = workflow_run.langgraph_checkpoint_id
  ),
  1::BIGINT,
  'the outbox carries the durable checkpoint correlation required by a worker'
);

SELECT * FROM finish();
ROLLBACK;
