-- Cycle 0.0.8: capability reads may bind every healthy authorized connector,
-- while writes remain single-target. Workspace evidence roles and every source
-- freshness value are frozen into the binding snapshot.

ALTER TABLE public.connector_capability_offerings
  ADD COLUMN evidence_roles JSONB NOT NULL DEFAULT '[]'::JSONB
  CHECK (jsonb_typeof(evidence_roles) = 'array');

ALTER TABLE public.workspace_capability_mapping_datasets
  ADD COLUMN expected_schema_hashes JSONB NOT NULL DEFAULT '[]'::JSONB
  CHECK (jsonb_typeof(expected_schema_hashes) = 'array');

UPDATE public.workspace_capability_mapping_datasets
SET expected_schema_hashes = CASE
  WHEN expected_schema_hash IS NULL THEN '[]'::JSONB
  ELSE jsonb_build_array(expected_schema_hash)
END;

DO $$
DECLARE
  target_constraint TEXT;
BEGIN
  SELECT constraint_name INTO target_constraint
  FROM information_schema.table_constraints
  WHERE table_schema = 'public'
    AND table_name = 'workflow_capability_bindings'
    AND constraint_type = 'UNIQUE'
    AND constraint_name <> 'workflow_capability_bindings_pkey'
  ORDER BY constraint_name
  LIMIT 1;
  IF target_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.workflow_capability_bindings DROP CONSTRAINT %I',
      target_constraint
    );
  END IF;
END;
$$;

ALTER TABLE public.workflow_capability_bindings
  ADD CONSTRAINT workflow_capability_bindings_snapshot_requirement_grant_key
  UNIQUE (binding_snapshot_id, requirement_key, grant_id);

CREATE INDEX workflow_capability_bindings_snapshot_requirement_idx
  ON public.workflow_capability_bindings(binding_snapshot_id, requirement_key);

-- Existing imported connectors advertise their business evidence role through
-- source configuration. New connector adapters write the same structure when
-- they register a source.
UPDATE public.external_sources
SET config = jsonb_set(
  config,
  '{businessEvidenceRoles}',
  CASE
    WHEN kind IN ('inventory_platform', 'erp') THEN
      '[{"businessObject":"procurement.purchase-order","role":"authoritative","recordTypes":["purchase_order"]}]'::JSONB
    WHEN kind IN ('project_board', 'task_board') THEN
      '[{"businessObject":"procurement.purchase-order","role":"tracking","recordTypes":["board_card"]}]'::JSONB
    WHEN kind IN ('email', 'mailbox') THEN
      '[{"businessObject":"procurement.purchase-order","role":"supporting","recordTypes":["email_message"]}]'::JSONB
    ELSE '[]'::JSONB
  END,
  true
)
WHERE NOT config ? 'businessEvidenceRoles';

UPDATE public.connector_capability_offerings offering
SET evidence_roles = '[{"businessObject":"procurement.purchase-order","role":"authoritative","recordTypes":["purchase_order"]}]'::JSONB
FROM public.capability_definition_versions version
JOIN public.capability_definitions definition
  ON definition.id = version.capability_definition_id
WHERE offering.capability_version_id = version.id
  AND definition.capability_key = 'procurement.open-orders.read';

INSERT INTO public.capability_field_classifications (
  capability_version_id, json_pointer, classification, model_allowed,
  terminal_allowed
)
SELECT version.id, field.json_pointer, field.classification, true, true
FROM public.capability_definition_versions version
JOIN public.capability_definitions definition
  ON definition.id = version.capability_definition_id
CROSS JOIN (VALUES
  ('/duplicateOpenOrderMatchCount', 'confidential'),
  ('/openOrderSourceCoverageComplete', 'internal')
) field(json_pointer, classification)
WHERE definition.capability_key = 'procurement.open-orders.read'
  AND version.version = '1.0.0'
