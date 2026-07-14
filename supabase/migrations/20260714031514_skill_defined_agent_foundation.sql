-- Skill-defined agent foundation.
--
-- Connector and capability definitions are platform-owned global catalog
-- records. Installations, grants, policies, bindings, activations, and resume
-- work remain company-scoped. No connector credential material is stored in
-- this exposed schema.

CREATE TABLE public.connector_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_key TEXT NOT NULL UNIQUE
    CHECK (connector_key ~ '^[a-z0-9][a-z0-9._-]{1,99}$'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.connector_definition_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_definition_id UUID NOT NULL
    REFERENCES public.connector_definitions(id) ON DELETE RESTRICT,
  version TEXT NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+$'),
  manifest JSONB NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  schema_hash TEXT NOT NULL CHECK (schema_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connector_definition_id, version),
  UNIQUE (id, connector_definition_id)
);

CREATE TABLE public.capability_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key TEXT NOT NULL UNIQUE
    CHECK (capability_key ~ '^[a-z0-9][a-z0-9._-]{2,149}$'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  effect TEXT NOT NULL CHECK (effect IN ('read', 'propose', 'write')),
  risk_class TEXT NOT NULL
    CHECK (risk_class IN ('read', 'state_change', 'mock_execution', 'live_execution')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.capability_definition_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_definition_id UUID NOT NULL
    REFERENCES public.capability_definitions(id) ON DELETE RESTRICT,
  version TEXT NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+$'),
  input_schema JSONB NOT NULL CHECK (jsonb_typeof(input_schema) = 'object'),
  output_schema JSONB NOT NULL CHECK (jsonb_typeof(output_schema) = 'object'),
  schema_hash TEXT NOT NULL CHECK (schema_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (capability_definition_id, version),
  UNIQUE (id, capability_definition_id)
);

CREATE TABLE public.capability_field_classifications (
  capability_version_id UUID NOT NULL
    REFERENCES public.capability_definition_versions(id) ON DELETE CASCADE,
  json_pointer TEXT NOT NULL
    CHECK (json_pointer = '' OR json_pointer ~ '^/([^/~]|~[01])+(?:/([^/~]|~[01])+)*$'),
  classification TEXT NOT NULL
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted', 'secret')),
  model_allowed BOOLEAN NOT NULL DEFAULT false,
  terminal_allowed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (capability_version_id, json_pointer),
  CHECK (classification <> 'secret' OR (NOT model_allowed AND NOT terminal_allowed))
);

CREATE TABLE public.connector_capability_offerings (
  connector_version_id UUID NOT NULL
    REFERENCES public.connector_definition_versions(id) ON DELETE CASCADE,
  capability_version_id UUID NOT NULL
    REFERENCES public.capability_definition_versions(id) ON DELETE RESTRICT,
  provider_operation TEXT NOT NULL
    CHECK (provider_operation ~ '^[a-z0-9][a-z0-9._-]{1,149}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (connector_version_id, capability_version_id)
);

CREATE TABLE public.company_connector_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  connector_definition_id UUID NOT NULL
    REFERENCES public.connector_definitions(id) ON DELETE RESTRICT,
  connector_version_id UUID NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disabled', 'error', 'revoked')),
  installed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, connector_definition_id),
  UNIQUE (id, company_id),
  FOREIGN KEY (connector_version_id, connector_definition_id)
    REFERENCES public.connector_definition_versions(id, connector_definition_id)
    ON DELETE RESTRICT
);

CREATE TABLE public.company_connector_capability_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  installation_id UUID NOT NULL,
  capability_version_id UUID NOT NULL
    REFERENCES public.capability_definition_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  granted_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  UNIQUE (company_id, installation_id, capability_version_id),
  UNIQUE (id, company_id, capability_version_id),
  FOREIGN KEY (installation_id, company_id)
    REFERENCES public.company_connector_installations(id, company_id)
    ON DELETE CASCADE,
  CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

CREATE TABLE public.company_connector_health (
  installation_id UUID NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('healthy', 'degraded', 'unavailable', 'unknown')),
  observed_schema_hash TEXT CHECK (
    observed_schema_hash IS NULL OR observed_schema_hash ~ '^[a-f0-9]{64}$'
  ),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(details) = 'object'),
  PRIMARY KEY (installation_id, company_id),
  FOREIGN KEY (installation_id, company_id)
    REFERENCES public.company_connector_installations(id, company_id)
    ON DELETE CASCADE
);

CREATE TABLE public.company_capability_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  capability_version_id UUID NOT NULL
    REFERENCES public.capability_definition_versions(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  minimum_role TEXT NOT NULL DEFAULT 'member'
    CHECK (minimum_role IN ('owner', 'admin', 'approver', 'member', 'viewer')),
  allow_model_processing BOOLEAN NOT NULL DEFAULT false,
  require_human_approval BOOLEAN NOT NULL DEFAULT true,
  max_rows INTEGER NOT NULL DEFAULT 100 CHECK (max_rows BETWEEN 1 AND 10000),
  max_bytes INTEGER NOT NULL DEFAULT 262144 CHECK (max_bytes BETWEEN 1024 AND 10485760),
  updated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, capability_version_id)
);

ALTER TABLE public.agent_workflows
  ADD COLUMN skill_source_hash TEXT,
  ADD COLUMN compiler_version TEXT,
  ADD COLUMN compiled_manifest_hash TEXT,
  ADD COLUMN compiled_at TIMESTAMPTZ,
  -- Legacy fixture persistence uses jsonb_populate_record and therefore
  -- supplies NULL for columns that did not exist in the original payload.
  -- Compiled installs always write an object through the checked RPC.
  ADD COLUMN compiler_diagnostics JSONB DEFAULT '{}'::JSONB,
  ADD CONSTRAINT agent_workflows_skill_source_hash_check CHECK (
    skill_source_hash IS NULL OR skill_source_hash ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT agent_workflows_compiler_version_check CHECK (
    compiler_version IS NULL OR compiler_version ~ '^\d+\.\d+\.\d+$'
  ),
  ADD CONSTRAINT agent_workflows_compiled_manifest_hash_check CHECK (
    compiled_manifest_hash IS NULL OR compiled_manifest_hash ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT agent_workflows_compiler_diagnostics_check CHECK (
    jsonb_typeof(compiler_diagnostics) = 'object'
  ),
  ADD CONSTRAINT agent_workflows_compiler_metadata_consistency CHECK (
    (skill_source_hash IS NULL AND compiler_version IS NULL AND compiled_manifest_hash IS NULL AND compiled_at IS NULL)
    OR (skill_source_hash IS NOT NULL AND compiler_version IS NOT NULL AND compiled_manifest_hash IS NOT NULL AND compiled_at IS NOT NULL)
  );

CREATE TABLE public.workflow_binding_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL,
  manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  grant_digest TEXT NOT NULL CHECK (grant_digest ~ '^[a-f0-9]{64}$'),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  UNIQUE (id, company_id, workflow_id),
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE RESTRICT
);

CREATE TABLE public.workflow_capability_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  binding_snapshot_id UUID NOT NULL,
  requirement_key TEXT NOT NULL
    CHECK (requirement_key ~ '^[a-z0-9][a-z0-9._-]{1,149}$'),
  grant_id UUID NOT NULL,
  capability_version_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (binding_snapshot_id, requirement_key),
  FOREIGN KEY (binding_snapshot_id, company_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (grant_id, company_id, capability_version_id)
    REFERENCES public.company_connector_capability_grants(id, company_id, capability_version_id)
    ON DELETE RESTRICT
);

CREATE TABLE public.workflow_binding_snapshot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  binding_snapshot_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'invalidated')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (binding_snapshot_id, company_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id) ON DELETE CASCADE
);

