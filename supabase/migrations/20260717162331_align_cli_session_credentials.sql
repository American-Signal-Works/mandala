-- Upgrade legacy hosted CLI sessions to the Mandala-only credential contract.
-- Existing sessions are retained as revoked history because their plaintext
-- client credentials cannot be converted into the new opaque token format.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cli_sessions'
      AND column_name = 'auth_session_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cli_sessions'
      AND column_name = 'actor_auth_session_id'
  ) THEN
    ALTER TABLE public.cli_sessions
      RENAME COLUMN auth_session_id TO actor_auth_session_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_sessions'::regclass
      AND conname = 'cli_sessions_auth_session_id_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_sessions'::regclass
      AND conname = 'cli_sessions_actor_auth_session_id_key'
  ) THEN
    ALTER TABLE public.cli_sessions
      RENAME CONSTRAINT cli_sessions_auth_session_id_key
      TO cli_sessions_actor_auth_session_id_key;
  END IF;
END;
$$;

ALTER TABLE public.cli_sessions
  ADD COLUMN IF NOT EXISTS access_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS actor_session_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ;

UPDATE public.cli_sessions
SET
  access_token_hash = COALESCE(
    access_token_hash,
    md5(id::TEXT || ':legacy-access:1') || md5(id::TEXT || ':legacy-access:2')
  ),
  refresh_token_hash = COALESCE(
    refresh_token_hash,
    md5(id::TEXT || ':legacy-refresh:1') || md5(id::TEXT || ':legacy-refresh:2')
  ),
  actor_session_ciphertext = COALESCE(
    actor_session_ciphertext,
    'legacy-revoked-session:' || id::TEXT
  ),
  access_expires_at = COALESCE(access_expires_at, created_at + INTERVAL '15 minutes'),
  refresh_expires_at = COALESCE(refresh_expires_at, created_at + INTERVAL '30 days'),
  revoked_at = COALESCE(revoked_at, now()),
  revocation_reason = COALESCE(revocation_reason, 'credential_schema_upgrade')
WHERE access_token_hash IS NULL
   OR refresh_token_hash IS NULL
   OR actor_session_ciphertext IS NULL
   OR access_expires_at IS NULL
   OR refresh_expires_at IS NULL;

