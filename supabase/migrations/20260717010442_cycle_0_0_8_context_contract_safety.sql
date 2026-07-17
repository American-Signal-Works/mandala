-- Cycle 0.0.8: tenant-safe Context settings and provider-indexing policy contract.
--
-- Context remains disabled by default. Company ID is the canonical workspace
-- scope for this slice. All user mutations go through checked, audited RPCs;
-- direct table writes are intentionally unavailable to API roles.

CREATE TABLE public.context_workspace_settings (
  company_id UUID PRIMARY KEY
    REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'off'
    CHECK (provider IN ('off', 'supermemory')),
  sandbox_enabled BOOLEAN NOT NULL DEFAULT true,
  readiness TEXT NOT NULL DEFAULT 'disabled'
    CHECK (readiness IN ('disabled', 'not_ready', 'ready', 'error')),
  configuration_version BIGINT NOT NULL DEFAULT 1
    CHECK (configuration_version > 0),
  updated_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (provider = 'off' AND readiness = 'disabled')
    OR (provider = 'supermemory' AND readiness <> 'disabled')
  )
);

CREATE TABLE public.context_workspace_setting_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL
    REFERENCES public.companies(id) ON DELETE CASCADE,
  configuration_version BIGINT NOT NULL CHECK (configuration_version > 0),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('initialized', 'updated')),
  previous_provider TEXT CHECK (
    previous_provider IS NULL OR previous_provider IN ('off', 'supermemory')
  ),
  provider TEXT NOT NULL CHECK (provider IN ('off', 'supermemory')),
  previous_sandbox_enabled BOOLEAN,
  sandbox_enabled BOOLEAN NOT NULL,
  previous_readiness TEXT CHECK (
    previous_readiness IS NULL
    OR previous_readiness IN ('disabled', 'not_ready', 'ready', 'error')
  ),
  readiness TEXT NOT NULL
    CHECK (readiness IN ('disabled', 'not_ready', 'ready', 'error')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, configuration_version),
  CHECK (
    (
      change_kind = 'initialized'
      AND configuration_version = 1
      AND previous_provider IS NULL
      AND previous_sandbox_enabled IS NULL
      AND previous_readiness IS NULL
    )
    OR (
      change_kind = 'updated'
      AND configuration_version > 1
      AND previous_provider IS NOT NULL
      AND previous_sandbox_enabled IS NOT NULL
      AND previous_readiness IS NOT NULL
    )
  )
);