CREATE TABLE public.workflow_activations (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_key TEXT NOT NULL,
  workflow_id UUID NOT NULL,
  binding_snapshot_id UUID NOT NULL,
  activation_sequence BIGINT NOT NULL DEFAULT 1 CHECK (activation_sequence > 0),
  activated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, workflow_key),
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (binding_snapshot_id, company_id, workflow_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id, workflow_id)
    ON DELETE RESTRICT
);

CREATE TABLE public.workflow_activation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_key TEXT NOT NULL,
  workflow_id UUID NOT NULL,
  binding_snapshot_id UUID NOT NULL,
  previous_workflow_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('activated', 'deactivated', 'rolled_back')),
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (binding_snapshot_id, company_id, workflow_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id, workflow_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (previous_workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE RESTRICT
);

ALTER TABLE public.workflow_runs
  ADD COLUMN workflow_binding_snapshot_id UUID,
  ADD CONSTRAINT workflow_runs_binding_snapshot_company_fkey
    FOREIGN KEY (workflow_binding_snapshot_id, company_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id) ON DELETE RESTRICT;

CREATE TABLE public.workflow_resume_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL,
  binding_snapshot_id UUID,
  node_key TEXT NOT NULL CHECK (node_key ~ '^[a-z0-9][a-z0-9._-]{1,149}$'),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('resume_after_approval', 'retry_node', 'continue_run')),
  checkpoint JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(checkpoint) = 'object'),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key TEXT NOT NULL CHECK (dedupe_key ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, dedupe_key),
  FOREIGN KEY (workflow_run_id, company_id)
    REFERENCES public.workflow_runs(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (binding_snapshot_id, company_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX company_connector_installations_company_status_idx
  ON public.company_connector_installations(company_id, status, updated_at DESC);
CREATE INDEX company_connector_grants_company_status_idx
  ON public.company_connector_capability_grants(company_id, status, granted_at DESC);
CREATE INDEX workflow_bindings_snapshot_idx
  ON public.workflow_capability_bindings(binding_snapshot_id, requirement_key);
CREATE INDEX workflow_activation_events_company_idx
  ON public.workflow_activation_events(company_id, created_at DESC);
CREATE INDEX workflow_resume_outbox_ready_idx
  ON public.workflow_resume_outbox(status, available_at)
  WHERE status IN ('pending', 'failed');

CREATE TRIGGER company_connector_installations_touch
BEFORE UPDATE ON public.company_connector_installations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER company_capability_policies_touch
BEFORE UPDATE ON public.company_capability_policies
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER workflow_resume_outbox_touch
BEFORE UPDATE ON public.workflow_resume_outbox
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Catalog rows are globally readable metadata but remain platform-owned.
-- Company-scoped rows use the same membership boundary as existing workflow
-- records and are writable only through checked functions below.
ALTER TABLE public.connector_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_field_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_capability_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_connector_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_connector_capability_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_connector_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_capability_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_binding_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_capability_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_binding_snapshot_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_activation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_resume_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY connector_definitions_authenticated_select
  ON public.connector_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY connector_definition_versions_authenticated_select
  ON public.connector_definition_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY capability_definitions_authenticated_select
  ON public.capability_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY capability_definition_versions_authenticated_select
  ON public.capability_definition_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY capability_field_classifications_authenticated_select
  ON public.capability_field_classifications FOR SELECT TO authenticated USING (true);
CREATE POLICY connector_capability_offerings_authenticated_select
  ON public.connector_capability_offerings FOR SELECT TO authenticated USING (true);

CREATE POLICY company_connector_installations_member_select
  ON public.company_connector_installations FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY company_connector_grants_member_select
  ON public.company_connector_capability_grants FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY company_connector_health_member_select
  ON public.company_connector_health FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY company_capability_policies_member_select
  ON public.company_capability_policies FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY workflow_binding_snapshots_member_select
  ON public.workflow_binding_snapshots FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY workflow_capability_bindings_member_select
  ON public.workflow_capability_bindings FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY workflow_binding_snapshot_events_member_select
  ON public.workflow_binding_snapshot_events FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY workflow_activations_member_select
  ON public.workflow_activations FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY workflow_activation_events_member_select
  ON public.workflow_activation_events FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
-- Resume checkpoints and payloads are runtime-internal and may contain fields
-- that are not approved for terminal display. No Data API policy is created.

REVOKE ALL ON TABLE
  public.connector_definitions,
  public.connector_definition_versions,
  public.capability_definitions,
  public.capability_definition_versions,
  public.capability_field_classifications,
  public.connector_capability_offerings,
  public.company_connector_installations,
  public.company_connector_capability_grants,
  public.company_connector_health,
  public.company_capability_policies,
  public.workflow_binding_snapshots,
  public.workflow_capability_bindings,
  public.workflow_binding_snapshot_events,
  public.workflow_activations,
  public.workflow_activation_events,
  public.workflow_resume_outbox
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.connector_definitions,
  public.connector_definition_versions,
  public.capability_definitions,
  public.capability_definition_versions,
  public.capability_field_classifications,
  public.connector_capability_offerings,
  public.company_connector_installations,
  public.company_connector_capability_grants,
  public.company_connector_health,
  public.company_capability_policies,
  public.workflow_binding_snapshots,
  public.workflow_capability_bindings,
  public.workflow_binding_snapshot_events,
  public.workflow_activations,
  public.workflow_activation_events
TO authenticated;

-- Workspace approval policy changes now go through an audited checked RPC.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.company_approval_policies
  FROM authenticated;

-- Seed only non-secret synthetic commerce catalog definitions. Stable IDs keep
-- skill compilation deterministic across local resets and test environments.
INSERT INTO public.connector_definitions (
  id, connector_key, display_name, description, status
)
VALUES (
  '60000000-0000-0000-0000-000000000001',
  'mandala.synthetic-commerce',
  'Mandala Synthetic Commerce',
  'Credential-free synthetic catalog, inventory, sales, vendor, and mock procurement capabilities.',
  'active'
);

WITH connector_manifest AS (
  SELECT '{"kind":"synthetic","credentialMode":"none","business":"Mandala Bean Co.","datasetVersion":"1"}'::JSONB AS value
)
INSERT INTO public.connector_definition_versions (
  id,
  connector_definition_id,
  version,
  manifest,
  manifest_hash,
  schema_hash,
  status
)
SELECT
  '60000000-0000-0000-0000-000000000101',
  '60000000-0000-0000-0000-000000000001',
  '1.0.0',
  value,
  encode(extensions.digest(convert_to(value::TEXT, 'UTF8'), 'sha256'), 'hex'),
  encode(extensions.digest(convert_to('mandala.synthetic-commerce:1.0.0', 'UTF8'), 'sha256'), 'hex'),
  'active'
FROM connector_manifest;

INSERT INTO public.capability_definitions (
  id, capability_key, display_name, description, effect, risk_class, status
)
VALUES
  ('61000000-0000-0000-0000-000000000001', 'commerce.catalog.read', 'Read product catalog', 'Read synthetic product identities and merchandising attributes.', 'read', 'read', 'active'),
  ('61000000-0000-0000-0000-000000000002', 'commerce.inventory.read', 'Read inventory', 'Read synthetic on-hand, inbound, reorder, freshness, and duplicate-order signals.', 'read', 'read', 'active'),
  ('61000000-0000-0000-0000-000000000003', 'commerce.sales.read', 'Read sales history', 'Read synthetic sales velocity and daily sales observations.', 'read', 'read', 'active'),
  ('61000000-0000-0000-0000-000000000004', 'procurement.open-orders.read', 'Read open purchase orders', 'Read synthetic open-order coverage used for duplicate suppression.', 'read', 'read', 'active'),
  ('61000000-0000-0000-0000-000000000005', 'procurement.vendor-terms.read', 'Read vendor terms', 'Read synthetic lead time, pack size, and minimum-order terms.', 'read', 'read', 'active'),
  ('61000000-0000-0000-0000-000000000006', 'procurement.purchase-order.mock-execute', 'Execute mock purchase order', 'Record a credential-free mock purchase-order attempt after approval.', 'write', 'mock_execution', 'active'),
  ('61000000-0000-0000-0000-000000000007', 'commerce.events.read', 'Read business events', 'Read synthetic promotions, adjustments, delays, and other demand context.', 'read', 'read', 'active'),
  ('61000000-0000-0000-0000-000000000008', 'procurement.purchase-order.create-draft', 'Create purchase-order draft', 'Create a reviewable mock purchase-order draft without an external write.', 'propose', 'state_change', 'active');

WITH capability_versions(
  id, definition_id, input_schema, output_schema, schema_seed
) AS (
  VALUES
    ('61000000-0000-0000-0000-000000000101'::UUID, '61000000-0000-0000-0000-000000000001'::UUID,
      '{"type":"object","properties":{"limit":{"type":"integer"}},"additionalProperties":false}'::JSONB,
      '{"type":"object","properties":{"sku":{"type":"string"},"title":{"type":"string"},"category":{"type":"string"},"vendor":{"type":"string"}},"required":["sku","title"]}'::JSONB,
      'commerce.catalog.read:1.0.0'),
    ('61000000-0000-0000-0000-000000000102', '61000000-0000-0000-0000-000000000002',
      '{"type":"object","properties":{"sku":{"type":"string"}},"additionalProperties":false}'::JSONB,
      '{"type":"object","properties":{"sku":{"type":"string"},"onHand":{"type":"integer"},"inbound":{"type":"integer"},"reorderPoint":{"type":"integer"},"freshnessHours":{"type":"number"},"duplicateOpenOrderUnits":{"type":"integer"}},"required":["sku","onHand","reorderPoint"]}'::JSONB,
      'commerce.inventory.read:1.0.0'),
    ('61000000-0000-0000-0000-000000000103', '61000000-0000-0000-0000-000000000003',
      '{"type":"object","properties":{"sku":{"type":"string"},"days":{"type":"integer"}},"additionalProperties":false}'::JSONB,
      '{"type":"object","properties":{"sku":{"type":"string"},"recent30DaySales":{"type":"integer"},"trailing90DaySales":{"type":"integer"},"dailySales":{"type":"array"},"spikeMultiplier":{"type":"number"}},"required":["sku","recent30DaySales"]}'::JSONB,
      'commerce.sales.read:1.0.0'),
    ('61000000-0000-0000-0000-000000000104', '61000000-0000-0000-0000-000000000004',
      '{"type":"object","properties":{"sku":{"type":"string"}},"additionalProperties":false}'::JSONB,
      '{"type":"object","properties":{"sku":{"type":"string"},"openUnits":{"type":"integer"}},"required":["sku","openUnits"]}'::JSONB,
      'procurement.open-orders.read:1.0.0'),
    ('61000000-0000-0000-0000-000000000105', '61000000-0000-0000-0000-000000000005',
      '{"type":"object","properties":{"sku":{"type":"string"}},"additionalProperties":false}'::JSONB,
      '{"type":"object","properties":{"sku":{"type":"string"},"vendor":{"type":"string"},"leadTimeDays":{"type":"integer"},"packSize":{"type":"integer"},"minimumOrderQuantity":{"type":"integer"}},"required":["sku","leadTimeDays","packSize"]}'::JSONB,
      'procurement.vendor-terms.read:1.0.0'),
    ('61000000-0000-0000-0000-000000000106', '61000000-0000-0000-0000-000000000006',
      '{"type":"object","properties":{"draftId":{"type":"string"},"payloadHash":{"type":"string"},"idempotencyKey":{"type":"string"}},"required":["draftId","payloadHash","idempotencyKey"],"additionalProperties":false}'::JSONB,
      '{"type":"object","properties":{"mockExternalId":{"type":"string"},"committed":{"const":false}},"required":["mockExternalId","committed"]}'::JSONB,
      'procurement.purchase-order.mock-execute:1.0.0'),
    ('61000000-0000-0000-0000-000000000107', '61000000-0000-0000-0000-000000000007',
      '{"type":"object","properties":{"sku":{"type":"string"},"limit":{"type":"integer"}},"additionalProperties":false}'::JSONB,
      '{"type":"object","properties":{"id":{"type":"string"},"sku":{"type":"string"},"type":{"type":"string"},"occurredAt":{"type":"string"},"description":{"type":"string"}},"required":["id","type","occurredAt"]}'::JSONB,
      'commerce.events.read:1.0.0'),
    ('61000000-0000-0000-0000-000000000108', '61000000-0000-0000-0000-000000000008',
      '{"type":"object","properties":{"vendor":{"type":"string"},"lines":{"type":"array"},"mode":{"const":"mock"}},"required":["vendor","lines","mode"],"additionalProperties":false}'::JSONB,
      '{"type":"object","properties":{"draftId":{"type":"string"},"status":{"const":"pending_review"}},"required":["draftId","status"]}'::JSONB,
      'procurement.purchase-order.create-draft:1.0.0')
)
INSERT INTO public.capability_definition_versions (
  id, capability_definition_id, version, input_schema, output_schema, schema_hash, status
)
SELECT
  id,
  definition_id,
  '1.0.0',
  input_schema,
  output_schema,
  encode(extensions.digest(convert_to(schema_seed, 'UTF8'), 'sha256'), 'hex'),
  'active'
FROM capability_versions;

INSERT INTO public.capability_field_classifications (
  capability_version_id, json_pointer, classification, model_allowed, terminal_allowed
)
VALUES
  ('61000000-0000-0000-0000-000000000101', '/sku', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000101', '/title', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000101', '/category', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000101', '/vendor', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000102', '/sku', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000102', '/onHand', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000102', '/inbound', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000102', '/reorderPoint', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000102', '/freshnessHours', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000102', '/duplicateOpenOrderUnits', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000103', '/sku', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000103', '/recent30DaySales', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000103', '/trailing90DaySales', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000103', '/dailySales', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000103', '/spikeMultiplier', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000104', '/sku', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000104', '/openUnits', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000105', '/sku', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000105', '/vendor', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000105', '/leadTimeDays', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000105', '/packSize', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000105', '/minimumOrderQuantity', 'confidential', true, true),
  ('61000000-0000-0000-0000-000000000106', '/mockExternalId', 'internal', false, true),
  ('61000000-0000-0000-0000-000000000106', '/committed', 'internal', false, true),
  ('61000000-0000-0000-0000-000000000107', '/id', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000107', '/sku', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000107', '/type', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000107', '/occurredAt', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000107', '/description', 'internal', true, true),
  ('61000000-0000-0000-0000-000000000108', '/draftId', 'internal', false, true),
  ('61000000-0000-0000-0000-000000000108', '/status', 'internal', false, true);

INSERT INTO public.connector_capability_offerings (
  connector_version_id, capability_version_id, provider_operation
)
SELECT
  '60000000-0000-0000-0000-000000000101',
  capability_version_id,
  provider_operation
FROM (
  VALUES
    ('61000000-0000-0000-0000-000000000101'::UUID, 'read_catalog'),
    ('61000000-0000-0000-0000-000000000102', 'read_inventory'),
    ('61000000-0000-0000-0000-000000000103', 'read_sales'),
    ('61000000-0000-0000-0000-000000000104', 'read_open_orders'),
    ('61000000-0000-0000-0000-000000000105', 'read_vendor_terms'),
    ('61000000-0000-0000-0000-000000000106', 'execute_mock_purchase_order'),
    ('61000000-0000-0000-0000-000000000107', 'read_business_events'),
    ('61000000-0000-0000-0000-000000000108', 'create_mock_purchase_order_draft')
) offerings(capability_version_id, provider_operation);

CREATE FUNCTION workflow_private.record_company_security_audit(
  p_company_id UUID,
  p_event_type TEXT,
  p_summary TEXT,
  p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
BEGIN
  IF current_user_id IS NULL
    OR p_event_type IS NULL
    OR p_event_type !~ '^[a-z0-9][a-z0-9_]{1,99}$'
    OR length(p_summary) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_security_audit' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.workflow_audit_events (
    id,
    company_id,
    actor_type,
    actor_id,
    workflow_run_id,
    workflow_item_id,
    event_type,
    summary,
    payload,
    trace
  )
  VALUES (
    gen_random_uuid(),
    p_company_id,
    'user',
    current_user_id,
    NULL,
    NULL,
    p_event_type,
    p_summary,
    p_payload,
    '{}'::JSONB
  );
END;
$$;

CREATE FUNCTION workflow_private.reject_immutable_workflow_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'immutable_workflow_record' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workflow_binding_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.workflow_binding_snapshots
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_record();

CREATE TRIGGER workflow_capability_bindings_immutable
BEFORE UPDATE OR DELETE ON public.workflow_capability_bindings
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_record();

CREATE TRIGGER workflow_binding_snapshot_events_immutable
BEFORE UPDATE OR DELETE ON public.workflow_binding_snapshot_events
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_record();

CREATE TRIGGER workflow_activation_events_immutable
BEFORE UPDATE OR DELETE ON public.workflow_activation_events
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_record();

CREATE FUNCTION workflow_private.reject_activated_workflow_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.workflow_activation_events event
    WHERE event.workflow_id = OLD.id
      AND event.company_id = OLD.company_id
      AND event.event_type IN ('activated', 'rolled_back')
  ) THEN
    RAISE EXCEPTION 'activated_workflow_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER agent_workflows_activated_immutable
BEFORE UPDATE OR DELETE ON public.agent_workflows
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_activated_workflow_mutation();

-- Preserve the sanitized compatibility view without relying on a
-- security-definer view. The view executes as the caller and delegates to a
-- checked function that returns no raw input hash.
CREATE FUNCTION public.list_workflow_control_request_audit()
RETURNS TABLE (
  id UUID,
  company_id UUID,
  actor_id UUID,
  client_surface TEXT,
  normalized_intent JSONB,
  parser_kind TEXT,
  resolution_status TEXT,
  risk_class TEXT,
  workflow_run_id UUID,
  workflow_item_id UUID,
  langsmith_trace_id TEXT,
  langsmith_run_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    request.id,
    request.company_id,
    request.actor_id,
    request.client_surface,
    request.normalized_intent,
    request.parser_kind,
    request.resolution_status,
    request.risk_class,
    request.workflow_run_id,
    request.workflow_item_id,
    request.langsmith_trace_id,
    request.langsmith_run_id,
    request.created_at,
    request.updated_at
  FROM public.workflow_control_requests request
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.company_memberships membership
      WHERE membership.company_id = request.company_id
        AND membership.user_id = (SELECT auth.uid())
        AND membership.status = 'active'
        AND public.company_role_rank(membership.role)
          >= public.company_role_rank('viewer')
    )
$$;

CREATE OR REPLACE VIEW public.workflow_control_request_audit
WITH (security_barrier = true, security_invoker = true)
AS
SELECT * FROM public.list_workflow_control_request_audit();

REVOKE ALL ON FUNCTION public.list_workflow_control_request_audit()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_workflow_control_request_audit()
  TO authenticated;
REVOKE ALL ON TABLE public.workflow_control_request_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workflow_control_request_audit TO authenticated;

CREATE FUNCTION public.configure_company_connector_installation(
  p_company_id UUID,
  p_connector_version_id UUID,
  p_display_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_connector_definition_id UUID;
  target_installation_id UUID;
  previous_connector_version_id UUID;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  IF length(trim(COALESCE(p_display_name, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_connector_display_name' USING ERRCODE = '22023';
  END IF;

  SELECT version.connector_definition_id
  INTO target_connector_definition_id
  FROM public.connector_definition_versions version
  JOIN public.connector_definitions definition
    ON definition.id = version.connector_definition_id
  WHERE version.id = p_connector_version_id
    AND version.status = 'active'
    AND definition.status = 'active';

  IF target_connector_definition_id IS NULL THEN
    RAISE EXCEPTION 'connector_version_not_available' USING ERRCODE = '22023';
  END IF;

  SELECT installation.id, installation.connector_version_id
  INTO target_installation_id, previous_connector_version_id
  FROM public.company_connector_installations installation
  WHERE installation.company_id = p_company_id
    AND installation.connector_definition_id = target_connector_definition_id
  FOR UPDATE;

  INSERT INTO public.company_connector_installations (
    company_id,
    connector_definition_id,
    connector_version_id,
    display_name,
    status,
    installed_by
  )
  VALUES (
    p_company_id,
    target_connector_definition_id,
    p_connector_version_id,
    trim(p_display_name),
    'connected',
    current_user_id
  )
  ON CONFLICT (company_id, connector_definition_id)
  DO UPDATE SET
    connector_version_id = EXCLUDED.connector_version_id,
    display_name = EXCLUDED.display_name,
    status = 'connected'
  RETURNING id INTO target_installation_id;

  INSERT INTO public.company_connector_health (
    installation_id,
    company_id,
    status,
    observed_schema_hash,
    details
  )
  VALUES (target_installation_id, p_company_id, 'unknown', NULL, '{}'::JSONB)
  ON CONFLICT (installation_id, company_id)
  DO UPDATE SET
    status = 'unknown',
    observed_schema_hash = NULL,
    checked_at = now(),
    details = '{}'::JSONB;

  IF previous_connector_version_id IS NOT NULL
    AND previous_connector_version_id IS DISTINCT FROM p_connector_version_id
  THEN
    INSERT INTO public.workflow_binding_snapshot_events (
      company_id,
      binding_snapshot_id,
      event_type,
      reason,
      actor_id
    )
    SELECT DISTINCT
      binding.company_id,
      binding.binding_snapshot_id,
      'invalidated',
      'The connector definition version changed.',
      current_user_id
    FROM public.workflow_capability_bindings binding
    JOIN public.company_connector_capability_grants grant_record
      ON grant_record.id = binding.grant_id
     AND grant_record.company_id = binding.company_id
    WHERE binding.company_id = p_company_id
      AND grant_record.installation_id = target_installation_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.workflow_binding_snapshot_events existing_event
        WHERE existing_event.company_id = binding.company_id
          AND existing_event.binding_snapshot_id = binding.binding_snapshot_id
          AND existing_event.event_type = 'invalidated'
      );
  END IF;

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'connector_installation_configured',
    'Connector installation configured.',
    jsonb_build_object(
      'installationId', target_installation_id,
      'connectorVersionId', p_connector_version_id
    )
  );

  RETURN jsonb_build_object(
    'installationId', target_installation_id,
    'status', 'connected',
    'health', 'unknown'
  );
END;
$$;

CREATE FUNCTION public.set_company_connector_capability_grant(
  p_company_id UUID,
  p_installation_id UUID,
  p_capability_version_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_grant_id UUID;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  IF p_status NOT IN ('active', 'revoked') THEN
    RAISE EXCEPTION 'invalid_grant_status' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_connector_installations installation
    JOIN public.connector_capability_offerings offering
      ON offering.connector_version_id = installation.connector_version_id
     AND offering.capability_version_id = p_capability_version_id
    JOIN public.capability_definition_versions version
      ON version.id = offering.capability_version_id
    JOIN public.capability_definitions definition
      ON definition.id = version.capability_definition_id
    WHERE installation.id = p_installation_id
      AND installation.company_id = p_company_id
      AND (
        p_status = 'revoked'
        OR (
          installation.status = 'connected'
          AND version.status = 'active'
          AND definition.status = 'active'
        )
      )
  ) THEN
    RAISE EXCEPTION 'capability_not_offered_by_installation' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.company_connector_capability_grants (
    company_id,
    installation_id,
    capability_version_id,
    status,
    granted_by,
    granted_at,
    revoked_by,
    revoked_at
  )
  VALUES (
    p_company_id,
    p_installation_id,
    p_capability_version_id,
    p_status,
    current_user_id,
    now(),
    CASE WHEN p_status = 'revoked' THEN current_user_id ELSE NULL END,
    CASE WHEN p_status = 'revoked' THEN now() ELSE NULL END
  )
  ON CONFLICT (company_id, installation_id, capability_version_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    granted_by = EXCLUDED.granted_by,
    granted_at = EXCLUDED.granted_at,
    revoked_by = EXCLUDED.revoked_by,
    revoked_at = EXCLUDED.revoked_at
  RETURNING id INTO target_grant_id;

  IF p_status = 'revoked' THEN
    INSERT INTO public.workflow_binding_snapshot_events (
      company_id,
      binding_snapshot_id,
      event_type,
      reason,
      actor_id
    )
    SELECT DISTINCT
      binding.company_id,
      binding.binding_snapshot_id,
      'invalidated',
      'A required connector capability grant was revoked.',
      current_user_id
    FROM public.workflow_capability_bindings binding
    WHERE binding.company_id = p_company_id
      AND binding.grant_id = target_grant_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.workflow_binding_snapshot_events existing_event
        WHERE existing_event.company_id = binding.company_id
          AND existing_event.binding_snapshot_id = binding.binding_snapshot_id
          AND existing_event.event_type = 'invalidated'
      );
  END IF;

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'connector_capability_grant_changed',
    'Connector capability grant changed.',
    jsonb_build_object(
      'grantId', target_grant_id,
      'installationId', p_installation_id,
      'capabilityVersionId', p_capability_version_id,
      'status', p_status
    )
  );

  RETURN jsonb_build_object('grantId', target_grant_id, 'status', p_status);
END;
$$;

CREATE FUNCTION public.set_company_connector_health(
  p_company_id UUID,
  p_installation_id UUID,
  p_status TEXT,
  p_observed_schema_hash TEXT DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  expected_schema_hash TEXT;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  IF p_status NOT IN ('healthy', 'degraded', 'unavailable', 'unknown') THEN
    RAISE EXCEPTION 'invalid_connector_health_status' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_details, 'null'::JSONB)) <> 'object'
    OR p_details - ARRAY['message', 'latencyMs', 'providerStatus', 'schemaVersion'] <> '{}'::JSONB
    OR pg_column_size(p_details) > 4096
  THEN
    RAISE EXCEPTION 'invalid_connector_health_details' USING ERRCODE = '22023';
  END IF;

  SELECT version.schema_hash
  INTO expected_schema_hash
  FROM public.company_connector_installations installation
  JOIN public.connector_definition_versions version
    ON version.id = installation.connector_version_id
  WHERE installation.id = p_installation_id
    AND installation.company_id = p_company_id;

  IF expected_schema_hash IS NULL THEN
    RAISE EXCEPTION 'connector_installation_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.company_connector_health (
    installation_id,
    company_id,
    status,
    observed_schema_hash,
    checked_at,
    details
  )
  VALUES (
    p_installation_id,
    p_company_id,
    p_status,
    p_observed_schema_hash,
    now(),
    p_details
  )
  ON CONFLICT (installation_id, company_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    observed_schema_hash = EXCLUDED.observed_schema_hash,
    checked_at = EXCLUDED.checked_at,
    details = EXCLUDED.details;

  IF p_status <> 'healthy'
    OR p_observed_schema_hash IS DISTINCT FROM expected_schema_hash
  THEN
    INSERT INTO public.workflow_binding_snapshot_events (
      company_id,
      binding_snapshot_id,
      event_type,
      reason,
      actor_id
    )
    SELECT DISTINCT
      binding.company_id,
      binding.binding_snapshot_id,
      'invalidated',
      'Connector health or schema compatibility changed.',
      current_user_id
    FROM public.workflow_capability_bindings binding
    JOIN public.company_connector_capability_grants grant_record
      ON grant_record.id = binding.grant_id
     AND grant_record.company_id = binding.company_id
    WHERE binding.company_id = p_company_id
      AND grant_record.installation_id = p_installation_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.workflow_binding_snapshot_events existing_event
        WHERE existing_event.company_id = binding.company_id
          AND existing_event.binding_snapshot_id = binding.binding_snapshot_id
          AND existing_event.event_type = 'invalidated'
      );
  END IF;

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'connector_health_recorded',
    'Connector health recorded.',
    jsonb_build_object(
      'installationId', p_installation_id,
      'status', p_status,
      'schemaMatched', p_observed_schema_hash = expected_schema_hash
    )
  );

  RETURN jsonb_build_object(
    'installationId', p_installation_id,
    'status', p_status,
    'schemaMatched', p_observed_schema_hash = expected_schema_hash
  );