ON CONFLICT (capability_version_id, json_pointer) DO UPDATE SET
  classification = EXCLUDED.classification,
  model_allowed = EXCLUDED.model_allowed,
  terminal_allowed = EXCLUDED.terminal_allowed;

CREATE OR REPLACE FUNCTION public.create_workflow_binding_snapshot(
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

  SELECT workflow.* INTO target_workflow
  FROM public.agent_workflows workflow
  WHERE workflow.id = p_workflow_id AND workflow.company_id = p_company_id;
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

    SELECT grant_record.capability_version_id INTO target_capability_version_id
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
      SELECT 1 FROM jsonb_array_elements(canonical_bindings) existing_binding
      WHERE existing_binding ->> 'requirementKey' = target_requirement_key
        AND existing_binding ->> 'grantId' = target_grant_id::TEXT
    ) THEN
      RAISE EXCEPTION 'duplicate_workflow_binding_grant' USING ERRCODE = '22023';
    END IF;
    canonical_bindings := canonical_bindings || jsonb_build_array(
      jsonb_build_object(
        'requirementKey', target_requirement_key,
        'grantId', target_grant_id,
        'capabilityVersionId', target_capability_version_id
      )
    );
  END LOOP;

  SELECT jsonb_agg(binding ORDER BY binding ->> 'requirementKey', binding ->> 'grantId')
  INTO canonical_bindings
  FROM jsonb_array_elements(canonical_bindings) binding;
  target_grant_digest := encode(
    extensions.digest(convert_to(canonical_bindings::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.workflow_binding_snapshots (
    company_id, workflow_id, manifest_hash, grant_digest, created_by
  ) VALUES (
    p_company_id, p_workflow_id, target_workflow.compiled_manifest_hash,
    target_grant_digest, current_user_id
  ) RETURNING id INTO target_snapshot_id;

  INSERT INTO public.workflow_capability_bindings (
    company_id, binding_snapshot_id, requirement_key, grant_id,
    capability_version_id
  )
  SELECT p_company_id, target_snapshot_id, binding ->> 'requirementKey',
    (binding ->> 'grantId')::UUID,
    (binding ->> 'capabilityVersionId')::UUID
  FROM jsonb_array_elements(canonical_bindings) binding;

  INSERT INTO public.workflow_binding_snapshot_events (
    company_id, binding_snapshot_id, event_type, reason, actor_id
  ) VALUES (
    p_company_id, target_snapshot_id, 'created',
    'Workflow capability bindings were resolved and frozen.', current_user_id
  );
  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'workflow_binding_snapshot_created',
    'Workflow binding snapshot created.',
    jsonb_build_object(
      'workflowId', p_workflow_id,
      'bindingSnapshotId', target_snapshot_id,
      'manifestHash', target_workflow.compiled_manifest_hash,
      'grantDigest', target_grant_digest,
      'bindings', canonical_bindings
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

CREATE OR REPLACE FUNCTION public.publish_workspace_capability_mapping_v1(
  p_company_id UUID,
  p_mapping_key TEXT,
  p_capability_version_id UUID,
  p_confidence NUMERIC,
  p_spec JSONB,
  p_provenance JSONB DEFAULT '{}'::JSONB,
  p_confirmed BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_version INTEGER;
  target_id UUID;
  target_status TEXT;
  target_hash TEXT;
  dataset JSONB;
  matching_catalogs INTEGER;
  target_schema_hash TEXT;
  target_schema_hashes JSONB;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);
  IF p_mapping_key !~ '^[a-z0-9][a-z0-9._-]{2,149}$'
    OR p_confidence NOT BETWEEN 0 AND 1
    OR jsonb_typeof(COALESCE(p_spec, 'null'::JSONB)) <> 'object'
    OR jsonb_typeof(COALESCE(p_spec -> 'datasets', 'null'::JSONB)) <> 'array'
    OR jsonb_array_length(p_spec -> 'datasets') NOT BETWEEN 1 AND 20
    OR jsonb_typeof(COALESCE(p_provenance, 'null'::JSONB)) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_workspace_mapping' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.capability_definition_versions version
    JOIN public.capability_definitions definition
      ON definition.id = version.capability_definition_id
    WHERE version.id = p_capability_version_id
      AND version.status = 'active' AND definition.status = 'active'
      AND definition.effect = 'read'
  ) THEN
    RAISE EXCEPTION 'workspace_mapping_requires_read_capability' USING ERRCODE = '22023';
  END IF;

  target_status := CASE WHEN p_confirmed THEN 'validated' ELSE 'needs_confirmation' END;
  target_hash := encode(extensions.digest(convert_to(p_spec::TEXT, 'UTF8'), 'sha256'), 'hex');
  UPDATE public.workspace_capability_mapping_versions SET status = 'invalidated'
  WHERE company_id = p_company_id AND mapping_key = p_mapping_key
    AND capability_version_id = p_capability_version_id
    AND status IN ('validated', 'needs_confirmation', 'proposed');
  SELECT COALESCE(max(version), 0) + 1 INTO target_version
  FROM public.workspace_capability_mapping_versions
  WHERE company_id = p_company_id AND mapping_key = p_mapping_key;
  INSERT INTO public.workspace_capability_mapping_versions (
    company_id, mapping_key, version, capability_version_id, status,
    confidence, spec, spec_hash, provenance, confirmed_by, confirmed_at, created_by
  ) VALUES (
    p_company_id, p_mapping_key, target_version, p_capability_version_id,
    target_status, p_confidence, p_spec, target_hash, p_provenance,
    CASE WHEN p_confirmed THEN current_user_id ELSE NULL END,
    CASE WHEN p_confirmed THEN now() ELSE NULL END, current_user_id
  ) RETURNING id INTO target_id;

  FOR dataset IN SELECT value FROM jsonb_array_elements(p_spec -> 'datasets')
  LOOP
    IF jsonb_typeof(dataset) <> 'object'
      OR COALESCE(dataset ->> 'alias', '') !~ '^[a-z][a-z0-9_-]{0,63}$'
      OR length(COALESCE(dataset ->> 'recordType', '')) NOT BETWEEN 1 AND 150
    THEN
      RAISE EXCEPTION 'invalid_workspace_mapping_dataset' USING ERRCODE = '22023';
    END IF;
    SELECT count(*)::INTEGER,
      min(entry.schema_hash),
      COALESCE(jsonb_agg(DISTINCT entry.schema_hash ORDER BY entry.schema_hash), '[]'::JSONB)
    INTO matching_catalogs, target_schema_hash, target_schema_hashes
    FROM public.workspace_data_catalogs entry
    WHERE entry.company_id = p_company_id
      AND entry.record_type = dataset ->> 'recordType'
      AND (dataset ->> 'sourceKey' IS NULL OR entry.source_key = dataset ->> 'sourceKey')
      AND entry.profile_status IN ('ready', 'drifted')
      AND entry.schema_hash IS NOT NULL;
    IF matching_catalogs = 0 AND COALESCE((dataset ->> 'required')::BOOLEAN, true) THEN
      RAISE EXCEPTION 'workspace_mapping_dataset_not_cataloged' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.workspace_capability_mapping_datasets (
      mapping_version_id, company_id, dataset_alias, source_key, record_type,
      expected_schema_hash, expected_schema_hashes,
      maximum_freshness_hours, required
    ) VALUES (
      target_id, p_company_id, dataset ->> 'alias', dataset ->> 'sourceKey',
      dataset ->> 'recordType',
      CASE WHEN jsonb_array_length(target_schema_hashes) = 1 THEN target_schema_hash ELSE NULL END,
      target_schema_hashes,
      COALESCE((dataset ->> 'maximumFreshnessHours')::INTEGER, 72),
      COALESCE((dataset ->> 'required')::BOOLEAN, true)
    );
  END LOOP;
  RETURN jsonb_build_object(
    'mappingVersionId', target_id, 'mappingKey', p_mapping_key,
    'version', target_version, 'status', target_status, 'specHash', target_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bind_workspace_mappings_v1(
  p_company_id UUID,
  p_binding_snapshot_id UUID,
  p_mappings JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  entry JSONB;
  target_mapping public.workspace_capability_mapping_versions%ROWTYPE;
  catalog_digest TEXT;
  freshness JSONB;
  policy JSONB;
  bound_count INTEGER := 0;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_binding_snapshots snapshot
    WHERE snapshot.id = p_binding_snapshot_id AND snapshot.company_id = p_company_id
  ) OR jsonb_typeof(COALESCE(p_mappings, 'null'::JSONB)) <> 'array'
    OR jsonb_array_length(p_mappings) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'invalid_workspace_mapping_binding' USING ERRCODE = '22023';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(p_mappings)
  LOOP
    SELECT mapping.* INTO target_mapping
    FROM public.workspace_capability_mapping_versions mapping
    WHERE mapping.id = (entry ->> 'mappingVersionId')::UUID
      AND mapping.company_id = p_company_id AND mapping.status = 'validated';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'workspace_mapping_not_validated' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.workspace_capability_mapping_datasets dataset
      LEFT JOIN public.workspace_data_catalogs catalog
        ON catalog.company_id = dataset.company_id
       AND catalog.record_type = dataset.record_type
       AND (dataset.source_key IS NULL OR catalog.source_key = dataset.source_key)
       AND catalog.profile_status <> 'detached'
      WHERE dataset.mapping_version_id = target_mapping.id
        AND dataset.company_id = p_company_id
      GROUP BY dataset.mapping_version_id, dataset.dataset_alias,
        dataset.expected_schema_hashes, dataset.required
      HAVING
        (dataset.required AND count(catalog.id) = 0)
        OR count(catalog.id) FILTER (
          WHERE catalog.profile_status <> 'ready'
            OR NOT dataset.expected_schema_hashes ? catalog.schema_hash
        ) > 0
        OR count(DISTINCT catalog.schema_hash) <> jsonb_array_length(dataset.expected_schema_hashes)
    ) THEN
      RAISE EXCEPTION 'workspace_mapping_schema_drift' USING ERRCODE = '22023';
    END IF;

    WITH relevant_sources AS (
      SELECT
        dataset.dataset_alias,
        dataset.record_type,
        dataset.maximum_freshness_hours,
        spec.value ->> 'businessObject' AS business_object,
        spec.value ->> 'evidenceRole' AS evidence_role,
        source.id AS source_id,
        source.source_key,
        source.sync_status,
        source.last_synced_at,
        source.last_sync_error,
        catalog.schema_hash,
        catalog.catalog_version,
        catalog.profile_status,
        catalog.freshest_observed_at
      FROM public.workspace_capability_mapping_datasets dataset
      JOIN LATERAL (
        SELECT value
        FROM jsonb_array_elements(target_mapping.spec -> 'datasets')
        WHERE value ->> 'alias' = dataset.dataset_alias
        LIMIT 1
      ) spec ON true
      JOIN public.external_sources source
        ON source.company_id = dataset.company_id
       AND (
         source.source_key = dataset.source_key
         OR (
           dataset.source_key IS NULL
           AND (
             EXISTS (
               SELECT 1 FROM public.workspace_data_catalogs matching
               WHERE matching.company_id = dataset.company_id
                 AND matching.source_id = source.id
                 AND matching.record_type = dataset.record_type
                 AND matching.profile_status <> 'detached'
             )
             OR EXISTS (
               SELECT 1
               FROM jsonb_array_elements(COALESCE(
                 source.config -> 'businessEvidenceRoles', '[]'::JSONB
               )) role
               WHERE role ->> 'businessObject' = spec.value ->> 'businessObject'
                 AND role ->> 'role' = spec.value ->> 'evidenceRole'
                 AND COALESCE(role -> 'recordTypes', '[]'::JSONB) ? dataset.record_type
             )
           )
         )
       )
      LEFT JOIN public.workspace_data_catalogs catalog
        ON catalog.company_id = dataset.company_id
       AND catalog.source_id = source.id
       AND catalog.record_type = dataset.record_type
       AND catalog.profile_status <> 'detached'
      WHERE dataset.mapping_version_id = target_mapping.id
        AND dataset.company_id = p_company_id
    )
    SELECT encode(extensions.digest(convert_to(COALESCE(jsonb_agg(jsonb_build_object(
        'datasetAlias', source.dataset_alias,
        'sourceId', source.source_id,
        'sourceKey', source.source_key,
        'recordType', source.record_type,
        'businessObject', source.business_object,
        'evidenceRole', source.evidence_role,
        'schemaHash', source.schema_hash,
        'catalogVersion', source.catalog_version
      ) ORDER BY source.dataset_alias, source.source_key), '[]'::JSONB)::TEXT,
      'UTF8'), 'sha256'), 'hex'),
      COALESCE(jsonb_object_agg(
        source.dataset_alias || ':' || source.source_key,
        jsonb_build_object(
          'sourceId', source.source_id,
          'sourceKey', source.source_key,
          'recordType', source.record_type,
          'businessObject', source.business_object,
          'evidenceRole', source.evidence_role,
          'syncStatus', source.sync_status,
          'lastSyncedAt', source.last_synced_at,
          'lastSyncError', source.last_sync_error,
          'freshestObservedAt', source.freshest_observed_at,
          'maximumFreshnessHours', source.maximum_freshness_hours,
          'profileStatus', source.profile_status
        )
      ), '{}'::JSONB)
    INTO catalog_digest, freshness
    FROM relevant_sources source;

    SELECT jsonb_build_object(
      'enabled', capability_policy.enabled,
      'minimumRole', capability_policy.minimum_role,
      'allowModelProcessing', capability_policy.allow_model_processing,
      'maxRows', capability_policy.max_rows,
      'maxBytes', capability_policy.max_bytes,
      'updatedAt', capability_policy.updated_at
    ) INTO policy
    FROM public.company_capability_policies capability_policy
    WHERE capability_policy.company_id = p_company_id
      AND capability_policy.capability_version_id = target_mapping.capability_version_id
      AND capability_policy.enabled;
    IF policy IS NULL THEN
      RAISE EXCEPTION 'workspace_mapping_policy_unavailable' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.workflow_workspace_mapping_bindings (
      binding_snapshot_id, company_id, requirement_key, mapping_version_id,
      mapping_spec_hash, catalog_digest, policy_snapshot, freshness_snapshot
    ) VALUES (
      p_binding_snapshot_id, p_company_id, entry ->> 'requirementKey',
      target_mapping.id, target_mapping.spec_hash, catalog_digest, policy, freshness
    );
    bound_count := bound_count + 1;
  END LOOP;
  RETURN jsonb_build_object(
    'bindingSnapshotId', p_binding_snapshot_id,
    'workspaceMappingsBound', bound_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_workflow_binding_snapshot(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_workflow_binding_snapshot(UUID, UUID, JSONB)
  TO authenticated;
REVOKE ALL ON FUNCTION public.publish_workspace_capability_mapping_v1(UUID, TEXT, UUID, NUMERIC, JSONB, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_workspace_capability_mapping_v1(UUID, TEXT, UUID, NUMERIC, JSONB, JSONB, BOOLEAN)
  TO authenticated;
REVOKE ALL ON FUNCTION public.bind_workspace_mappings_v1(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_workspace_mappings_v1(UUID, UUID, JSONB)
  TO authenticated;
