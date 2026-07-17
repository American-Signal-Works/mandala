-- Cycle 0.0.7: generic workspace-data catalog and declarative capability maps.
--
-- This layer deliberately knows nothing about a customer, source product, or
-- business workflow. Imported records are cataloged by their existing source
-- and record_type identities. Capability semantics live in versioned JSON
-- mappings, while the provider that evaluates those mappings lives in the app.

CREATE TABLE public.workspace_data_catalogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_id UUID NOT NULL,
  source_key TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (length(record_type) BETWEEN 1 AND 150),
  record_count BIGINT NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  first_observed_at TIMESTAMPTZ,
  freshest_observed_at TIMESTAMPTZ,
  field_profile JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(field_profile) = 'array'),
  relationship_profile JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(relationship_profile) = 'array'),
  schema_hash TEXT CHECK (schema_hash IS NULL OR schema_hash ~ '^[a-f0-9]{64}$'),
  catalog_version BIGINT NOT NULL DEFAULT 1 CHECK (catalog_version > 0),
  profile_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (profile_status IN ('pending', 'ready', 'drifted', 'detached')),
  profiled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_id, record_type),
  UNIQUE (id, company_id),
  FOREIGN KEY (source_id, company_id)
    REFERENCES public.external_sources(id, company_id) ON DELETE CASCADE
);

CREATE TABLE public.workspace_capability_mapping_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  mapping_key TEXT NOT NULL
    CHECK (mapping_key ~ '^[a-z0-9][a-z0-9._-]{2,149}$'),
  version INTEGER NOT NULL CHECK (version > 0),
  capability_version_id UUID NOT NULL
    REFERENCES public.capability_definition_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL
    CHECK (status IN ('proposed', 'needs_confirmation', 'validated', 'invalidated')),
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  spec JSONB NOT NULL CHECK (jsonb_typeof(spec) = 'object'),
  spec_hash TEXT NOT NULL CHECK (spec_hash ~ '^[a-f0-9]{64}$'),
  provenance JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(provenance) = 'object'),
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, mapping_key, version),
  UNIQUE (id, company_id),
  CHECK (
    (status = 'validated' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    OR status <> 'validated'
  )
);

CREATE TABLE public.workspace_capability_mapping_datasets (
  mapping_version_id UUID NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dataset_alias TEXT NOT NULL
    CHECK (dataset_alias ~ '^[a-z][a-z0-9_-]{0,63}$'),
  source_key TEXT,
  record_type TEXT NOT NULL CHECK (length(record_type) BETWEEN 1 AND 150),
  expected_schema_hash TEXT
    CHECK (expected_schema_hash IS NULL OR expected_schema_hash ~ '^[a-f0-9]{64}$'),
  maximum_freshness_hours INTEGER NOT NULL DEFAULT 72
    CHECK (maximum_freshness_hours BETWEEN 1 AND 8760),
  required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mapping_version_id, dataset_alias),
  FOREIGN KEY (mapping_version_id, company_id)
    REFERENCES public.workspace_capability_mapping_versions(id, company_id)
    ON DELETE CASCADE
);