END;
$$;

CREATE FUNCTION public.set_company_capability_policy(
  p_company_id UUID,
  p_capability_version_id UUID,
  p_enabled BOOLEAN,
  p_minimum_role TEXT DEFAULT 'member',
  p_allow_model_processing BOOLEAN DEFAULT false,
  p_require_human_approval BOOLEAN DEFAULT true,
  p_max_rows INTEGER DEFAULT 100,
  p_max_bytes INTEGER DEFAULT 262144
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_effect TEXT;
  target_policy_id UUID;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  SELECT definition.effect
  INTO target_effect
  FROM public.capability_definition_versions version
  JOIN public.capability_definitions definition
    ON definition.id = version.capability_definition_id
  WHERE version.id = p_capability_version_id
    AND version.status = 'active'
    AND definition.status = 'active';

  IF target_effect IS NULL THEN
    RAISE EXCEPTION 'capability_version_not_available' USING ERRCODE = '22023';
  END IF;
  IF p_minimum_role NOT IN ('owner', 'admin', 'approver', 'member', 'viewer')
    OR p_max_rows NOT BETWEEN 1 AND 10000
    OR p_max_bytes NOT BETWEEN 1024 AND 10485760
  THEN
    RAISE EXCEPTION 'invalid_capability_policy' USING ERRCODE = '22023';
  END IF;
  IF target_effect <> 'read' AND NOT p_require_human_approval THEN
    RAISE EXCEPTION 'human_approval_required_for_mutation' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.company_capability_policies (
    company_id,
    capability_version_id,
    enabled,
    minimum_role,
    allow_model_processing,
    require_human_approval,
    max_rows,
    max_bytes,
    updated_by
  )
  VALUES (
    p_company_id,
    p_capability_version_id,
    p_enabled,
    p_minimum_role,
    p_allow_model_processing,
    p_require_human_approval,
    p_max_rows,
    p_max_bytes,
    current_user_id
  )
  ON CONFLICT (company_id, capability_version_id)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    minimum_role = EXCLUDED.minimum_role,
    allow_model_processing = EXCLUDED.allow_model_processing,
    require_human_approval = EXCLUDED.require_human_approval,
    max_rows = EXCLUDED.max_rows,
    max_bytes = EXCLUDED.max_bytes,
    updated_by = EXCLUDED.updated_by
  RETURNING id INTO target_policy_id;

  -- Policy changes never silently broaden or narrow an already frozen
  -- activation. A new snapshot and explicit activation are required.
  INSERT INTO public.workflow_binding_snapshot_events (
    company_id,
    binding_snapshot_id,
    event_type,
    reason,
    actor_id
  )
  SELECT DISTINCT
    binding.company_id,
    binding.binding_snapshot_id,
    'invalidated',
    'The company capability policy changed.',
    current_user_id
  FROM public.workflow_capability_bindings binding
  WHERE binding.company_id = p_company_id
    AND binding.capability_version_id = p_capability_version_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.workflow_binding_snapshot_events existing_event
      WHERE existing_event.company_id = binding.company_id
        AND existing_event.binding_snapshot_id = binding.binding_snapshot_id
        AND existing_event.event_type = 'invalidated'
    );

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'capability_policy_changed',
    'Company capability policy changed.',
    jsonb_build_object(
      'policyId', target_policy_id,
      'capabilityVersionId', p_capability_version_id,
      'enabled', p_enabled,
      'minimumRole', p_minimum_role,
      'allowModelProcessing', p_allow_model_processing,
      'requireHumanApproval', p_require_human_approval,
      'maxRows', p_max_rows,
      'maxBytes', p_max_bytes
    )
  );

  RETURN jsonb_build_object('policyId', target_policy_id, 'enabled', p_enabled);
