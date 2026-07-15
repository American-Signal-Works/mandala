-- Cycle 0.0.6: conflict-safe personal identity, safe first-party media,
-- atomic workspace bootstrap, and account-deletion preflight state.

CREATE SCHEMA IF NOT EXISTS profile_private;
CREATE SCHEMA IF NOT EXISTS workspace_private;

REVOKE ALL ON SCHEMA profile_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA workspace_private FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profiles
-- Existing accounts remain incomplete until they provide both canonical names.
-- The pair constraint prevents half-completed identity records while preserving
-- compatibility with historical display_name-only profiles.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN first_name TEXT,
  ADD COLUMN last_name TEXT,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN version BIGINT NOT NULL DEFAULT 1;

UPDATE public.profiles
SET
  first_name = NULLIF(split_part(trim(display_name), ' ', 1), ''),
  last_name = NULLIF(
    trim(substr(trim(display_name), length(split_part(trim(display_name), ' ', 1)) + 1)),
    ''
  )
WHERE display_name IS NOT NULL
  AND trim(display_name) LIKE '% %';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_name_pair_check CHECK (
    (first_name IS NULL AND last_name IS NULL)
    OR (
      first_name = trim(first_name)
      AND last_name = trim(last_name)
      AND length(first_name) BETWEEN 1 AND 80
      AND length(last_name) BETWEEN 1 AND 80
    )
  ),
  ADD CONSTRAINT profiles_version_positive_check CHECK (version > 0),
  ADD CONSTRAINT profiles_avatar_path_check CHECK (
    avatar_path IS NULL
    OR avatar_path ~ ('^' || user_id::TEXT || '/[0-9a-f-]{36}\\.(png|jpg)$')
  );

CREATE FUNCTION profile_private.touch_profile_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_touch_version
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION profile_private.touch_profile_version();

CREATE FUNCTION profile_private.current_profile_identity()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'userId', profile.user_id,
    'firstName', profile.first_name,
    'lastName', profile.last_name,
    'displayName', profile.display_name,
    'avatarPath', profile.avatar_path,
    'timezone', profile.timezone,
    'themeMode', profile.theme_mode,
    'themeAccent', profile.theme_accent,
    'version', profile.version,
    'updatedAt', profile.updated_at
  )
  FROM public.profiles AS profile
  WHERE profile.user_id = (SELECT auth.uid())
$$;

CREATE FUNCTION profile_private.update_profile_identity(
  p_first_name TEXT,
  p_last_name TEXT,
  p_display_name TEXT,
  p_timezone TEXT,
  p_avatar_path TEXT,
  p_expected_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID := (SELECT auth.uid());
  normalized_first_name TEXT := trim(p_first_name);
  normalized_last_name TEXT := trim(p_last_name);
  normalized_display_name TEXT := NULLIF(trim(p_display_name), '');
  updated_profile public.profiles%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF length(normalized_first_name) NOT BETWEEN 1 AND 80
    OR length(normalized_last_name) NOT BETWEEN 1 AND 80
  THEN
    RAISE EXCEPTION 'profile_names_required' USING ERRCODE = '22023';
  END IF;
  IF p_timezone IS NULL
    OR length(p_timezone) NOT BETWEEN 1 AND 100
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone)
  THEN
    RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'invalid_profile_version' USING ERRCODE = '22023';
  END IF;
  IF p_avatar_path IS NOT NULL
    AND p_avatar_path !~ ('^' || caller_id::TEXT || '/[0-9a-f-]{36}\\.(png|jpg)$')
  THEN
    RAISE EXCEPTION 'invalid_avatar_path' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET
    first_name = normalized_first_name,
    last_name = normalized_last_name,
    display_name = COALESCE(
      normalized_display_name,
      normalized_first_name || ' ' || normalized_last_name
    ),
    timezone = p_timezone,
    avatar_path = p_avatar_path
  WHERE user_id = caller_id
    AND version = p_expected_version
  RETURNING * INTO updated_profile;

  IF updated_profile.user_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = caller_id) THEN
      RAISE EXCEPTION 'profile_version_conflict' USING ERRCODE = '40001';
    END IF;
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'firstName', updated_profile.first_name,
    'lastName', updated_profile.last_name,
    'displayName', updated_profile.display_name,
    'avatarPath', updated_profile.avatar_path,
    'timezone', updated_profile.timezone,
    'version', updated_profile.version,
    'updatedAt', updated_profile.updated_at
  );
END;
$$;