CREATE TABLE public.workflow_workspace_mapping_bindings (
  binding_snapshot_id UUID NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL
    CHECK (requirement_key ~ '^[a-z0-9][a-z0-9._-]{1,149}$'),
  mapping_version_id UUID NOT NULL,
  mapping_spec_hash TEXT NOT NULL CHECK (mapping_spec_hash ~ '^[a-f0-9]{64}$'),
  catalog_digest TEXT NOT NULL CHECK (catalog_digest ~ '^[a-f0-9]{64}$'),
  policy_snapshot JSONB NOT NULL CHECK (jsonb_typeof(policy_snapshot) = 'object'),
  freshness_snapshot JSONB NOT NULL CHECK (jsonb_typeof(freshness_snapshot) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (binding_snapshot_id, requirement_key),
  FOREIGN KEY (binding_snapshot_id, company_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (mapping_version_id, company_id)
    REFERENCES public.workspace_capability_mapping_versions(id, company_id)
    ON DELETE RESTRICT
);

CREATE INDEX workspace_data_catalogs_company_type_idx
  ON public.workspace_data_catalogs(company_id, record_type, freshest_observed_at DESC);
CREATE INDEX workspace_mapping_versions_company_status_idx
  ON public.workspace_capability_mapping_versions(company_id, status, created_at DESC);

CREATE TRIGGER workspace_data_catalogs_touch
BEFORE UPDATE ON public.workspace_data_catalogs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.workspace_data_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_capability_mapping_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_capability_mapping_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_workspace_mapping_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_data_catalogs_member_select
  ON public.workspace_data_catalogs FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY workspace_mapping_versions_member_select
  ON public.workspace_capability_mapping_versions FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY workspace_mapping_datasets_member_select
  ON public.workspace_capability_mapping_datasets FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY workflow_workspace_mapping_bindings_member_select
  ON public.workflow_workspace_mapping_bindings FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

REVOKE ALL ON TABLE
  public.workspace_data_catalogs,
  public.workspace_capability_mapping_versions,
  public.workspace_capability_mapping_datasets,
  public.workflow_workspace_mapping_bindings
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE
  public.workspace_data_catalogs,
  public.workspace_capability_mapping_versions,
  public.workspace_capability_mapping_datasets,
  public.workflow_workspace_mapping_bindings
TO authenticated;
GRANT ALL ON TABLE
  public.workspace_data_catalogs,
  public.workspace_capability_mapping_versions,
  public.workspace_capability_mapping_datasets,
  public.workflow_workspace_mapping_bindings
TO service_role;

-- Imports immediately make the affected catalog entry visibly pending. The
-- bounded refresh function below performs the heavier schema/profile pass.
CREATE FUNCTION workflow_private.mark_workspace_catalog_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.external_records%ROWTYPE;
  target_source_key TEXT;
  count_delta INTEGER;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  count_delta := CASE WHEN TG_OP = 'INSERT' THEN 1 WHEN TG_OP = 'DELETE' THEN -1 ELSE 0 END;

  SELECT source.source_key INTO target_source_key
  FROM public.external_sources source
  WHERE source.id = target.source_id AND source.company_id = target.company_id;

  INSERT INTO public.workspace_data_catalogs (
    company_id, source_id, source_key, record_type, record_count,
    first_observed_at, freshest_observed_at, profile_status
  )
  VALUES (
    target.company_id, target.source_id, target_source_key, target.record_type,
    GREATEST(count_delta, 0), target.pulled_at, target.pulled_at, 'pending'
  )
  ON CONFLICT (company_id, source_id, record_type)
  DO UPDATE SET
    record_count = GREATEST(0, public.workspace_data_catalogs.record_count + count_delta),
    first_observed_at = LEAST(public.workspace_data_catalogs.first_observed_at, target.pulled_at),
    freshest_observed_at = GREATEST(public.workspace_data_catalogs.freshest_observed_at, target.pulled_at),
    profile_status = 'pending',
    catalog_version = public.workspace_data_catalogs.catalog_version + 1;
  RETURN NULL;
END;
$$;

CREATE TRIGGER external_records_mark_workspace_catalog_pending
AFTER INSERT OR UPDATE OR DELETE ON public.external_records
FOR EACH ROW EXECUTE FUNCTION workflow_private.mark_workspace_catalog_pending();

CREATE FUNCTION public.refresh_workspace_data_catalog_v1(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  refreshed_count INTEGER;
  detached_count INTEGER;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', current_user_id);

  WITH field_counts AS (
    SELECT
      record.company_id,
      record.source_id,
      record.record_type,
      field.key AS field_name,
      jsonb_typeof(field.value) AS field_type,
      count(*)::BIGINT AS observed_count
    FROM public.external_records record
    CROSS JOIN LATERAL jsonb_each(record.payload) field
    WHERE record.company_id = p_company_id
    GROUP BY record.company_id, record.source_id, record.record_type,
      field.key, jsonb_typeof(field.value)
  ), field_profiles AS (
    SELECT
      company_id,
      source_id,
      record_type,
      jsonb_agg(
        jsonb_build_object(
          'path', '/' || replace(replace(field_name, '~', '~0'), '/', '~1'),
          'type', field_type,
          'observedCount', observed_count,
          'classification', 'unreviewed',
          'modelAllowed', false
        ) ORDER BY field_name, field_type
      ) AS fields
    FROM field_counts
    GROUP BY company_id, source_id, record_type
  ), relationship_profiles AS (
    SELECT
      source_record.company_id,
      source_record.source_id,
      source_record.record_type,
      jsonb_agg(DISTINCT jsonb_build_object(
        'relationship', link.relationship,
        'targetRecordType', target_record.record_type
      )) AS relationships
    FROM public.external_record_links link
    JOIN public.external_records source_record
      ON source_record.id = link.from_record_id
     AND source_record.company_id = link.company_id
    JOIN public.external_records target_record
      ON target_record.id = link.to_record_id
     AND target_record.company_id = link.company_id
    WHERE source_record.company_id = p_company_id
    GROUP BY source_record.company_id, source_record.source_id, source_record.record_type
  ), summaries AS (
    SELECT
      record.company_id,
      record.source_id,
      source.source_key,
      record.record_type,
      count(*)::BIGINT AS record_count,
      min(record.pulled_at) AS first_observed_at,
      max(record.pulled_at) AS freshest_observed_at,
      COALESCE(profile.fields, '[]'::JSONB) AS fields,
      COALESCE(relationships.relationships, '[]'::JSONB) AS relationships
    FROM public.external_records record
    JOIN public.external_sources source
      ON source.id = record.source_id AND source.company_id = record.company_id
    LEFT JOIN field_profiles profile
      ON profile.company_id = record.company_id
     AND profile.source_id = record.source_id
     AND profile.record_type = record.record_type
    LEFT JOIN relationship_profiles relationships
      ON relationships.company_id = record.company_id
     AND relationships.source_id = record.source_id
     AND relationships.record_type = record.record_type
    WHERE record.company_id = p_company_id
    GROUP BY record.company_id, record.source_id, source.source_key, record.record_type,
      profile.fields, relationships.relationships
  ), upserted AS (
    INSERT INTO public.workspace_data_catalogs (
      company_id, source_id, source_key, record_type, record_count,
      first_observed_at, freshest_observed_at, field_profile,
      relationship_profile, schema_hash, profile_status, profiled_at
    )
    SELECT
      summary.company_id,
      summary.source_id,
      summary.source_key,
      summary.record_type,
      summary.record_count,
      summary.first_observed_at,
      summary.freshest_observed_at,
      summary.fields,
      summary.relationships,
      encode(extensions.digest(convert_to(
        jsonb_build_object('fields', summary.fields, 'relationships', summary.relationships)::TEXT,
        'UTF8'
      ), 'sha256'), 'hex'),
      'ready',
      now()
    FROM summaries summary
    ON CONFLICT (company_id, source_id, record_type)
    DO UPDATE SET
      source_key = EXCLUDED.source_key,
      record_count = EXCLUDED.record_count,
      first_observed_at = EXCLUDED.first_observed_at,
      freshest_observed_at = EXCLUDED.freshest_observed_at,
      field_profile = EXCLUDED.field_profile,
      relationship_profile = EXCLUDED.relationship_profile,
      profile_status = CASE
        WHEN public.workspace_data_catalogs.schema_hash IS NOT NULL
         AND public.workspace_data_catalogs.schema_hash <> EXCLUDED.schema_hash
        THEN 'drifted'
        ELSE 'ready'
      END,
      schema_hash = EXCLUDED.schema_hash,
      catalog_version = CASE
        WHEN public.workspace_data_catalogs.schema_hash IS DISTINCT FROM EXCLUDED.schema_hash
        THEN public.workspace_data_catalogs.catalog_version + 1
        ELSE public.workspace_data_catalogs.catalog_version
      END,
      profiled_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO refreshed_count FROM upserted;

  UPDATE public.workspace_data_catalogs catalog
  SET profile_status = 'detached', catalog_version = catalog.catalog_version + 1
  WHERE catalog.company_id = p_company_id
    AND catalog.profile_status <> 'detached'
    AND NOT EXISTS (
      SELECT 1 FROM public.external_records record
      WHERE record.company_id = catalog.company_id
        AND record.source_id = catalog.source_id
        AND record.record_type = catalog.record_type
    );
  GET DIAGNOSTICS detached_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'catalogsRefreshed', refreshed_count,
    'catalogsDetached', detached_count,
    'profiledAt', now()
  );
END;
$$;

CREATE FUNCTION public.publish_workspace_capability_mapping_v1(
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
  matching_schemas INTEGER;
  target_schema_hash TEXT;
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
      AND version.status = 'active'
      AND definition.status = 'active'
      AND definition.effect = 'read'
  ) THEN
    RAISE EXCEPTION 'workspace_mapping_requires_read_capability' USING ERRCODE = '22023';
  END IF;

  target_status := CASE WHEN p_confirmed THEN 'validated' ELSE 'needs_confirmation' END;
  target_hash := encode(extensions.digest(convert_to(p_spec::TEXT, 'UTF8'), 'sha256'), 'hex');
  UPDATE public.workspace_capability_mapping_versions
  SET status = 'invalidated'
  WHERE company_id = p_company_id
    AND mapping_key = p_mapping_key
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
    CASE WHEN p_confirmed THEN now() ELSE NULL END,
    current_user_id
  ) RETURNING id INTO target_id;

  FOR dataset IN SELECT value FROM jsonb_array_elements(p_spec -> 'datasets')
  LOOP
    IF jsonb_typeof(dataset) <> 'object'
      OR COALESCE(dataset ->> 'alias', '') !~ '^[a-z][a-z0-9_-]{0,63}$'
      OR length(COALESCE(dataset ->> 'recordType', '')) NOT BETWEEN 1 AND 150
    THEN
      RAISE EXCEPTION 'invalid_workspace_mapping_dataset' USING ERRCODE = '22023';
    END IF;

    SELECT
      count(*)::INTEGER,
      count(DISTINCT entry.schema_hash)::INTEGER,
      min(entry.schema_hash)
    INTO matching_catalogs, matching_schemas, target_schema_hash
    FROM public.workspace_data_catalogs entry
    WHERE entry.company_id = p_company_id
      AND entry.record_type = dataset ->> 'recordType'
      AND (dataset ->> 'sourceKey' IS NULL OR entry.source_key = dataset ->> 'sourceKey')
      AND entry.profile_status IN ('ready', 'drifted')
      AND entry.schema_hash IS NOT NULL;
    IF matching_catalogs = 0 AND COALESCE((dataset ->> 'required')::BOOLEAN, true) THEN
      RAISE EXCEPTION 'workspace_mapping_dataset_not_cataloged' USING ERRCODE = '22023';
    END IF;
    IF matching_catalogs > 1 OR matching_schemas > 1 THEN
      RAISE EXCEPTION 'workspace_mapping_dataset_ambiguous' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.workspace_capability_mapping_datasets (
      mapping_version_id, company_id, dataset_alias, source_key, record_type,
      expected_schema_hash, maximum_freshness_hours, required
    ) VALUES (
      target_id, p_company_id, dataset ->> 'alias', dataset ->> 'sourceKey',
      dataset ->> 'recordType', target_schema_hash,
      COALESCE((dataset ->> 'maximumFreshnessHours')::INTEGER, 72),
      COALESCE((dataset ->> 'required')::BOOLEAN, true)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'mappingVersionId', target_id,
    'mappingKey', p_mapping_key,
    'version', target_version,
    'status', target_status,
    'specHash', target_hash
  );
END;
$$;

CREATE FUNCTION public.bind_workspace_mappings_v1(
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
      AND mapping.company_id = p_company_id
      AND mapping.status = 'validated';
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
        dataset.source_key, dataset.expected_schema_hash
      HAVING
        (dataset.source_key IS NULL AND count(catalog.id) > 1)
        OR (dataset.expected_schema_hash IS NULL AND count(catalog.id) > 0)
        OR (
          dataset.expected_schema_hash IS NOT NULL
          AND (
            count(catalog.id) = 0
            OR count(catalog.id) FILTER (
              WHERE catalog.profile_status = 'ready'
                AND catalog.schema_hash = dataset.expected_schema_hash
            ) <> count(catalog.id)
          )
        )
    ) THEN
      RAISE EXCEPTION 'workspace_mapping_schema_drift' USING ERRCODE = '22023';
    END IF;

    SELECT
      encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object(
        'datasetAlias', dataset.dataset_alias,
        'sourceKey', dataset.source_key,
        'recordType', dataset.record_type,
        'schemaHash', catalog.schema_hash,
        'catalogVersion', catalog.catalog_version
      ) ORDER BY dataset.dataset_alias)::TEXT, 'UTF8'), 'sha256'), 'hex'),
      jsonb_object_agg(dataset.dataset_alias, jsonb_build_object(
        'freshestObservedAt', catalog.freshest_observed_at,
        'maximumFreshnessHours', dataset.maximum_freshness_hours
      ))
    INTO catalog_digest, freshness
    FROM public.workspace_capability_mapping_datasets dataset
    JOIN public.workspace_data_catalogs catalog
      ON catalog.company_id = dataset.company_id
     AND catalog.record_type = dataset.record_type
     AND (dataset.source_key IS NULL OR catalog.source_key = dataset.source_key)
     AND catalog.schema_hash = dataset.expected_schema_hash
     AND catalog.profile_status = 'ready'
    WHERE dataset.mapping_version_id = target_mapping.id
      AND dataset.company_id = p_company_id;
    IF catalog_digest IS NULL THEN
      RAISE EXCEPTION 'workspace_mapping_schema_drift' USING ERRCODE = '22023';
    END IF;

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

