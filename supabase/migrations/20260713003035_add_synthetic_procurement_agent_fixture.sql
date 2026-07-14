-- Allow the guarded procurement adapter to accept the model-backed synthetic
-- scenario. All existing mock-only action, audit, and approval constraints
-- continue to apply.
UPDATE public.workflow_fixture_adapters
SET allowed_scenario_ids = array_append(
  allowed_scenario_ids,
  'synthetic_agent_run'
)
WHERE adapter_key = 'procurement_reorder_fixture_v1'
  AND NOT ('synthetic_agent_run' = ANY(allowed_scenario_ids));