CREATE FUNCTION profile_private.update_profile_preferences(
  p_theme_mode TEXT,
  p_theme_accent TEXT,
  p_expected_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID := (SELECT auth.uid());
  updated_profile public.profiles%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_theme_mode NOT IN ('light', 'dark', 'system')
    OR p_theme_accent NOT IN ('default', 'blue', 'emerald', 'rose', 'amber', 'violet')
  THEN
    RAISE EXCEPTION 'invalid_profile_preferences' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'invalid_profile_version' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET theme_mode = p_theme_mode, theme_accent = p_theme_accent
  WHERE user_id = caller_id
    AND version = p_expected_version
  RETURNING * INTO updated_profile;

  IF updated_profile.user_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = caller_id) THEN
      RAISE EXCEPTION 'profile_version_conflict' USING ERRCODE = '40001';
    END IF;
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'themeMode', updated_profile.theme_mode,
    'themeAccent', updated_profile.theme_accent,
    'version', updated_profile.version,
    'updatedAt', updated_profile.updated_at
  );
END;
$$;

CREATE FUNCTION public.get_my_profile_identity()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT profile_private.current_profile_identity()
$$;

CREATE FUNCTION public.update_my_profile_identity(
  p_first_name TEXT,
  p_last_name TEXT,
  p_display_name TEXT,
  p_timezone TEXT,
  p_avatar_path TEXT,
  p_expected_version BIGINT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT profile_private.update_profile_identity(
    p_first_name,
    p_last_name,
    p_display_name,
    p_timezone,
    p_avatar_path,
    p_expected_version
  )
$$;

CREATE FUNCTION public.update_my_profile_preferences(
  p_theme_mode TEXT,
  p_theme_accent TEXT,
  p_expected_version BIGINT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT profile_private.update_profile_preferences(
    p_theme_mode,
    p_theme_accent,
    p_expected_version
  )
$$;

-- Every profile change goes through the checked, versioned functions so a
-- stale browser cannot silently overwrite a newer preference or identity edit.
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;

-- ---------------------------------------------------------------------------
-- Private first-party media
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'avatars',
  'avatars',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'workspace-logos',
  'workspace-logos',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS avatars_select ON storage.objects;
DROP POLICY IF EXISTS avatars_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_update ON storage.objects;
DROP POLICY IF EXISTS avatars_delete ON storage.objects;

CREATE POLICY avatars_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

CREATE POLICY avatars_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

CREATE POLICY avatars_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

CREATE POLICY workspace_logos_member_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'workspace-logos'
    AND CASE
      WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN public.has_company_role(((storage.foldername(name))[1])::UUID, 'viewer')
      ELSE false
    END
  );

CREATE POLICY workspace_logos_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'workspace-logos'
    AND CASE
      WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN public.has_company_role(((storage.foldername(name))[1])::UUID, 'admin')
      ELSE false
    END
  );

CREATE POLICY workspace_logos_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'workspace-logos'
    AND CASE
      WHEN (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN public.has_company_role(((storage.foldername(name))[1])::UUID, 'admin')
      ELSE false
    END
  );

-- ---------------------------------------------------------------------------
-- Workspaces (companies in the durable schema)
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies
  ADD COLUMN logo_path TEXT,
  ADD COLUMN version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN created_by_snapshot UUID;

UPDATE public.companies SET created_by_snapshot = created_by;

ALTER TABLE public.companies
  ALTER COLUMN created_by_snapshot SET NOT NULL,
  ALTER COLUMN created_by DROP NOT NULL,
  DROP CONSTRAINT companies_created_by_fkey,
  ADD CONSTRAINT companies_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT companies_name_check CHECK (
    name = trim(name) AND length(name) BETWEEN 1 AND 120
  ),
  ADD CONSTRAINT companies_version_positive_check CHECK (version > 0),
  ADD CONSTRAINT companies_logo_path_check CHECK (
    logo_path IS NULL
    OR logo_path ~ ('^' || id::TEXT || '/[0-9a-f-]{36}\\.(png|jpg)$')
  );

CREATE FUNCTION workspace_private.prepare_company_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by_snapshot := COALESCE(NEW.created_by_snapshot, NEW.created_by);
  ELSE
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_prepare_identity
BEFORE INSERT OR UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION workspace_private.prepare_company_identity();

