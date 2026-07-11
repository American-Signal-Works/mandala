-- Durable identity and authorization records for company-scoped access.
-- Application permission checks remain a fast preflight; database membership,
-- RLS, and checked RPCs remain authoritative for state changes.

ALTER FUNCTION public.touch_updated_at() SET search_path = '';

CREATE OR REPLACE FUNCTION public.company_role_rank(role TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE role
    WHEN 'owner' THEN 60
    WHEN 'admin' THEN 50
    WHEN 'approver' THEN 40
    WHEN 'member' THEN 30
    WHEN 'viewer' THEN 20
    WHEN 'agent' THEN 10
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.has_company_role(
  target_company_id UUID,
  minimum_role TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    public.company_role_rank(minimum_role) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.company_memberships membership
      WHERE membership.company_id = target_company_id
        AND membership.user_id = (SELECT auth.uid())
        AND membership.status = 'active'
        AND public.company_role_rank(membership.role)
          >= public.company_role_rank(minimum_role)
    ),
    false
  )
$$;

ALTER TABLE public.company_memberships
  DROP CONSTRAINT company_memberships_status_check,
  ADD CONSTRAINT company_memberships_status_check
    CHECK (status IN ('invited', 'active', 'disabled', 'removed')),
  ADD CONSTRAINT company_memberships_id_company_key UNIQUE (id, company_id);

ALTER TABLE public.company_approval_policies
  ADD CONSTRAINT company_approval_policies_id_company_key
  UNIQUE (id, company_id);

CREATE TABLE public.company_membership_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL
    CHECK (action IN ('bootstrap', 'invite', 'activate', 'disable', 'remove', 'change_role', 'leave')),
  previous_status TEXT
    CHECK (previous_status IS NULL OR previous_status IN ('invited', 'active', 'disabled', 'removed')),
  previous_role TEXT
    CHECK (previous_role IS NULL OR previous_role IN ('owner', 'admin', 'approver', 'member', 'viewer', 'agent')),
  next_status TEXT NOT NULL
    CHECK (next_status IN ('invited', 'active', 'disabled', 'removed')),
  next_role TEXT NOT NULL
    CHECK (next_role IN ('owner', 'admin', 'approver', 'member', 'viewer', 'agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, company_id)
    REFERENCES public.company_memberships(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX company_membership_events_company_created_idx
  ON public.company_membership_events (company_id, created_at DESC);

CREATE TABLE public.company_principals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL
    CHECK (principal_type IN ('user', 'agent', 'system', 'integration')),
  membership_id UUID,
  principal_key TEXT,
  display_name TEXT,
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'disabled')),
  capabilities TEXT[] NOT NULL DEFAULT '{}'::TEXT[]
    CHECK (
      capabilities <@ ARRAY[
        'company.context.read',
        'membership.manage',
        'policy.read',
        'policy.manage',
        'workflow.read',
        'workflow.run',
        'workflow.fixture.run',
        'workflow.decision.approve',
        'workflow.decision.edit',
        'workflow.decision.reject',
        'workflow.decision.request_rework',
        'workflow.execution_token.issue',
        'workflow.execution.mock'
      ]::TEXT[]
    ),
  delegated_by_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  UNIQUE (membership_id),
  UNIQUE (company_id, principal_type, principal_key),
  FOREIGN KEY (membership_id, company_id)
    REFERENCES public.company_memberships(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, delegated_by_user_id)
    REFERENCES public.company_memberships(company_id, user_id) ON DELETE RESTRICT,
  CHECK (array_position(capabilities, NULL) IS NULL),
  CHECK (
    (principal_type = 'user' AND delegated_by_user_id IS NULL)
    OR (principal_type <> 'user' AND delegated_by_user_id IS NOT NULL)
  ),
  CHECK (
    (
      principal_type = 'user'
      AND membership_id IS NOT NULL
      AND principal_key IS NULL
      AND cardinality(capabilities) = 0
    )
    OR
    (
      principal_type <> 'user'
      AND membership_id IS NULL
      AND principal_key IS NOT NULL
      AND length(btrim(principal_key)) > 0
    )
  )
);

CREATE INDEX company_principals_company_type_idx
  ON public.company_principals (company_id, principal_type, state);