ALTER TABLE public.cli_sessions
  ALTER COLUMN access_token_hash SET NOT NULL,
  ALTER COLUMN refresh_token_hash SET NOT NULL,
  ALTER COLUMN actor_auth_session_id SET NOT NULL,
  ALTER COLUMN actor_session_ciphertext SET NOT NULL,
  ALTER COLUMN access_expires_at SET NOT NULL,
  ALTER COLUMN refresh_expires_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_sessions'::regclass
      AND conname = 'cli_sessions_access_token_hash_key'
  ) THEN
    ALTER TABLE public.cli_sessions
      ADD CONSTRAINT cli_sessions_access_token_hash_key UNIQUE (access_token_hash);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_sessions'::regclass
      AND conname = 'cli_sessions_refresh_token_hash_key'
  ) THEN
    ALTER TABLE public.cli_sessions
      ADD CONSTRAINT cli_sessions_refresh_token_hash_key UNIQUE (refresh_token_hash);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_sessions'::regclass
      AND conname = 'cli_sessions_access_token_hash_check'
  ) THEN
    ALTER TABLE public.cli_sessions
      ADD CONSTRAINT cli_sessions_access_token_hash_check
      CHECK (access_token_hash ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_sessions'::regclass
      AND conname = 'cli_sessions_refresh_token_hash_check'
  ) THEN
    ALTER TABLE public.cli_sessions
      ADD CONSTRAINT cli_sessions_refresh_token_hash_check
      CHECK (refresh_token_hash ~ '^[a-f0-9]{64}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_sessions'::regclass
      AND conname = 'cli_sessions_actor_session_ciphertext_check'
  ) THEN
    ALTER TABLE public.cli_sessions
      ADD CONSTRAINT cli_sessions_actor_session_ciphertext_check
      CHECK (length(actor_session_ciphertext) BETWEEN 20 AND 20000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_sessions'::regclass
      AND conname = 'cli_sessions_access_expires_at_check'
  ) THEN
    ALTER TABLE public.cli_sessions
      ADD CONSTRAINT cli_sessions_access_expires_at_check
      CHECK (access_expires_at > created_at);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_sessions'::regclass
      AND conname = 'cli_sessions_refresh_expires_at_check'
  ) THEN
    ALTER TABLE public.cli_sessions
      ADD CONSTRAINT cli_sessions_refresh_expires_at_check
      CHECK (refresh_expires_at > access_expires_at);
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.complete_cli_device_authorization_v1(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.complete_cli_device_authorization_v1(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
);
DROP FUNCTION IF EXISTS public.validate_cli_session_v1(TEXT);
DROP FUNCTION IF EXISTS public.inspect_cli_session_refresh_v1(TEXT);
DROP FUNCTION IF EXISTS public.rotate_cli_session_credentials_v1(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
);
DROP FUNCTION IF EXISTS public.revoke_cli_session_v1(UUID, UUID);
DROP FUNCTION IF EXISTS public.revoke_all_cli_sessions_v1(UUID);

CREATE FUNCTION public.complete_cli_device_authorization_v1(
  p_authorization_id UUID,
  p_exchange_nonce UUID,
  p_access_token_hash TEXT,
  p_refresh_token_hash TEXT,
  p_access_expires_at TIMESTAMPTZ,
  p_refresh_expires_at TIMESTAMPTZ,
  p_actor_auth_session_id UUID,
  p_actor_session_ciphertext TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  device_request public.cli_device_authorizations%ROWTYPE;
  session_id UUID;
BEGIN
  PERFORM cli_private.require_service_role();

  SELECT *
  INTO device_request
  FROM public.cli_device_authorizations candidate
  WHERE candidate.id = p_authorization_id
  FOR UPDATE;

  IF NOT FOUND
    OR device_request.status <> 'exchanging'
    OR device_request.exchange_nonce IS DISTINCT FROM p_exchange_nonce
    OR device_request.approved_user_id IS NULL
    OR device_request.selected_company_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_cli_authorization_exchange' USING ERRCODE = '55000';
  END IF;

  IF p_access_token_hash !~ '^[a-f0-9]{64}$'
    OR p_refresh_token_hash !~ '^[a-f0-9]{64}$'
    OR p_access_expires_at <= now() + INTERVAL '2 minutes'
    OR p_access_expires_at > now() + INTERVAL '1 hour'
    OR p_refresh_expires_at <= p_access_expires_at
    OR p_refresh_expires_at > now() + INTERVAL '45 days'
    OR length(COALESCE(p_actor_session_ciphertext, '')) NOT BETWEEN 20 AND 20000
  THEN
    RAISE EXCEPTION 'invalid_cli_session_credentials' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions actor_session
    WHERE actor_session.id = p_actor_auth_session_id
      AND actor_session.user_id = device_request.approved_user_id
  ) THEN
    RAISE EXCEPTION 'invalid_cli_actor_session' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.cli_sessions(
    access_token_hash, refresh_token_hash, actor_auth_session_id,
    actor_session_ciphertext, user_id, selected_company_id, scopes,
    client_name, client_version, client_platform,
    access_expires_at, refresh_expires_at
  ) VALUES (
    p_access_token_hash, p_refresh_token_hash, p_actor_auth_session_id,
    p_actor_session_ciphertext, device_request.approved_user_id,
    device_request.selected_company_id, device_request.requested_scopes,
    device_request.client_name, device_request.client_version,
    device_request.client_platform, p_access_expires_at, p_refresh_expires_at
  )
  RETURNING id INTO session_id;

  UPDATE public.cli_device_authorizations
  SET status = 'consumed', consumed_at = now(), exchange_nonce = NULL, updated_at = now()
  WHERE id = device_request.id;

  RETURN jsonb_build_object(
    'sessionId', session_id,
    'companyId', device_request.selected_company_id
  );
END;
$$;

CREATE FUNCTION public.validate_cli_session_v1(p_access_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cli_session public.cli_sessions%ROWTYPE;
BEGIN
  PERFORM cli_private.require_service_role();
  IF p_access_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  SELECT * INTO cli_session
  FROM public.cli_sessions candidate
  WHERE candidate.access_token_hash = p_access_token_hash
  FOR UPDATE;

  IF NOT FOUND
    OR cli_session.revoked_at IS NOT NULL
    OR cli_session.refresh_expires_at <= now()
  THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users actor
    JOIN auth.sessions actor_session
      ON actor_session.user_id = actor.id
     AND actor_session.id = cli_session.actor_auth_session_id
    JOIN public.company_memberships membership
      ON membership.user_id = actor.id
     AND membership.company_id = cli_session.selected_company_id
     AND membership.status = 'active'
    WHERE actor.id = cli_session.user_id
      AND actor.deleted_at IS NULL
      AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  ) THEN
    UPDATE public.cli_sessions
    SET revoked_at = now(), revocation_reason = 'actor_access_removed'
    WHERE id = cli_session.id AND revoked_at IS NULL;
    DELETE FROM auth.sessions
    WHERE id = cli_session.actor_auth_session_id
      AND user_id = cli_session.user_id;
    RETURN jsonb_build_object('allowed', false);
  END IF;

  IF cli_session.access_expires_at <= now() THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  IF cli_session.last_used_at < now() - INTERVAL '1 minute' THEN
    UPDATE public.cli_sessions SET last_used_at = now() WHERE id = cli_session.id;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'sessionId', cli_session.id,
    'userId', cli_session.user_id,
    'selectedCompanyId', cli_session.selected_company_id,
    'scopes', to_jsonb(cli_session.scopes),
    'actorSessionCiphertext', cli_session.actor_session_ciphertext
  );
