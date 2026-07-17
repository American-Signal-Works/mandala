-- Keep the public Sandbox RPC security-invoker while avoiding repeated RLS
-- membership checks across every external record in the bounded projection.
--
-- The original function already performs an explicit has_company_role() gate.
-- Moving that implementation into a non-exposed SECURITY DEFINER helper lets
-- it authorize once and read the selected company's records without evaluating
-- the same RLS membership function tens of thousands of times. The public API
-- remains an authenticated-only SECURITY INVOKER wrapper.

CREATE SCHEMA IF NOT EXISTS sandbox_private;
REVOKE ALL ON SCHEMA sandbox_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA sandbox_private TO authenticated, service_role;

ALTER FUNCTION public.get_sandbox_workspace_snapshot_v1(UUID, INTEGER)
  SET SCHEMA sandbox_private;
ALTER FUNCTION sandbox_private.get_sandbox_workspace_snapshot_v1(UUID, INTEGER)
  RENAME TO build_workspace_snapshot_v1;
ALTER FUNCTION sandbox_private.build_workspace_snapshot_v1(UUID, INTEGER)
  SECURITY DEFINER;

REVOKE ALL ON FUNCTION sandbox_private.build_workspace_snapshot_v1(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION sandbox_private.build_workspace_snapshot_v1(UUID, INTEGER)
  TO authenticated, service_role;

CREATE FUNCTION public.get_sandbox_workspace_snapshot_v1(
  p_company_id UUID,
  p_candidate_limit INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT sandbox_private.build_workspace_snapshot_v1(
    p_company_id,
    p_candidate_limit
  )
$$;

REVOKE ALL ON FUNCTION public.get_sandbox_workspace_snapshot_v1(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sandbox_workspace_snapshot_v1(UUID, INTEGER)
  TO authenticated, service_role;

COMMENT ON FUNCTION sandbox_private.build_workspace_snapshot_v1(UUID, INTEGER) IS
  'Private bounded Sandbox projection with an explicit workspace membership gate and owner-level record access.';
COMMENT ON FUNCTION public.get_sandbox_workspace_snapshot_v1(UUID, INTEGER) IS
  'Authenticated security-invoker wrapper for a bounded, read-only, ephemeral workspace Sandbox projection.';