END;
$$;

CREATE FUNCTION public.set_company_approval_policy_controlled(
  p_company_id UUID,
  p_workflow_type TEXT,
  p_action_type TEXT,
  p_minimum_role TEXT DEFAULT 'approver',
  p_require_human_approval BOOLEAN DEFAULT true,
  p_require_warning_acknowledgement BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_policy_id UUID;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  IF length(trim(COALESCE(p_workflow_type, ''))) NOT BETWEEN 1 AND 150
    OR length(trim(COALESCE(p_action_type, ''))) NOT BETWEEN 1 AND 150
    OR p_minimum_role NOT IN ('owner', 'admin', 'approver')
  THEN
    RAISE EXCEPTION 'invalid_approval_policy' USING ERRCODE = '22023';
  END IF;
  IF NOT p_require_human_approval THEN
    RAISE EXCEPTION 'human_approval_required_for_mutation' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.company_approval_policies (
    company_id,
    workflow_type,
    action_type,
    minimum_role,
    require_human_approval,
    require_warning_acknowledgement
  )
  VALUES (
    p_company_id,
    trim(p_workflow_type),
    trim(p_action_type),
    p_minimum_role,
    p_require_human_approval,
    p_require_warning_acknowledgement
  )
  ON CONFLICT (company_id, workflow_type, action_type)
  DO UPDATE SET
    minimum_role = EXCLUDED.minimum_role,
    require_human_approval = EXCLUDED.require_human_approval,
    require_warning_acknowledgement = EXCLUDED.require_warning_acknowledgement
  RETURNING id INTO target_policy_id;

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'approval_policy_changed',
    'Company approval policy changed.',
    jsonb_build_object(
      'policyId', target_policy_id,
      'workflowType', trim(p_workflow_type),
      'actionType', trim(p_action_type),
      'minimumRole', p_minimum_role,
      'requireHumanApproval', p_require_human_approval,
      'requireWarningAcknowledgement', p_require_warning_acknowledgement
    )
  );

  RETURN jsonb_build_object('policyId', target_policy_id);