END;
$$;

CREATE FUNCTION public.inspect_cli_session_refresh_v1(p_refresh_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cli_session public.cli_sessions%ROWTYPE;
BEGIN
  PERFORM cli_private.require_service_role();
  IF p_refresh_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('error', 'invalid_refresh_token');
  END IF;

  SELECT * INTO cli_session
  FROM public.cli_sessions candidate
  WHERE candidate.refresh_token_hash = p_refresh_token_hash;

  IF NOT FOUND
    OR cli_session.revoked_at IS NOT NULL
    OR cli_session.refresh_expires_at <= now()
  THEN
    RETURN jsonb_build_object('error', 'invalid_refresh_token');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users actor
    JOIN auth.sessions actor_session
      ON actor_session.user_id = actor.id
     AND actor_session.id = cli_session.actor_auth_session_id
    JOIN public.company_memberships membership
      ON membership.user_id = actor.id
     AND membership.company_id = cli_session.selected_company_id
     AND membership.status = 'active'
    WHERE actor.id = cli_session.user_id
      AND actor.deleted_at IS NULL
      AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  ) THEN
    UPDATE public.cli_sessions
    SET revoked_at = now(), revocation_reason = 'actor_access_removed'
    WHERE id = cli_session.id AND revoked_at IS NULL;
    DELETE FROM auth.sessions
    WHERE id = cli_session.actor_auth_session_id
      AND user_id = cli_session.user_id;
    RETURN jsonb_build_object('error', 'invalid_refresh_token');
  END IF;

  RETURN jsonb_build_object('sessionId', cli_session.id, 'userId', cli_session.user_id);
END;
$$;

