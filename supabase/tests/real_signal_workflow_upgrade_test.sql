BEGIN;
SELECT plan(8);

INSERT INTO auth.users(
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
) VALUES (
  'e1000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'signal-upgrade-owner@example.test',
  '',
  now(),
  '{}',
  '{}',
  now(),
  now()
);
INSERT INTO public.companies(id, name, created_by)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'Signal Upgrade Company',
  'e1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.company_memberships(company_id, user_id, role)
VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'owner'
);
INSERT INTO public.agent_workflows(
  id,
  company_id,
  workflow_key,
  workflow_type,
  name,
  version,
  status,
  spec,
  skill_markdown,
  compile_result,
  created_by,
  updated_by,
  skill_source_hash,
  compiler_version,
  compiled_manifest_hash,
  compiled_at,
  compiler_diagnostics
) VALUES (
  'e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'procurement-reorder',
  'procurement_reorder',
  'Procurement Reorder Review',
  '1.0.1',
  'active',
  '{
    "schemaVersion": "mandala.ai/v1",
    "compilerVersion": "1.0.0",
    "sourceDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "manifestDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "capabilityBindings": [],
    "actions": [],
    "approvals": [],
    "records": {},
    "identity": {
      "id": "procurement-reorder",
      "name": "Procurement Reorder Review",
      "version": "1.0.1"
    },
    "workflow": {
      "type": "procurement_reorder",
      "status": "draft",
      "default_mode": "mock",
      "triggers": [
        {
          "id": "manual-review",
          "kind": "manual",
          "description": "Run an inventory review on demand."
        },
        {
          "id": "synthetic-test",
          "kind": "fixture",
          "description": "Test against the Mandala Bean Co. synthetic commerce dataset."
        }
      ]
    }
  }'::JSONB,
  '---
metadata:
  version: 1.0.1
workflow:
  triggers:
    - id: manual-review
      kind: manual
      description: Run an inventory review on demand.
    - id: synthetic-test
      kind: fixture
      description: Test against the Mandala Bean Co. synthetic commerce dataset.
---',
  '{"ok":true}'::JSONB,
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  '1.0.0',
  repeat('b', 64),
  now(),
  '{}'::JSONB
);
INSERT INTO public.workflow_binding_snapshots(
  id,
  company_id,
  workflow_id,
  manifest_hash,
  grant_digest,
  created_by
) VALUES (
  'e3100000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  repeat('b', 64),
  repeat('c', 64),
  'e1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.workflow_activations(
  company_id,
  workflow_key,
  workflow_id,
  binding_snapshot_id,
  activated_by
) VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'procurement-reorder',
  'e3000000-0000-4000-8000-000000000001',
  'e3100000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.agent_runtime_states(
  id,
  company_id,
  workflow_id,
  lifecycle_state,
  state_version,
  readiness_status,
  readiness_issues,
  readiness_hash,
  readiness_checked_at,
  binding_snapshot_id,
  updated_by
) VALUES (
  'e3200000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'active',
  3,
  'ready',
  '[]'::JSONB,
  repeat('d', 64),
  now(),
  'e3100000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.agent_evaluation_cases(
  id,
  company_id,
  case_key,
  version,
  fixture,
  input_digest,
  missing_data_state,
  created_by
) VALUES (
  'e3300000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'procurement_signal_upgrade',
  '1.0.1',
  '{}'::JSONB,
  repeat('e', 64),
  'complete',
  'e1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.agent_evaluation_runs(
  id,
  company_id,
  evaluation_case_id,
  workflow_id,
  manifest_digest,
  dataset_digest,
  evaluator_version,
  confidence_definition_version,
  threshold_decision
) VALUES (
  'e3400000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e3300000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  repeat('b', 64),
  repeat('f', 64),
  '1.0.0',
  '1.0.0',
  'pass'
);
INSERT INTO public.agent_promotion_checkpoints(
  company_id,
  workflow_id,
  workflow_version,
  evaluation_run_id,
  thresholds,
  decision,
  reason
) VALUES (
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  '1.0.1',
  'e3400000-0000-4000-8000-000000000001',
  '{"minAccuracy":0.9}'::JSONB,
  'pass',
  'The currently active version passed its server-owned promotion checkpoint.'
);

SELECT is(
  workflow_private.upgrade_active_procurement_signal_workflows(),
  1,
  'one active v1.0.1 procurement workflow is upgraded'
);
SELECT is(
  workflow_private.upgrade_active_procurement_signal_workflows(),
  0,
  'the workflow upgrade is idempotent'
);
SELECT is((
  SELECT workflow.version
  FROM public.workflow_activations activation
  JOIN public.agent_workflows workflow
    ON workflow.id = activation.workflow_id
   AND workflow.company_id = activation.company_id
  WHERE activation.company_id = 'e2000000-0000-4000-8000-000000000001'
), '1.0.2', 'the activation advances to the new compiled version');
SELECT is((
  SELECT count(*)
  FROM public.workflow_activations activation
  JOIN public.agent_workflows workflow
    ON workflow.id = activation.workflow_id
   AND workflow.company_id = activation.company_id
  CROSS JOIN LATERAL jsonb_array_elements(
    workflow.spec #> '{workflow,triggers}'
  ) trigger
  WHERE activation.company_id = 'e2000000-0000-4000-8000-000000000001'
    AND trigger ->> 'id' = 'procurement-records-changed'
    AND trigger ->> 'kind' = 'webhook'
), 1::BIGINT, 'the active stored spec contains exactly one bounded connector trigger');
SELECT is((
  SELECT lifecycle_state
  FROM public.agent_runtime_states
  WHERE workflow_id = 'e3000000-0000-4000-8000-000000000001'
), 'paused', 'the superseded runtime is no longer active');
SELECT is((
  SELECT runtime_state.lifecycle_state
  FROM public.workflow_activations activation
  JOIN public.agent_runtime_states runtime_state
    ON runtime_state.company_id = activation.company_id
   AND runtime_state.workflow_id = activation.workflow_id
   AND runtime_state.binding_snapshot_id = activation.binding_snapshot_id
  WHERE activation.company_id = 'e2000000-0000-4000-8000-000000000001'
), 'active', 'the upgraded runtime remains active on its copied binding');
SELECT ok((
  SELECT snapshot.manifest_hash = workflow.compiled_manifest_hash
  FROM public.workflow_activations activation
  JOIN public.agent_workflows workflow
    ON workflow.id = activation.workflow_id
   AND workflow.company_id = activation.company_id
  JOIN public.workflow_binding_snapshots snapshot
    ON snapshot.id = activation.binding_snapshot_id
   AND snapshot.company_id = activation.company_id
   AND snapshot.workflow_id = activation.workflow_id
  WHERE activation.company_id = 'e2000000-0000-4000-8000-000000000001'
), 'the copied binding snapshot is tied to the new manifest hash');
SELECT ok((
  SELECT EXISTS (
    SELECT 1
    FROM public.agent_promotion_checkpoints checkpoint
    WHERE checkpoint.company_id = activation.company_id
      AND checkpoint.workflow_id = activation.workflow_id
      AND checkpoint.workflow_version = '1.0.2'
      AND checkpoint.decision = 'pass'
  )
  FROM public.workflow_activations activation
  WHERE activation.company_id = 'e2000000-0000-4000-8000-000000000001'
), 'the upgraded activation retains an explicit passing promotion checkpoint');

SELECT * FROM finish();
ROLLBACK;