END;
$$;

CREATE FUNCTION public.create_workflow_binding_snapshot(
  p_company_id UUID,
  p_workflow_id UUID,
  p_bindings JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_workflow public.agent_workflows%ROWTYPE;
  target_snapshot_id UUID;
  target_binding JSONB;
  target_requirement_key TEXT;
  target_grant_id UUID;
  target_capability_version_id UUID;
  canonical_bindings JSONB := '[]'::JSONB;
  target_grant_digest TEXT;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  SELECT workflow.*
  INTO target_workflow
  FROM public.agent_workflows workflow
  WHERE workflow.id = p_workflow_id
    AND workflow.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF target_workflow.skill_source_hash IS NULL
    OR target_workflow.compiled_manifest_hash IS NULL
    OR target_workflow.compiled_at IS NULL
    OR COALESCE((target_workflow.compile_result ->> 'ok')::BOOLEAN, false) IS NOT true
  THEN
    RAISE EXCEPTION 'workflow_not_successfully_compiled' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_bindings, 'null'::JSONB)) <> 'array'
    OR jsonb_array_length(p_bindings) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'invalid_workflow_bindings' USING ERRCODE = '22023';
  END IF;

  FOR target_binding IN SELECT value FROM jsonb_array_elements(p_bindings)
  LOOP
    IF jsonb_typeof(target_binding) <> 'object'
      OR target_binding - ARRAY['requirementKey', 'grantId'] <> '{}'::JSONB
      OR NOT (target_binding ? 'requirementKey' AND target_binding ? 'grantId')
    THEN
      RAISE EXCEPTION 'invalid_workflow_binding_shape' USING ERRCODE = '22023';
    END IF;

    target_requirement_key := target_binding ->> 'requirementKey';
    BEGIN
      target_grant_id := (target_binding ->> 'grantId')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_workflow_binding_grant_id' USING ERRCODE = '22023';
    END;

    IF target_requirement_key IS NULL
      OR target_requirement_key !~ '^[a-z0-9][a-z0-9._-]{1,149}$'
    THEN
      RAISE EXCEPTION 'invalid_workflow_binding_requirement' USING ERRCODE = '22023';
    END IF;

    SELECT grant_record.capability_version_id
    INTO target_capability_version_id
    FROM public.company_connector_capability_grants grant_record
    JOIN public.company_connector_installations installation
      ON installation.id = grant_record.installation_id
     AND installation.company_id = grant_record.company_id
    JOIN public.connector_capability_offerings offering
      ON offering.connector_version_id = installation.connector_version_id
     AND offering.capability_version_id = grant_record.capability_version_id
    JOIN public.company_capability_policies policy
      ON policy.company_id = grant_record.company_id
     AND policy.capability_version_id = grant_record.capability_version_id
    WHERE grant_record.id = target_grant_id
      AND grant_record.company_id = p_company_id
      AND grant_record.status = 'active'
      AND installation.status = 'connected'
      AND policy.enabled;

    IF target_capability_version_id IS NULL THEN
      RAISE EXCEPTION 'workflow_binding_not_authorized' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(canonical_bindings) existing_binding
      WHERE existing_binding ->> 'requirementKey' = target_requirement_key
    ) THEN
      RAISE EXCEPTION 'duplicate_workflow_binding_requirement' USING ERRCODE = '22023';
    END IF;

    canonical_bindings := canonical_bindings || jsonb_build_array(
      jsonb_build_object(
        'requirementKey', target_requirement_key,
        'grantId', target_grant_id,
        'capabilityVersionId', target_capability_version_id
      )
    );
  END LOOP;

  SELECT jsonb_agg(binding ORDER BY binding ->> 'requirementKey')
  INTO canonical_bindings
  FROM jsonb_array_elements(canonical_bindings) binding;

  target_grant_digest := encode(
    extensions.digest(convert_to(canonical_bindings::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.workflow_binding_snapshots (
    company_id,
    workflow_id,
    manifest_hash,
    grant_digest,
    created_by
  )
  VALUES (
    p_company_id,
    p_workflow_id,
    target_workflow.compiled_manifest_hash,
    target_grant_digest,
    current_user_id
  )
  RETURNING id INTO target_snapshot_id;

  INSERT INTO public.workflow_capability_bindings (
    company_id,
    binding_snapshot_id,
    requirement_key,
    grant_id,
    capability_version_id
  )
  SELECT
    p_company_id,
    target_snapshot_id,
    binding ->> 'requirementKey',
    (binding ->> 'grantId')::UUID,
    (binding ->> 'capabilityVersionId')::UUID
  FROM jsonb_array_elements(canonical_bindings) binding;

  INSERT INTO public.workflow_binding_snapshot_events (
    company_id,
    binding_snapshot_id,
    event_type,
    reason,
    actor_id
  )
  VALUES (
    p_company_id,
    target_snapshot_id,
    'created',
    'Workflow capability bindings were resolved and frozen.',
    current_user_id
  );

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'workflow_binding_snapshot_created',
    'Workflow binding snapshot created.',
    jsonb_build_object(
      'workflowId', p_workflow_id,
      'bindingSnapshotId', target_snapshot_id,
      'manifestHash', target_workflow.compiled_manifest_hash,
      'grantDigest', target_grant_digest
    )
  );

  RETURN jsonb_build_object(
    'bindingSnapshotId', target_snapshot_id,
    'workflowId', p_workflow_id,
    'manifestHash', target_workflow.compiled_manifest_hash,
    'grantDigest', target_grant_digest
  );
END;
$$;

CREATE FUNCTION workflow_private.transition_workflow_activation(
  p_company_id UUID,
  p_workflow_id UUID,
  p_binding_snapshot_id UUID,
  p_expected_current_workflow_id UUID,
  p_event_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_workflow public.agent_workflows%ROWTYPE;
  current_activation public.workflow_activations%ROWTYPE;
  next_sequence BIGINT;
  binding_count INTEGER;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  IF p_event_type NOT IN ('activated', 'rolled_back') THEN
    RAISE EXCEPTION 'invalid_activation_event_type' USING ERRCODE = '22023';
  END IF;

  SELECT workflow.*
  INTO target_workflow
  FROM public.agent_workflows workflow
  WHERE workflow.id = p_workflow_id
    AND workflow.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF target_workflow.skill_source_hash IS NULL
    OR target_workflow.compiled_manifest_hash IS NULL
    OR target_workflow.compiled_at IS NULL
    OR COALESCE((target_workflow.compile_result ->> 'ok')::BOOLEAN, false) IS NOT true
  THEN
    RAISE EXCEPTION 'workflow_not_successfully_compiled' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_company_id::TEXT || ':' || target_workflow.workflow_key, 0)
  );

  SELECT activation.*
  INTO current_activation
  FROM public.workflow_activations activation
  WHERE activation.company_id = p_company_id
    AND activation.workflow_key = target_workflow.workflow_key
  FOR UPDATE;

  IF current_activation.workflow_id IS DISTINCT FROM p_expected_current_workflow_id THEN
    RAISE EXCEPTION 'stale_workflow_activation' USING ERRCODE = '40001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workflow_binding_snapshots snapshot
    WHERE snapshot.id = p_binding_snapshot_id
      AND snapshot.company_id = p_company_id
      AND snapshot.workflow_id = p_workflow_id
      AND snapshot.manifest_hash = target_workflow.compiled_manifest_hash
  ) OR EXISTS (
    SELECT 1
    FROM public.workflow_binding_snapshot_events event
    WHERE event.company_id = p_company_id
      AND event.binding_snapshot_id = p_binding_snapshot_id
      AND event.event_type = 'invalidated'
  ) THEN
    RAISE EXCEPTION 'binding_snapshot_not_activatable' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)
  INTO binding_count
  FROM public.workflow_capability_bindings binding
  WHERE binding.company_id = p_company_id
    AND binding.binding_snapshot_id = p_binding_snapshot_id;

  IF binding_count = 0 OR EXISTS (
    SELECT 1
    FROM public.workflow_capability_bindings binding
    LEFT JOIN public.company_connector_capability_grants grant_record
      ON grant_record.id = binding.grant_id
     AND grant_record.company_id = binding.company_id
     AND grant_record.capability_version_id = binding.capability_version_id
    LEFT JOIN public.company_connector_installations installation
      ON installation.id = grant_record.installation_id
     AND installation.company_id = grant_record.company_id
    LEFT JOIN public.company_connector_health health
      ON health.installation_id = installation.id
     AND health.company_id = installation.company_id
    LEFT JOIN public.connector_definition_versions connector_version
      ON connector_version.id = installation.connector_version_id
    LEFT JOIN public.company_capability_policies policy
      ON policy.company_id = binding.company_id
     AND policy.capability_version_id = binding.capability_version_id
    WHERE binding.company_id = p_company_id
      AND binding.binding_snapshot_id = p_binding_snapshot_id
      AND (
        grant_record.id IS NULL
        OR grant_record.status <> 'active'
        OR installation.status <> 'connected'
        OR health.status <> 'healthy'
        OR health.observed_schema_hash IS DISTINCT FROM connector_version.schema_hash
        OR policy.enabled IS DISTINCT FROM true
      )
  ) THEN
    RAISE EXCEPTION 'workflow_capability_binding_unhealthy' USING ERRCODE = '55000';
  END IF;

  next_sequence := COALESCE(current_activation.activation_sequence, 0) + 1;

  INSERT INTO public.workflow_activations (
    company_id,
    workflow_key,
    workflow_id,
    binding_snapshot_id,
    activation_sequence,
    activated_by,
    activated_at
  )
  VALUES (
    p_company_id,
    target_workflow.workflow_key,
    p_workflow_id,
    p_binding_snapshot_id,
    next_sequence,
    current_user_id,
    now()
  )
  ON CONFLICT (company_id, workflow_key)
  DO UPDATE SET
    workflow_id = EXCLUDED.workflow_id,
    binding_snapshot_id = EXCLUDED.binding_snapshot_id,
    activation_sequence = EXCLUDED.activation_sequence,
    activated_by = EXCLUDED.activated_by,
    activated_at = EXCLUDED.activated_at;

  INSERT INTO public.workflow_activation_events (
    company_id,
    workflow_key,
    workflow_id,
    binding_snapshot_id,
    previous_workflow_id,
    event_type,
    actor_id
  )
  VALUES (
    p_company_id,
    target_workflow.workflow_key,
    p_workflow_id,
    p_binding_snapshot_id,
    current_activation.workflow_id,
    p_event_type,
    current_user_id
  );

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'workflow_' || p_event_type,
    CASE p_event_type
      WHEN 'rolled_back' THEN 'Workflow activation rolled back.'
      ELSE 'Workflow activated.'
    END,
    jsonb_build_object(
      'workflowKey', target_workflow.workflow_key,
      'workflowId', p_workflow_id,
      'bindingSnapshotId', p_binding_snapshot_id,
      'previousWorkflowId', current_activation.workflow_id,
      'activationSequence', next_sequence
    )
  );

  RETURN jsonb_build_object(
    'workflowKey', target_workflow.workflow_key,
    'workflowId', p_workflow_id,
    'bindingSnapshotId', p_binding_snapshot_id,
    'activationSequence', next_sequence,
    'eventType', p_event_type
  );