CREATE FUNCTION workspace_private.create_company_with_owner(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID := (SELECT auth.uid());
  normalized_name TEXT := trim(p_name);
  created_company public.companies%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF length(normalized_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_company_name' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.companies (name, created_by, created_by_snapshot)
  VALUES (normalized_name, caller_id, caller_id)
  RETURNING * INTO created_company;

  INSERT INTO public.company_memberships (company_id, user_id, role, status)
  VALUES (created_company.id, caller_id, 'owner', 'active');

  RETURN jsonb_build_object(
    'id', created_company.id,
    'name', created_company.name,
    'logoPath', created_company.logo_path,
    'role', 'owner',
    'version', created_company.version,
    'updatedAt', created_company.updated_at
  );
END;
$$;

CREATE FUNCTION workspace_private.update_company_identity(
  p_company_id UUID,
  p_name TEXT,
  p_logo_path TEXT,
  p_expected_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_name TEXT := trim(p_name);
  previous_logo_path TEXT;
  updated_company public.companies%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_company_role(p_company_id, 'admin') THEN
    RAISE EXCEPTION 'company_not_found' USING ERRCODE = '42501';
  END IF;
  IF length(normalized_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid_company_name' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'invalid_company_version' USING ERRCODE = '22023';
  END IF;
  IF p_logo_path IS NOT NULL
    AND p_logo_path !~ ('^' || p_company_id::TEXT || '/[0-9a-f-]{36}\\.(png|jpg)$')
  THEN
    RAISE EXCEPTION 'invalid_company_logo_path' USING ERRCODE = '22023';
  END IF;

  SELECT company.logo_path
  INTO previous_logo_path
  FROM public.companies AS company
  WHERE company.id = p_company_id
    AND company.version = p_expected_version
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company_version_conflict' USING ERRCODE = '40001';
  END IF;

  UPDATE public.companies
  SET name = normalized_name, logo_path = p_logo_path
  WHERE id = p_company_id AND version = p_expected_version
  RETURNING * INTO updated_company;

  IF updated_company.id IS NULL THEN
    RAISE EXCEPTION 'company_version_conflict' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'id', updated_company.id,
    'name', updated_company.name,
    'logoPath', updated_company.logo_path,
    'previousLogoPath', previous_logo_path,
    'version', updated_company.version,
    'updatedAt', updated_company.updated_at
  );
END;
$$;

CREATE FUNCTION workspace_private.get_company_identity(p_company_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.has_company_role(p_company_id, 'viewer') THEN (
      SELECT jsonb_build_object(
        'id', company.id,
        'name', company.name,
        'logoPath', company.logo_path,
        'version', company.version,
        'updatedAt', company.updated_at
      )
      FROM public.companies AS company
      WHERE company.id = p_company_id
    )
    ELSE NULL
  END
$$;

CREATE FUNCTION public.create_company_with_owner(p_name TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workspace_private.create_company_with_owner(p_name)
$$;

CREATE FUNCTION public.update_company_identity(
  p_company_id UUID,
  p_name TEXT,
  p_logo_path TEXT,
  p_expected_version BIGINT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workspace_private.update_company_identity(
    p_company_id,
    p_name,
    p_logo_path,
    p_expected_version
  )
$$;

CREATE FUNCTION public.get_company_identity(p_company_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workspace_private.get_company_identity(p_company_id)
$$;

DROP POLICY IF EXISTS companies_creator_select ON public.companies;
DROP POLICY IF EXISTS companies_insert_own ON public.companies;
DROP POLICY IF EXISTS companies_admin_update ON public.companies;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.companies FROM authenticated;
GRANT SELECT ON TABLE public.companies TO authenticated;

-- ---------------------------------------------------------------------------
-- Safe account-deletion preflight and recoverable state
-- ---------------------------------------------------------------------------

CREATE TABLE public.account_deletion_requests (
  user_id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN ('preflight_passed', 'cleanup_failed', 'sessions_revoked', 'access_revoked', 'auth_deleted', 'completed')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  preflighted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sessions_revoked_at TIMESTAMPTZ,
  auth_deleted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_deletion_requests_self_select
  ON public.account_deletion_requests
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE FUNCTION workspace_private.preflight_account_deletion()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID := (SELECT auth.uid());
  blocked_company_id UUID;
  deletion_request public.account_deletion_requests%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM company.id
  FROM public.companies AS company
  JOIN public.company_memberships AS membership
    ON membership.company_id = company.id
  WHERE membership.user_id = caller_id
    AND membership.role = 'owner'
    AND membership.status = 'active'
  ORDER BY company.id
  FOR UPDATE OF company;

  SELECT membership.company_id
  INTO blocked_company_id
  FROM public.company_memberships AS membership
  WHERE membership.user_id = caller_id
    AND membership.role = 'owner'
    AND membership.status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_memberships AS other_owner
      WHERE other_owner.company_id = membership.company_id
        AND other_owner.user_id <> caller_id
        AND other_owner.role = 'owner'
        AND other_owner.status = 'active'
    )
  ORDER BY membership.company_id
  LIMIT 1;

  IF blocked_company_id IS NOT NULL THEN
    RAISE EXCEPTION 'account_deletion_final_owner' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.account_deletion_requests (
    user_id,
    status,
    attempt_count,
    requested_at,
    preflighted_at,
    last_error_code,
    updated_at
  ) VALUES (
    caller_id,
    'preflight_passed',
    1,
    now(),
    now(),
    NULL,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    status = 'preflight_passed',
    attempt_count = public.account_deletion_requests.attempt_count + 1,
    preflighted_at = now(),
    last_error_code = NULL,
    updated_at = now()
  RETURNING * INTO deletion_request;

  RETURN jsonb_build_object(
    'status', deletion_request.status,
    'attemptCount', deletion_request.attempt_count,
    'preflightedAt', deletion_request.preflighted_at
  );
END;
$$;

CREATE FUNCTION public.preflight_account_deletion()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workspace_private.preflight_account_deletion()
$$;

CREATE FUNCTION workspace_private.record_account_deletion_progress(
  p_user_id UUID,
  p_status TEXT,
  p_error_code TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_status NOT IN ('cleanup_failed', 'sessions_revoked', 'access_revoked', 'auth_deleted', 'completed') THEN
    RAISE EXCEPTION 'invalid_account_deletion_status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_deletion_requests
  SET
    status = p_status,
    sessions_revoked_at = CASE
      WHEN p_status IN ('sessions_revoked', 'access_revoked', 'auth_deleted', 'completed')
        THEN COALESCE(sessions_revoked_at, now())
      ELSE sessions_revoked_at
    END,
    auth_deleted_at = CASE
      WHEN p_status IN ('auth_deleted', 'completed')
        THEN COALESCE(auth_deleted_at, now())
      ELSE auth_deleted_at
    END,
    completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
    last_error_code = CASE WHEN p_status = 'cleanup_failed' THEN p_error_code ELSE NULL END,
    updated_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_request_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION workspace_private.revoke_account_memberships_for_deletion(
  p_user_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  blocked_company_id UUID;
  affected_count INTEGER;
  target_membership public.company_memberships%ROWTYPE;
BEGIN
  PERFORM company.id
  FROM public.companies AS company
  JOIN public.company_memberships AS membership
    ON membership.company_id = company.id
  WHERE membership.user_id = p_user_id
    AND membership.status = 'active'
  ORDER BY company.id
  FOR UPDATE OF company;

  SELECT membership.company_id
  INTO blocked_company_id
  FROM public.company_memberships AS membership
  WHERE membership.user_id = p_user_id
    AND membership.role = 'owner'
    AND membership.status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_memberships AS other_owner
      WHERE other_owner.company_id = membership.company_id
        AND other_owner.user_id <> p_user_id
        AND other_owner.role = 'owner'
        AND other_owner.status = 'active'
    )
  ORDER BY membership.company_id
  LIMIT 1;

  IF blocked_company_id IS NOT NULL THEN
    RAISE EXCEPTION 'account_deletion_final_owner' USING ERRCODE = '23514';
  END IF;

  affected_count := 0;
  FOR target_membership IN
    SELECT membership.*
    FROM public.company_memberships AS membership
    WHERE membership.user_id = p_user_id
      AND membership.status <> 'removed'
    ORDER BY membership.company_id, membership.id
    FOR UPDATE
  LOOP
    UPDATE public.company_memberships
    SET status = 'removed', updated_at = now()
    WHERE id = target_membership.id;

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
    ) VALUES (
      target_membership.company_id,
      target_membership.id,
      p_user_id,
      p_user_id,
      'remove',
      target_membership.status,
      target_membership.role,
      'removed',
      target_membership.role
    );
    affected_count := affected_count + 1;
  END LOOP;
  RETURN affected_count;
END;
$$;

CREATE FUNCTION public.record_account_deletion_progress(
  p_user_id UUID,
  p_status TEXT,
  p_error_code TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workspace_private.record_account_deletion_progress(
    p_user_id,
    p_status,
    p_error_code
  )
$$;

CREATE FUNCTION public.revoke_account_memberships_for_deletion(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workspace_private.revoke_account_memberships_for_deletion(p_user_id)
$$;

REVOKE ALL ON TABLE public.account_deletion_requests
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.account_deletion_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletion_requests TO service_role;

REVOKE ALL ON FUNCTION profile_private.touch_profile_version()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION profile_private.current_profile_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION profile_private.update_profile_identity(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION profile_private.update_profile_preferences(TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workspace_private.prepare_company_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workspace_private.create_company_with_owner(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workspace_private.update_company_identity(UUID, TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workspace_private.get_company_identity(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workspace_private.preflight_account_deletion()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workspace_private.record_account_deletion_progress(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workspace_private.revoke_account_memberships_for_deletion(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_my_profile_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_my_profile_identity(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_my_profile_preferences(TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_company_with_owner(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_company_identity(UUID, TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_company_identity(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preflight_account_deletion()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_account_deletion_progress(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_account_memberships_for_deletion(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_profile_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile_identity(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile_preferences(TEXT, TEXT, BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_with_owner(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_company_identity(UUID, TEXT, TEXT, BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_identity(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preflight_account_deletion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_account_deletion_progress(UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_account_memberships_for_deletion(UUID)
  TO service_role;