CREATE FUNCTION workflow_private.context_field_paths_are_safe(paths TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT paths IS NOT NULL
    AND cardinality(paths) BETWEEN 0 AND 100
    AND cardinality(paths) = (
      SELECT count(DISTINCT field_path)::INTEGER
      FROM unnest(paths) AS field_path
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(paths) AS field_path
      WHERE field_path IS NULL
        OR length(field_path) NOT BETWEEN 2 AND 300
        OR field_path !~ '^/(?:[^~/]|~0|~1)+(?:/(?:[^~/]|~0|~1)+)*$'
        OR field_path ~ '(^|/)(__proto__|constructor|prototype)(/|$)'
        OR lower(regexp_replace(field_path, '[^a-zA-Z0-9]', '', 'g'))
          ~ '(password|passwd|secret|token|credential|authorization|apikey|accesskey|privatekey|cookie|prompt|systeminstruction|bearer|sessionkey)'
    )
$$;

CREATE TABLE public.context_indexing_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL
    REFERENCES public.companies(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (
    length(source_key) BETWEEN 1 AND 150
    AND source_key ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  record_type TEXT NOT NULL CHECK (
    length(record_type) BETWEEN 1 AND 150
    AND record_type ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  policy_version BIGINT NOT NULL CHECK (policy_version > 0),
  indexing_enabled BOOLEAN NOT NULL DEFAULT false,
  approved_field_paths TEXT[] NOT NULL DEFAULT '{}'::TEXT[]
    CHECK (workflow_private.context_field_paths_are_safe(approved_field_paths)),
  maximum_content_bytes INTEGER NOT NULL DEFAULT 65536
    CHECK (maximum_content_bytes BETWEEN 1 AND 1048576),
  classification TEXT NOT NULL
    CHECK (classification IN ('internal', 'confidential')),
  retention_days INTEGER NOT NULL
    CHECK (retention_days BETWEEN 1 AND 3650),
  projection_version INTEGER NOT NULL CHECK (projection_version > 0),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_key, record_type, policy_version),
  CHECK (
    (indexing_enabled AND cardinality(approved_field_paths) BETWEEN 1 AND 100)
    OR (NOT indexing_enabled AND cardinality(approved_field_paths) = 0)
  )
);

COMMENT ON TABLE public.context_indexing_policy_versions IS
  'Immutable provider-indexing policy history. The highest policy_version for a company/source/type scope is authoritative; absence or an indexing_enabled=false latest version denies indexing.';

CREATE INDEX context_setting_audits_company_created_idx
  ON public.context_workspace_setting_audits(company_id, created_at DESC);
CREATE INDEX context_indexing_policies_scope_version_idx
  ON public.context_indexing_policy_versions(
    company_id, source_key, record_type, policy_version DESC
  );

ALTER TABLE public.context_workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_workspace_setting_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_indexing_policy_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY context_workspace_settings_member_select
  ON public.context_workspace_settings FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY context_workspace_setting_audits_member_select
  ON public.context_workspace_setting_audits FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY context_indexing_policy_versions_member_select
  ON public.context_indexing_policy_versions FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

REVOKE ALL ON TABLE
  public.context_workspace_settings,
  public.context_workspace_setting_audits,
  public.context_indexing_policy_versions
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.context_workspace_settings,
  public.context_workspace_setting_audits,
  public.context_indexing_policy_versions
TO authenticated, service_role;

CREATE FUNCTION workflow_private.reject_context_immutable_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Preserve the repository's intentional company-deletion cascade while
  -- rejecting every direct mutation of immutable Context history.
  IF TG_OP = 'DELETE'
    AND pg_trigger_depth() > 1
    AND NOT EXISTS (
      SELECT 1 FROM public.companies company WHERE company.id = OLD.company_id
    )
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'immutable_workflow_record' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER context_workspace_setting_audits_immutable
BEFORE UPDATE OR DELETE ON public.context_workspace_setting_audits
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_context_immutable_change();

CREATE TRIGGER context_indexing_policy_versions_immutable
BEFORE UPDATE OR DELETE ON public.context_indexing_policy_versions
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_context_immutable_change();

CREATE FUNCTION workflow_private.initialize_context_workspace_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted_company_id UUID;
BEGIN
  INSERT INTO public.context_workspace_settings(company_id, updated_by)
  VALUES (NEW.id, NEW.created_by)
  ON CONFLICT (company_id) DO NOTHING
  RETURNING company_id INTO inserted_company_id;

  IF inserted_company_id IS NOT NULL THEN
    INSERT INTO public.context_workspace_setting_audits(
      company_id,
      configuration_version,
      change_kind,
      previous_provider,
      provider,
      previous_sandbox_enabled,
      sandbox_enabled,
      previous_readiness,
      readiness,
      reason,
      actor_id
    ) VALUES (
      NEW.id,
      1,
      'initialized',
      NULL,
      'off',
      NULL,
      true,
      NULL,
      'disabled',
      'Context initialized safely for the workspace.',
      NEW.created_by
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_initialize_context_workspace_settings
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION workflow_private.initialize_context_workspace_settings();

WITH inserted AS (
  INSERT INTO public.context_workspace_settings(company_id, updated_by)
  SELECT company.id, company.created_by
  FROM public.companies company
  ON CONFLICT (company_id) DO NOTHING
  RETURNING company_id, updated_by
)
INSERT INTO public.context_workspace_setting_audits(
  company_id,
  configuration_version,
  change_kind,
  previous_provider,
  provider,
  previous_sandbox_enabled,
  sandbox_enabled,
  previous_readiness,
  readiness,
  reason,
  actor_id
)
SELECT
  inserted.company_id,
  1,
  'initialized',
  NULL,
  'off',
  NULL,
  true,
  NULL,
  'disabled',
  'Context initialized safely for the workspace.',
  inserted.updated_by
FROM inserted;

CREATE FUNCTION public.set_context_workspace_configuration_v1(
  p_company_id UUID,
  p_expected_configuration_version BIGINT,
  p_provider TEXT,
  p_sandbox_enabled BOOLEAN,
  p_readiness TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  current_setting public.context_workspace_settings%ROWTYPE;
  next_version BIGINT;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', actor);

  IF p_expected_configuration_version IS NULL
    OR p_expected_configuration_version < 1
    OR p_provider IS NULL
    OR p_provider NOT IN ('off', 'supermemory')
    OR p_sandbox_enabled IS NULL
    OR p_readiness IS NULL
    OR p_readiness NOT IN ('disabled', 'not_ready', 'ready', 'error')
    OR length(trim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 1000
    OR (p_provider = 'off' AND p_readiness <> 'disabled')
    OR (p_provider = 'supermemory' AND p_readiness = 'disabled')
  THEN
    RAISE EXCEPTION 'invalid_context_workspace_configuration'
      USING ERRCODE = '22023';
  END IF;

  SELECT setting.* INTO current_setting
  FROM public.context_workspace_settings setting
  WHERE setting.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_workspace_configuration_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF current_setting.configuration_version <> p_expected_configuration_version THEN
    RAISE EXCEPTION 'stale_context_workspace_configuration'
      USING ERRCODE = '40001';
  END IF;
  IF current_setting.provider = p_provider
    AND current_setting.sandbox_enabled = p_sandbox_enabled
    AND current_setting.readiness = p_readiness
  THEN
    RAISE EXCEPTION 'context_workspace_configuration_unchanged'
      USING ERRCODE = '22023';
  END IF;

  next_version := current_setting.configuration_version + 1;
  UPDATE public.context_workspace_settings
  SET provider = p_provider,
      sandbox_enabled = p_sandbox_enabled,
      readiness = p_readiness,
      configuration_version = next_version,
      updated_by = actor,
      updated_at = clock_timestamp()
  WHERE company_id = p_company_id;

  INSERT INTO public.context_workspace_setting_audits(
    company_id,
    configuration_version,
    change_kind,
    previous_provider,
    provider,
    previous_sandbox_enabled,
    sandbox_enabled,
    previous_readiness,
    readiness,
    reason,
    actor_id
  ) VALUES (
    p_company_id,
    next_version,
    'updated',
    current_setting.provider,
    p_provider,
    current_setting.sandbox_enabled,
    p_sandbox_enabled,
    current_setting.readiness,
    p_readiness,
    trim(p_reason),
    actor
  );

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'context_workspace_configuration_changed',
    'Context workspace configuration changed.',
    jsonb_build_object(
      'previousVersion', current_setting.configuration_version,
      'configurationVersion', next_version,
      'provider', p_provider,
      'sandboxEnabled', p_sandbox_enabled,
      'readiness', p_readiness
    )
  );

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'provider', p_provider,
    'sandboxEnabled', p_sandbox_enabled,
    'readiness', p_readiness,
    'configurationVersion', next_version,
    'updatedBy', actor
  );
END;
$$;

CREATE FUNCTION public.publish_context_indexing_policy_v1(
  p_company_id UUID,
  p_source_key TEXT,
  p_record_type TEXT,
  p_expected_current_version BIGINT,
  p_indexing_enabled BOOLEAN,
  p_approved_field_paths TEXT[],
  p_maximum_content_bytes INTEGER,
  p_classification TEXT,
  p_retention_days INTEGER,
  p_projection_version INTEGER,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  source_id UUID;
  current_version BIGINT;
  next_version BIGINT;
  policy_id UUID;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', actor);

  IF p_source_key IS NULL
    OR length(p_source_key) NOT BETWEEN 1 AND 150
    OR p_source_key !~ '^[a-z0-9][a-z0-9._-]*$'
    OR p_record_type IS NULL
    OR length(p_record_type) NOT BETWEEN 1 AND 150
    OR p_record_type !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    OR p_expected_current_version IS NULL
    OR p_expected_current_version < 0
    OR p_indexing_enabled IS NULL
    OR NOT workflow_private.context_field_paths_are_safe(p_approved_field_paths)
    OR (p_indexing_enabled AND cardinality(p_approved_field_paths) NOT BETWEEN 1 AND 100)
    OR (NOT p_indexing_enabled AND cardinality(p_approved_field_paths) <> 0)
    OR p_maximum_content_bytes IS NULL
    OR p_maximum_content_bytes NOT BETWEEN 1 AND 1048576
    OR p_classification IS NULL
    OR p_classification NOT IN ('internal', 'confidential')
    OR p_retention_days IS NULL
    OR p_retention_days NOT BETWEEN 1 AND 3650
    OR p_projection_version IS NULL
    OR p_projection_version < 1
    OR length(trim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid_context_indexing_policy'
      USING ERRCODE = '22023';
  END IF;

  SELECT source.id INTO source_id
  FROM public.external_sources source
  WHERE source.company_id = p_company_id
    AND source.source_key = p_source_key
  FOR UPDATE;

  IF source_id IS NULL THEN
    RAISE EXCEPTION 'context_indexing_policy_source_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(max(policy.policy_version), 0)
  INTO current_version
  FROM public.context_indexing_policy_versions policy
  WHERE policy.company_id = p_company_id
    AND policy.source_key = p_source_key
    AND policy.record_type = p_record_type;

  IF current_version <> p_expected_current_version THEN
    RAISE EXCEPTION 'stale_context_indexing_policy'
      USING ERRCODE = '40001';
  END IF;

  next_version := current_version + 1;
  INSERT INTO public.context_indexing_policy_versions(
    company_id,
    source_key,
    record_type,
    policy_version,
    indexing_enabled,
    approved_field_paths,
    maximum_content_bytes,
    classification,
    retention_days,
    projection_version,
    reason,
    created_by
  ) VALUES (
    p_company_id,
    p_source_key,
    p_record_type,
    next_version,
    p_indexing_enabled,
    p_approved_field_paths,
    p_maximum_content_bytes,
    p_classification,
    p_retention_days,
    p_projection_version,
    trim(p_reason),
    actor
  )
  RETURNING id INTO policy_id;

  PERFORM workflow_private.record_company_security_audit(
    p_company_id,
    'context_indexing_policy_published',
    'Context provider-indexing policy published.',
    jsonb_build_object(
      'policyId', policy_id,
      'sourceKey', p_source_key,
      'recordType', p_record_type,
      'policyVersion', next_version,
      'indexingEnabled', p_indexing_enabled,
      'approvedFieldCount', cardinality(p_approved_field_paths),
      'maximumContentBytes', p_maximum_content_bytes,
      'classification', p_classification,
      'retentionDays', p_retention_days,
      'projectionVersion', p_projection_version
    )
  );

  RETURN jsonb_build_object(
    'policyId', policy_id,
    'companyId', p_company_id,
    'sourceKey', p_source_key,
    'recordType', p_record_type,
    'policyVersion', next_version,
    'indexingEnabled', p_indexing_enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION workflow_private.context_field_paths_are_safe(TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.reject_context_immutable_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.initialize_context_workspace_settings()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_context_workspace_configuration_v1(
  UUID, BIGINT, TEXT, BOOLEAN, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_context_indexing_policy_v1(
  UUID, TEXT, TEXT, BIGINT, BOOLEAN, TEXT[], INTEGER, TEXT, INTEGER, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_context_workspace_configuration_v1(
  UUID, BIGINT, TEXT, BOOLEAN, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_context_indexing_policy_v1(
  UUID, TEXT, TEXT, BIGINT, BOOLEAN, TEXT[], INTEGER, TEXT, INTEGER, INTEGER, TEXT
) TO authenticated;