END;
$$;

CREATE FUNCTION public.activate_agent_workflow(
  p_company_id UUID,
  p_workflow_id UUID,
  p_binding_snapshot_id UUID,
  p_expected_current_workflow_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.transition_workflow_activation(
    p_company_id,
    p_workflow_id,
    p_binding_snapshot_id,
    p_expected_current_workflow_id,
    'activated'
  )
$$;

CREATE FUNCTION public.rollback_agent_workflow(
  p_company_id UUID,
  p_workflow_id UUID,
  p_binding_snapshot_id UUID,
  p_expected_current_workflow_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.transition_workflow_activation(
    p_company_id,
    p_workflow_id,
    p_binding_snapshot_id,
    p_expected_current_workflow_id,
    'rolled_back'
  )
$$;

CREATE FUNCTION public.deactivate_agent_workflow(
  p_company_id UUID,
  p_workflow_key TEXT,
  p_expected_current_workflow_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  current_activation public.workflow_activations%ROWTYPE;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_company_id::TEXT || ':' || p_workflow_key, 0)
  );

  SELECT activation.*
  INTO current_activation
  FROM public.workflow_activations activation
  WHERE activation.company_id = p_company_id
    AND activation.workflow_key = p_workflow_key
  FOR UPDATE;

  IF current_activation.workflow_id IS NULL THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE = 'P0002';
  END IF;
  IF current_activation.workflow_id IS DISTINCT FROM p_expected_current_workflow_id THEN
    RAISE EXCEPTION 'stale_workflow_activation' USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.workflow_activations activation
  WHERE activation.company_id = p_company_id
    AND activation.workflow_key = p_workflow_key;

  INSERT INTO public.workflow_activation_events (
    company_id,
    workflow_key,
    workflow_id,
    binding_snapshot_id,
    previous_workflow_id,
    event_type,
    actor_id
  )
  VALUES (
    p_company_id,
    p_workflow_key,
    current_activation.workflow_id,
    current_activation.binding_snapshot_id,
    current_activation.workflow_id,
    'deactivated',
    current_user_id
  );

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'workflow_deactivated',
    'Workflow deactivated.',
    jsonb_build_object(
      'workflowKey', p_workflow_key,
      'workflowId', current_activation.workflow_id,
      'bindingSnapshotId', current_activation.binding_snapshot_id,
      'activationSequence', current_activation.activation_sequence
    )
  );

  RETURN jsonb_build_object(
    'workflowKey', p_workflow_key,
    'workflowId', current_activation.workflow_id,
    'eventType', 'deactivated'
  );