CREATE FUNCTION public.rotate_cli_session_credentials_v1(
  p_refresh_token_hash TEXT,
  p_next_access_token_hash TEXT,
  p_next_refresh_token_hash TEXT,
  p_access_expires_at TIMESTAMPTZ,
  p_refresh_expires_at TIMESTAMPTZ,
  p_actor_auth_session_id UUID,
  p_actor_session_ciphertext TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cli_session public.cli_sessions%ROWTYPE;
  user_email TEXT;
  old_actor_auth_session_id UUID;
BEGIN
  PERFORM cli_private.require_service_role();
  IF p_refresh_token_hash !~ '^[a-f0-9]{64}$'
    OR p_next_access_token_hash !~ '^[a-f0-9]{64}$'
    OR p_next_refresh_token_hash !~ '^[a-f0-9]{64}$'
    OR p_access_expires_at <= now() + INTERVAL '2 minutes'
    OR p_access_expires_at > now() + INTERVAL '1 hour'
    OR p_refresh_expires_at <= p_access_expires_at
    OR p_refresh_expires_at > now() + INTERVAL '45 days'
    OR length(COALESCE(p_actor_session_ciphertext, '')) NOT BETWEEN 20 AND 20000
  THEN
    RAISE EXCEPTION 'invalid_cli_session_credentials' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO cli_session
  FROM public.cli_sessions candidate
  WHERE candidate.refresh_token_hash = p_refresh_token_hash
  FOR UPDATE;

  IF NOT FOUND
    OR cli_session.revoked_at IS NOT NULL
    OR cli_session.refresh_expires_at <= now()
  THEN
    RETURN jsonb_build_object('error', 'invalid_refresh_token');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users actor
    JOIN auth.sessions old_actor_session
      ON old_actor_session.user_id = actor.id
     AND old_actor_session.id = cli_session.actor_auth_session_id
    JOIN public.company_memberships membership
      ON membership.user_id = actor.id
     AND membership.company_id = cli_session.selected_company_id
     AND membership.status = 'active'
    WHERE actor.id = cli_session.user_id
      AND actor.deleted_at IS NULL
      AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  ) OR NOT EXISTS (
    SELECT 1 FROM auth.sessions new_actor_session
    WHERE new_actor_session.id = p_actor_auth_session_id
      AND new_actor_session.user_id = cli_session.user_id
  ) THEN
    RETURN jsonb_build_object('error', 'actor_session_invalid');
  END IF;

  SELECT auth_user.email INTO user_email
  FROM auth.users auth_user
  WHERE auth_user.id = cli_session.user_id;
  IF user_email IS NULL THEN
    RETURN jsonb_build_object('error', 'user_unavailable');
  END IF;

  old_actor_auth_session_id := cli_session.actor_auth_session_id;
  UPDATE public.cli_sessions
  SET
    access_token_hash = p_next_access_token_hash,
    refresh_token_hash = p_next_refresh_token_hash,
    access_expires_at = p_access_expires_at,
    refresh_expires_at = p_refresh_expires_at,
    actor_auth_session_id = p_actor_auth_session_id,
    actor_session_ciphertext = p_actor_session_ciphertext,
    last_used_at = now()
  WHERE id = cli_session.id;

  DELETE FROM auth.sessions
  WHERE id = old_actor_auth_session_id
    AND user_id = cli_session.user_id;

  RETURN jsonb_build_object(
    'sessionId', cli_session.id,
    'userId', cli_session.user_id,
    'email', user_email
  );
END;
$$;

CREATE FUNCTION public.revoke_cli_session_v1(
  p_actor_user_id UUID,
  p_cli_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cli_session public.cli_sessions%ROWTYPE;
BEGIN
  PERFORM cli_private.require_service_role();
  SELECT * INTO cli_session
  FROM public.cli_sessions candidate
  WHERE candidate.id = p_cli_session_id
    AND candidate.user_id = p_actor_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cli_session_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF cli_session.revoked_at IS NULL THEN
    UPDATE public.cli_sessions
    SET revoked_at = now(), revocation_reason = 'user_revoked'
    WHERE id = cli_session.id;
  END IF;
  DELETE FROM auth.sessions
  WHERE id = cli_session.actor_auth_session_id
    AND user_id = cli_session.user_id;

  RETURN jsonb_build_object('sessionId', cli_session.id, 'revoked', true);
END;
$$;

CREATE FUNCTION public.revoke_all_cli_sessions_v1(p_actor_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  revoked_count INTEGER;
BEGIN
  PERFORM cli_private.require_service_role();
  WITH revoked AS (
    UPDATE public.cli_sessions
    SET revoked_at = now(), revocation_reason = 'user_revoked_all'
    WHERE user_id = p_actor_user_id AND revoked_at IS NULL
    RETURNING actor_auth_session_id
  ), removed AS (
    DELETE FROM auth.sessions actor_session
    USING revoked
    WHERE actor_session.id = revoked.actor_auth_session_id
      AND actor_session.user_id = p_actor_user_id
    RETURNING actor_session.id
  )
  SELECT count(*)::INTEGER INTO revoked_count FROM revoked;

  RETURN jsonb_build_object('revokedCount', revoked_count);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_cli_device_authorization_v1(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_cli_session_v1(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inspect_cli_session_refresh_v1(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_cli_session_credentials_v1(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_cli_session_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_all_cli_sessions_v1(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_cli_device_authorization_v1(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_cli_session_v1(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.inspect_cli_session_refresh_v1(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_cli_session_credentials_v1(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_cli_session_v1(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_all_cli_sessions_v1(UUID)
  TO service_role;

COMMENT ON TABLE public.cli_sessions IS
  'Revocable Mandala API-only CLI sessions. Client credentials are SHA-256 digests; the user-scoped database session is encrypted server-side.';

NOTIFY pgrst, 'reload schema';