REVOKE ALL ON FUNCTION workflow_private.mark_workspace_catalog_pending()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_workspace_data_catalog_v1(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_workspace_capability_mapping_v1(UUID, TEXT, UUID, NUMERIC, JSONB, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bind_workspace_mappings_v1(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_workspace_data_catalog_v1(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_workspace_capability_mapping_v1(UUID, TEXT, UUID, NUMERIC, JSONB, JSONB, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bind_workspace_mappings_v1(UUID, UUID, JSONB) TO authenticated;

-- Platform-owned generic data provider. It can offer any registered read
-- capability; a company only receives capabilities for validated mappings.
INSERT INTO public.connector_definitions (
  connector_key, display_name, description, status
) VALUES (
  'mandala.workspace-data',
  'Mandala Workspace Data',
  'Generic bounded access to cataloged workspace datasets through declarative mappings.',
  'active'
) ON CONFLICT (connector_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  status = EXCLUDED.status;

WITH definition AS (
  SELECT id FROM public.connector_definitions
  WHERE connector_key = 'mandala.workspace-data'
), manifest AS (
  SELECT '{"provider":"workspace-data","mappingSchema":"mandala.workspace-data/v1","networkEgress":false}'::JSONB AS value
)
INSERT INTO public.connector_definition_versions (
  connector_definition_id, version, manifest, manifest_hash, schema_hash, status
)
SELECT
  definition.id,
  '1.0.0',
  manifest.value,
  encode(extensions.digest(convert_to(manifest.value::TEXT, 'UTF8'), 'sha256'), 'hex'),
  encode(extensions.digest(convert_to('mandala.workspace-data:v1', 'UTF8'), 'sha256'), 'hex'),
  'active'
FROM definition, manifest
ON CONFLICT (connector_definition_id, version) DO UPDATE SET
  manifest = EXCLUDED.manifest,
  manifest_hash = EXCLUDED.manifest_hash,
  schema_hash = EXCLUDED.schema_hash,
  status = EXCLUDED.status;

-- A workflow-neutral read capability is useful for differently shaped fixture
-- proofs; domain skills may continue to request their existing semantic keys.
INSERT INTO public.capability_definitions (
  capability_key, display_name, description, effect, risk_class, status
) VALUES (
  'workspace.records.read',
  'Read mapped workspace records',
  'Read a bounded, classified projection from a cataloged workspace dataset.',
  'read',
  'read',
  'active'
) ON CONFLICT (capability_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  status = EXCLUDED.status;

WITH definition AS (
  SELECT id FROM public.capability_definitions
  WHERE capability_key = 'workspace.records.read'
), schemas AS (
  SELECT
    '{"type":"object","properties":{"limit":{"type":"integer"}},"additionalProperties":false}'::JSONB AS input_schema,
    '{"type":"object","properties":{"records":{"type":"array","items":{"type":"object"}}},"required":["records"]}'::JSONB AS output_schema
)
INSERT INTO public.capability_definition_versions (
  capability_definition_id, version, input_schema, output_schema, schema_hash, status
)
SELECT
  definition.id,
  '1.0.0',
  schemas.input_schema,
  schemas.output_schema,
  encode(extensions.digest(convert_to(
    jsonb_build_object('input', schemas.input_schema, 'output', schemas.output_schema)::TEXT,
    'UTF8'
  ), 'sha256'), 'hex'),
  'active'
FROM definition, schemas
ON CONFLICT (capability_definition_id, version) DO UPDATE SET
  input_schema = EXCLUDED.input_schema,
  output_schema = EXCLUDED.output_schema,
  schema_hash = EXCLUDED.schema_hash,
  status = EXCLUDED.status;

INSERT INTO public.capability_field_classifications (
  capability_version_id, json_pointer, classification, model_allowed, terminal_allowed
)
SELECT version.id, '/records', 'internal', true, true
FROM public.capability_definition_versions version
JOIN public.capability_definitions definition
  ON definition.id = version.capability_definition_id
WHERE definition.capability_key = 'workspace.records.read'
  AND version.version = '1.0.0'
ON CONFLICT (capability_version_id, json_pointer) DO UPDATE SET
  classification = EXCLUDED.classification,
  model_allowed = EXCLUDED.model_allowed,
  terminal_allowed = EXCLUDED.terminal_allowed;

INSERT INTO public.connector_capability_offerings (
  connector_version_id, capability_version_id, provider_operation
)
SELECT
  connector_version.id,
  capability_version.id,
  'workspace.read.' || replace(capability.capability_key, '.', '_')
FROM public.connector_definition_versions connector_version
JOIN public.connector_definitions connector
  ON connector.id = connector_version.connector_definition_id
CROSS JOIN public.capability_definition_versions capability_version
JOIN public.capability_definitions capability
  ON capability.id = capability_version.capability_definition_id
WHERE connector.connector_key = 'mandala.workspace-data'
  AND connector_version.version = '1.0.0'
  AND capability.effect = 'read'
  AND capability.status = 'active'
  AND capability_version.status = 'active'
ON CONFLICT (connector_version_id, capability_version_id) DO UPDATE SET
  provider_operation = EXCLUDED.provider_operation;