END;
$$;

CREATE FUNCTION workflow_private.reject_compiled_workflow_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.skill_source_hash IS NOT NULL THEN
    RAISE EXCEPTION 'compiled_workflow_version_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER agent_workflows_compiled_version_immutable
BEFORE UPDATE OR DELETE ON public.agent_workflows
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_compiled_workflow_mutation();

CREATE FUNCTION public.install_agent_workflow_version(
  p_company_id UUID,
  p_skill_markdown TEXT,
  p_manifest JSONB,
  p_compile_result JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_workflow_id UUID;
  target_skill_source_hash TEXT;
  target_manifest_hash TEXT;
  target_diagnostics JSONB;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  IF length(COALESCE(p_skill_markdown, '')) NOT BETWEEN 1 AND 1048576
    OR jsonb_typeof(COALESCE(p_manifest, 'null'::JSONB)) <> 'object'
    OR pg_column_size(p_manifest) > 1048576
    OR p_manifest - ARRAY[
      'workflowKey',
      'workflowType',
      'name',
      'version',
      'spec',
      'compilerVersion'
    ] <> '{}'::JSONB
    OR NOT (
      p_manifest ? 'workflowKey'
      AND p_manifest ? 'workflowType'
      AND p_manifest ? 'name'
      AND p_manifest ? 'version'
      AND p_manifest ? 'spec'
      AND p_manifest ? 'compilerVersion'
    )
    OR (p_manifest ->> 'workflowKey') !~ '^[a-z0-9][a-z0-9._-]{1,149}$'
    OR length(COALESCE(p_manifest ->> 'workflowType', '')) NOT BETWEEN 1 AND 150
    OR length(COALESCE(p_manifest ->> 'name', '')) NOT BETWEEN 1 AND 200
    OR (p_manifest ->> 'version') !~ '^\d+\.\d+\.\d+$'
    OR (p_manifest ->> 'compilerVersion') !~ '^\d+\.\d+\.\d+$'
    OR jsonb_typeof(p_manifest -> 'spec') <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_compiled_workflow_manifest' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(COALESCE(p_compile_result, 'null'::JSONB)) <> 'object'
    OR pg_column_size(p_compile_result) > 262144
    OR COALESCE((p_compile_result ->> 'ok')::BOOLEAN, false) IS NOT true
  THEN
    RAISE EXCEPTION 'workflow_compile_failed' USING ERRCODE = '22023';
  END IF;

  target_diagnostics := COALESCE(p_compile_result -> 'diagnostics', '{}'::JSONB);
  IF jsonb_typeof(target_diagnostics) <> 'object' THEN
    RAISE EXCEPTION 'invalid_compiler_diagnostics' USING ERRCODE = '22023';
  END IF;

  target_skill_source_hash := encode(
    extensions.digest(convert_to(p_skill_markdown, 'UTF8'), 'sha256'),
    'hex'
  );
  target_manifest_hash := encode(
    extensions.digest(convert_to(p_manifest::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.agent_workflows (
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
  )
  VALUES (
    p_company_id,
    p_manifest ->> 'workflowKey',
    p_manifest ->> 'workflowType',
    p_manifest ->> 'name',
    p_manifest ->> 'version',
    'draft',
    p_manifest -> 'spec',
    p_skill_markdown,
    p_compile_result,
    current_user_id,
    current_user_id,
    target_skill_source_hash,
    p_manifest ->> 'compilerVersion',
    target_manifest_hash,
    now(),
    target_diagnostics
  )
  RETURNING id INTO target_workflow_id;

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'workflow_version_installed',
    'Compiled workflow version installed.',
    jsonb_build_object(
      'workflowId', target_workflow_id,
      'workflowKey', p_manifest ->> 'workflowKey',
      'version', p_manifest ->> 'version',
      'compilerVersion', p_manifest ->> 'compilerVersion',
      'skillSourceHash', target_skill_source_hash,
      'compiledManifestHash', target_manifest_hash
    )
  );

  RETURN jsonb_build_object(
    'workflowId', target_workflow_id,
    'workflowKey', p_manifest ->> 'workflowKey',
    'version', p_manifest ->> 'version',
    'status', 'draft',
    'skillSourceHash', target_skill_source_hash,
    'compiledManifestHash', target_manifest_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION workflow_private.record_company_security_audit(UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.reject_immutable_workflow_record()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.reject_activated_workflow_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.reject_compiled_workflow_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.transition_workflow_activation(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.configure_company_connector_installation(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_company_connector_capability_grant(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_company_connector_health(UUID, UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_company_capability_policy(UUID, UUID, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_company_approval_policy_controlled(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_workflow_binding_snapshot(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_agent_workflow(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollback_agent_workflow(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_agent_workflow(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.install_agent_workflow_version(UUID, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.configure_company_connector_installation(UUID, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_connector_capability_grant(UUID, UUID, UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_connector_health(UUID, UUID, TEXT, TEXT, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_capability_policy(UUID, UUID, BOOLEAN, TEXT, BOOLEAN, BOOLEAN, INTEGER, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_approval_policy_controlled(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_workflow_binding_snapshot(UUID, UUID, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_agent_workflow(UUID, UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_agent_workflow(UUID, UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_agent_workflow(UUID, TEXT, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.install_agent_workflow_version(UUID, TEXT, JSONB, JSONB)
  TO authenticated;