CREATE TABLE public.company_policy_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL,
  permission TEXT NOT NULL
    CHECK (permission IN (
      'company.context.read',
      'membership.manage',
      'policy.read',
      'policy.manage',
      'workflow.read',
      'workflow.run',
      'workflow.fixture.run',
      'workflow.decision.approve',
      'workflow.decision.edit',
      'workflow.decision.reject',
      'workflow.decision.request_rework',
      'workflow.execution_token.issue',
      'workflow.execution.mock'
    )),
  execution_mode TEXT NOT NULL
    CHECK (execution_mode IN ('mock', 'dry_run', 'shadow', 'live')),
  effect TEXT NOT NULL
    CHECK (effect IN ('allow', 'deny', 'requires_approval')),
  reason TEXT NOT NULL
    CHECK (reason IN (
      'policy_satisfied',
      'principal_inactive',
      'permission_missing',
      'human_principal_required',
      'execution_mode_disabled',
      'approval_rejected',
      'human_approval_required',
      'warning_acknowledgement_required'
    )),
  policy_version TEXT NOT NULL
    CHECK (policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  evaluation_key TEXT NOT NULL UNIQUE
    CHECK (evaluation_key ~ '^[0-9a-f]{64}$'),
  principal_snapshot JSONB NOT NULL
    CHECK (jsonb_typeof(principal_snapshot) = 'object'),
  evaluation_context JSONB NOT NULL
    CHECK (jsonb_typeof(evaluation_context) = 'object'),
  approval_policy_id UUID,
  approval_policy_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(approval_policy_snapshot) = 'object'),
  workflow_run_id UUID,
  action_draft_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (principal_id, company_id)
    REFERENCES public.company_principals(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (approval_policy_id, company_id)
    REFERENCES public.company_approval_policies(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id, company_id)
    REFERENCES public.workflow_runs(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (action_draft_id, company_id)
    REFERENCES public.workflow_action_drafts(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX company_policy_decisions_company_created_idx
  ON public.company_policy_decisions (company_id, created_at DESC);
CREATE INDEX company_policy_decisions_principal_created_idx
  ON public.company_policy_decisions (principal_id, created_at DESC);

CREATE TRIGGER company_principals_touch
BEFORE UPDATE ON public.company_principals
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE SCHEMA IF NOT EXISTS identity_private;
REVOKE ALL ON SCHEMA identity_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION identity_private.lock_company_membership_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM company.id
  FROM public.companies company
  WHERE company.id = OLD.company_id
  FOR UPDATE;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_memberships_00_lock_company_update
BEFORE UPDATE OF status, role ON public.company_memberships
FOR EACH ROW EXECUTE FUNCTION identity_private.lock_company_membership_change();

CREATE TRIGGER company_memberships_00_lock_company_delete
BEFORE DELETE ON public.company_memberships
FOR EACH ROW EXECUTE FUNCTION identity_private.lock_company_membership_change();

CREATE FUNCTION identity_private.guard_last_active_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  remaining_owner_count BIGINT;
BEGIN
  IF OLD.status <> 'active'
    OR OLD.role <> 'owner'
    OR (
      TG_OP = 'UPDATE'
      AND NEW.status = 'active'
      AND NEW.role = 'owner'
  )
  THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- A company cascade may already have removed the parent row; in that case
  -- the company and its memberships are intentionally being deleted together.
  PERFORM company.id
  FROM public.companies company
  WHERE company.id = OLD.company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT count(*)
  INTO remaining_owner_count
  FROM public.company_memberships membership
  WHERE membership.company_id = OLD.company_id
    AND membership.id <> OLD.id
    AND membership.status = 'active'
    AND membership.role = 'owner';

  IF remaining_owner_count = 0 THEN
    RAISE EXCEPTION 'last_active_owner' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_memberships_guard_last_owner_update
BEFORE UPDATE OF status, role ON public.company_memberships
FOR EACH ROW EXECUTE FUNCTION identity_private.guard_last_active_owner();

CREATE TRIGGER company_memberships_guard_last_owner_delete
BEFORE DELETE ON public.company_memberships
FOR EACH ROW EXECUTE FUNCTION identity_private.guard_last_active_owner();

CREATE FUNCTION identity_private.validate_company_principal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  capability_count BIGINT;
  distinct_capability_count BIGINT;
BEGIN
  SELECT count(*), count(DISTINCT capability)
  INTO capability_count, distinct_capability_count
  FROM unnest(NEW.capabilities) capability;

  IF capability_count <> distinct_capability_count THEN
    RAISE EXCEPTION 'duplicate_principal_capability' USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'active' AND NEW.delegated_by_user_id IS NOT NULL THEN
    -- Shares the membership-transition lock so concurrent revocation cannot
    -- race an active principal into existence with a stale delegator check.
    PERFORM company.id
    FROM public.companies company
    WHERE company.id = NEW.company_id
    FOR UPDATE;

    IF NOT EXISTS (
      SELECT 1
      FROM public.company_memberships membership
      WHERE membership.company_id = NEW.company_id
        AND membership.user_id = NEW.delegated_by_user_id
        AND membership.status = 'active'
    ) THEN
      RAISE EXCEPTION 'active_company_delegator_required' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER company_principals_validate
BEFORE INSERT OR UPDATE ON public.company_principals
FOR EACH ROW EXECUTE FUNCTION identity_private.validate_company_principal();

CREATE FUNCTION identity_private.reject_immutable_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1
    FROM public.companies company
    WHERE company.id = OLD.company_id
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'immutable_authorization_record' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER company_membership_events_immutable
BEFORE UPDATE OR DELETE ON public.company_membership_events
FOR EACH ROW EXECUTE FUNCTION identity_private.reject_immutable_change();

CREATE TRIGGER company_policy_decisions_immutable
BEFORE UPDATE OR DELETE ON public.company_policy_decisions
FOR EACH ROW EXECUTE FUNCTION identity_private.reject_immutable_change();

CREATE FUNCTION identity_private.sync_membership_principal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.company_principals (
    company_id,
    principal_type,
    membership_id,
    state,
    capabilities
  )
  VALUES (
    NEW.company_id,
    'user',
    NEW.id,
    CASE WHEN NEW.status = 'active' THEN 'active' ELSE 'disabled' END,
    '{}'::TEXT[]
  )
  ON CONFLICT (membership_id) DO UPDATE
  SET
    company_id = EXCLUDED.company_id,
    state = EXCLUDED.state,
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER company_memberships_sync_principal
AFTER INSERT OR UPDATE OF status ON public.company_memberships
FOR EACH ROW EXECUTE FUNCTION identity_private.sync_membership_principal();

CREATE FUNCTION identity_private.disable_delegated_principals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    UPDATE public.company_principals
    SET state = 'disabled', updated_at = now()
    WHERE company_id = NEW.company_id
      AND delegated_by_user_id = NEW.user_id
      AND principal_type <> 'user'
      AND state = 'active';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER company_memberships_disable_delegated_principals
AFTER UPDATE OF status ON public.company_memberships
FOR EACH ROW EXECUTE FUNCTION identity_private.disable_delegated_principals();

CREATE FUNCTION identity_private.record_bootstrap_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active'
    AND NEW.role = 'owner'
    AND EXISTS (
      SELECT 1
      FROM public.companies company
      WHERE company.id = NEW.company_id
        AND company.created_by = NEW.user_id
    )
    AND (
      SELECT count(*)
      FROM public.company_memberships membership
      WHERE membership.company_id = NEW.company_id
    ) = 1
  THEN
    INSERT INTO public.company_membership_events (
      company_id,
      membership_id,
      actor_user_id,
      target_user_id,
      action,
      previous_status,
      previous_role,
      next_status,
      next_role
    )
    VALUES (
      NEW.company_id,
      NEW.id,
      NEW.user_id,
      NEW.user_id,
      'bootstrap',
      NULL,
      NULL,
      NEW.status,
      NEW.role
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER company_memberships_record_bootstrap
AFTER INSERT ON public.company_memberships
FOR EACH ROW EXECUTE FUNCTION identity_private.record_bootstrap_membership();

INSERT INTO public.company_principals (
  company_id,
  principal_type,
  membership_id,
  state,
  capabilities
)
SELECT
  membership.company_id,
  'user',
  membership.id,
  CASE WHEN membership.status = 'active' THEN 'active' ELSE 'disabled' END,
  '{}'::TEXT[]
FROM public.company_memberships membership
ON CONFLICT (membership_id) DO NOTHING;

CREATE FUNCTION identity_private.transition_company_membership(
  p_company_id UUID,
  p_target_user_id UUID,
  p_action TEXT,
  p_requested_role TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_user_id UUID := (SELECT auth.uid());
  actor_role TEXT;
  target_membership public.company_memberships%ROWTYPE;
  target_exists BOOLEAN;
  previous_status TEXT;
  previous_role TEXT;
  active_owner_count BIGINT;
BEGIN
  IF actor_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_action IS NULL OR p_action NOT IN (
    'invite', 'activate', 'disable', 'remove', 'change_role', 'leave'
  ) THEN
    RAISE EXCEPTION 'invalid_membership_action' USING ERRCODE = '22023';
  END IF;

  IF p_requested_role IS NOT NULL AND p_requested_role NOT IN (
    'owner', 'admin', 'approver', 'member', 'viewer', 'agent'
  ) THEN
    RAISE EXCEPTION 'invalid_membership_role' USING ERRCODE = '22023';
  END IF;

  -- Serializes owner-count checks and all membership transitions per company.
  PERFORM company.id
  FROM public.companies company
  WHERE company.id = p_company_id
  FOR UPDATE;

  -- Read authority only after the company lock so a concurrent revocation
  -- cannot leave this transaction with a stale privileged role.
  SELECT membership.role
  INTO actor_role
  FROM public.company_memberships membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = actor_user_id
    AND membership.status = 'active';

  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'membership_management_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'leave' THEN
    IF p_target_user_id <> actor_user_id THEN
      RAISE EXCEPTION 'self_leave_only' USING ERRCODE = '42501';
    END IF;
  ELSIF actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'membership_management_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO target_membership
  FROM public.company_memberships membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = p_target_user_id
  FOR UPDATE;
  target_exists := FOUND;

  IF p_action = 'leave' THEN
    IF NOT target_exists OR target_membership.status <> 'active' THEN
      RAISE EXCEPTION 'invalid_membership_transition' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF actor_role <> 'owner' AND (
      (target_exists AND target_membership.role = 'owner')
      OR p_requested_role = 'owner'
    ) THEN
      RAISE EXCEPTION 'owner_permission_required' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF target_exists
    AND target_membership.status = 'active'
    AND target_membership.role = 'owner'
    AND (
      p_action IN ('disable', 'remove', 'leave')
      OR (p_action = 'change_role' AND p_requested_role <> 'owner')
    )
  THEN
    SELECT count(*)
    INTO active_owner_count
    FROM public.company_memberships membership
    WHERE membership.company_id = p_company_id
      AND membership.role = 'owner'
      AND membership.status = 'active';

    IF active_owner_count <= 1 THEN
      RAISE EXCEPTION 'last_active_owner' USING ERRCODE = '55000';
    END IF;
  END IF;

  previous_status := CASE WHEN target_exists THEN target_membership.status END;
  previous_role := CASE WHEN target_exists THEN target_membership.role END;

  CASE p_action
    WHEN 'invite' THEN
      IF p_requested_role IS NULL THEN
        RAISE EXCEPTION 'requested_role_required' USING ERRCODE = '22023';
      END IF;
      IF target_exists AND target_membership.status <> 'removed' THEN
        RAISE EXCEPTION 'invalid_membership_transition' USING ERRCODE = '22023';
      END IF;

      IF target_exists THEN
        UPDATE public.company_memberships
        SET role = p_requested_role, status = 'invited', updated_at = now()
        WHERE id = target_membership.id
        RETURNING * INTO target_membership;
      ELSE
        INSERT INTO public.company_memberships (
          company_id,
          user_id,
          role,
          status
        )
        VALUES (
          p_company_id,
          p_target_user_id,
          p_requested_role,
          'invited'
        )
        RETURNING * INTO target_membership;
      END IF;

    WHEN 'activate' THEN
      IF NOT target_exists
        OR target_membership.status NOT IN ('invited', 'disabled')
      THEN
        RAISE EXCEPTION 'invalid_membership_transition' USING ERRCODE = '22023';
      END IF;
      UPDATE public.company_memberships
      SET status = 'active', updated_at = now()
      WHERE id = target_membership.id
      RETURNING * INTO target_membership;

    WHEN 'disable' THEN
      IF NOT target_exists OR target_membership.status <> 'active' THEN
        RAISE EXCEPTION 'invalid_membership_transition' USING ERRCODE = '22023';
      END IF;
      UPDATE public.company_memberships
      SET status = 'disabled', updated_at = now()
      WHERE id = target_membership.id
      RETURNING * INTO target_membership;

    WHEN 'remove' THEN
      IF NOT target_exists OR target_membership.status = 'removed' THEN
        RAISE EXCEPTION 'invalid_membership_transition' USING ERRCODE = '22023';
      END IF;
      UPDATE public.company_memberships
      SET status = 'removed', updated_at = now()
      WHERE id = target_membership.id
      RETURNING * INTO target_membership;

    WHEN 'change_role' THEN
      IF NOT target_exists
        OR target_membership.status = 'removed'
        OR p_requested_role IS NULL
        OR p_requested_role = target_membership.role
      THEN
        RAISE EXCEPTION 'invalid_membership_transition' USING ERRCODE = '22023';
      END IF;
      UPDATE public.company_memberships
      SET role = p_requested_role, updated_at = now()
      WHERE id = target_membership.id
      RETURNING * INTO target_membership;

    WHEN 'leave' THEN
      UPDATE public.company_memberships
      SET status = 'disabled', updated_at = now()
      WHERE id = target_membership.id
      RETURNING * INTO target_membership;
  END CASE;

  INSERT INTO public.company_membership_events (
    company_id,
    membership_id,
    actor_user_id,
    target_user_id,
    action,
    previous_status,
    previous_role,
    next_status,
    next_role
  )
  VALUES (
    p_company_id,
    target_membership.id,
    actor_user_id,
    p_target_user_id,
    p_action,
    previous_status,
    previous_role,
    target_membership.status,
    target_membership.role
  );

  RETURN jsonb_build_object(
    'membershipId', target_membership.id,
    'companyId', target_membership.company_id,
    'userId', target_membership.user_id,
    'status', target_membership.status,
    'role', target_membership.role,
    'action', p_action
  );
END;
$$;

CREATE FUNCTION identity_private.bootstrap_company_owner(
  p_company_id UUID,
  p_owner_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_membership public.company_memberships%ROWTYPE;
BEGIN
  PERFORM company.id
  FROM public.companies company
  WHERE company.id = p_company_id
    AND company.created_by = p_owner_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_owner_bootstrap_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO existing_membership
  FROM public.company_memberships membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = p_owner_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing_membership.user_id = p_owner_user_id
      AND existing_membership.role = 'owner'
      AND existing_membership.status = 'active'
    THEN
      RETURN true;
    END IF;
    RAISE EXCEPTION 'company_owner_already_bootstrapped' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.company_memberships membership
    WHERE membership.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'company_owner_already_bootstrapped' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.company_memberships (company_id, user_id, role, status)
  VALUES (p_company_id, p_owner_user_id, 'owner', 'active');

  RETURN true;
END;
$$;

CREATE FUNCTION public.transition_company_membership(
  p_company_id UUID,
  p_target_user_id UUID,
  p_action TEXT,
  p_requested_role TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT identity_private.transition_company_membership(
    p_company_id,
    p_target_user_id,
    p_action,
    p_requested_role
  )
$$;

CREATE FUNCTION public.bootstrap_company_owner(
  p_company_id UUID,
  p_owner_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT identity_private.bootstrap_company_owner(
    p_company_id,
    p_owner_user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.disable_own_company_membership(
  p_company_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (
    identity_private.transition_company_membership(
      p_company_id,
      (SELECT auth.uid()),
      'leave',
      NULL
    ) ->> 'status'
  ) = 'disabled'
$$;

DROP POLICY IF EXISTS company_memberships_self_select
  ON public.company_memberships;
CREATE POLICY company_memberships_self_or_admin_select
  ON public.company_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.has_company_role(company_id, 'admin')
  );

ALTER TABLE public.company_membership_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_policy_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_membership_events_admin_select
  ON public.company_membership_events
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'admin'));

CREATE POLICY company_principals_member_select
  ON public.company_principals
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY company_policy_decisions_member_select
  ON public.company_policy_decisions
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

REVOKE ALL ON TABLE
  public.company_membership_events,
  public.company_principals,
  public.company_policy_decisions
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.company_membership_events,
  public.company_principals,
  public.company_policy_decisions
TO authenticated;

GRANT SELECT ON TABLE public.company_membership_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_principals
  TO service_role;
GRANT SELECT, INSERT ON TABLE public.company_policy_decisions TO service_role;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.company_memberships
  FROM service_role;

REVOKE ALL ON FUNCTION identity_private.guard_last_active_owner()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION identity_private.lock_company_membership_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION identity_private.validate_company_principal()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION identity_private.reject_immutable_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION identity_private.sync_membership_principal()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION identity_private.disable_delegated_principals()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION identity_private.record_bootstrap_membership()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION identity_private.transition_company_membership(
  UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION identity_private.bootstrap_company_owner(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transition_company_membership(
  UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_company_owner(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.disable_own_company_membership(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_role_rank(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_company_role(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_company_membership(
  UUID, UUID, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_company_owner(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.disable_own_company_membership(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_role_rank(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_company_role(UUID, TEXT) TO authenticated;
