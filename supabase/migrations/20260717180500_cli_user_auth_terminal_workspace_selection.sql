-- Hosted CLI authentication proves user identity in the browser. Workspace
-- selection happens afterward in the terminal and is bound to the managed CLI
-- session only after active membership is revalidated server-side.

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT constraint_record.conname
    FROM pg_catalog.pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'public.cli_device_authorizations'::regclass
      AND constraint_record.contype = 'c'
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%selected_company_id IS NOT NULL%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.cli_device_authorizations DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.cli_device_authorizations
  ADD CONSTRAINT cli_device_authorizations_approved_user_check
  CHECK (
    status NOT IN ('approved', 'exchanging', 'consumed')
    OR approved_user_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.decide_cli_device_authorization_v1(
  p_browser_token_hash TEXT,
  p_subject_hash TEXT,
  p_decision TEXT,
  p_company_id UUID,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  device_request public.cli_device_authorizations%ROWTYPE;
BEGIN
  PERFORM cli_private.require_service_role();
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users actor WHERE actor.id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'invalid_cli_authorization_actor' USING ERRCODE = '22023';
  END IF;
  IF NOT cli_private.record_attempt(
    'decision', p_subject_hash, 10, INTERVAL '5 minutes'
  ) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  IF p_decision NOT IN ('approve', 'deny') THEN
    RETURN jsonb_build_object('error', 'invalid_decision');
  END IF;

  SELECT * INTO device_request
  FROM public.cli_device_authorizations candidate
  WHERE candidate.browser_token_hash = p_browser_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF device_request.expires_at <= now() THEN
    UPDATE public.cli_device_authorizations
    SET status = 'expired', updated_at = now()
    WHERE id = device_request.id AND status IN ('pending', 'approved');
    RETURN jsonb_build_object('error', 'expired');
  END IF;
  IF device_request.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'already_decided');
  END IF;

  IF p_decision = 'deny' THEN
    UPDATE public.cli_device_authorizations
    SET status = 'denied', approved_user_id = p_actor_user_id,
        denied_at = now(), updated_at = now()
    WHERE id = device_request.id;
    RETURN jsonb_build_object('status', 'denied');
  END IF;

  -- p_company_id is retained only for RPC signature compatibility. Browser
  -- authentication never selects a workspace.
  UPDATE public.cli_device_authorizations
  SET status = 'approved', approved_user_id = p_actor_user_id,
      selected_company_id = NULL, approved_at = now(), updated_at = now()
  WHERE id = device_request.id;

  RETURN jsonb_build_object('status', 'approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_cli_device_authorization_v1(
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
  SELECT * INTO device_request
  FROM public.cli_device_authorizations candidate
  WHERE candidate.id = p_authorization_id
  FOR UPDATE;

  IF NOT FOUND
    OR device_request.status <> 'exchanging'
    OR device_request.exchange_nonce IS DISTINCT FROM p_exchange_nonce
    OR device_request.approved_user_id IS NULL
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
    p_actor_session_ciphertext, device_request.approved_user_id, NULL,
    device_request.requested_scopes, device_request.client_name,
    device_request.client_version, device_request.client_platform,
    p_access_expires_at, p_refresh_expires_at
  )
  RETURNING id INTO session_id;

  UPDATE public.cli_device_authorizations
  SET status = 'consumed', consumed_at = now(), exchange_nonce = NULL,
      updated_at = now()
  WHERE id = device_request.id;

  RETURN jsonb_build_object('sessionId', session_id, 'companyId', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_cli_session_v1(
  p_access_token_hash TEXT
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
  IF p_access_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  SELECT * INTO cli_session
  FROM public.cli_sessions candidate
  WHERE candidate.access_token_hash = p_access_token_hash
  FOR UPDATE;

  IF NOT FOUND OR cli_session.revoked_at IS NOT NULL
    OR cli_session.refresh_expires_at <= now()
  THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users actor
    JOIN auth.sessions actor_session
      ON actor_session.user_id = actor.id
     AND actor_session.id = cli_session.actor_auth_session_id
    WHERE actor.id = cli_session.user_id
      AND actor.deleted_at IS NULL
      AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  ) OR (
    cli_session.selected_company_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.company_memberships membership
      WHERE membership.user_id = cli_session.user_id
        AND membership.company_id = cli_session.selected_company_id
        AND membership.status = 'active'
    )
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
    UPDATE public.cli_sessions SET last_used_at = now()
    WHERE id = cli_session.id;
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

CREATE OR REPLACE FUNCTION public.inspect_cli_session_refresh_v1(
  p_refresh_token_hash TEXT
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
  IF p_refresh_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('error', 'invalid_refresh_token');
  END IF;
  SELECT * INTO cli_session
  FROM public.cli_sessions candidate
  WHERE candidate.refresh_token_hash = p_refresh_token_hash;

  IF NOT FOUND OR cli_session.revoked_at IS NOT NULL
    OR cli_session.refresh_expires_at <= now()
  THEN
    RETURN jsonb_build_object('error', 'invalid_refresh_token');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users actor
    JOIN auth.sessions actor_session
      ON actor_session.user_id = actor.id
     AND actor_session.id = cli_session.actor_auth_session_id
    WHERE actor.id = cli_session.user_id
      AND actor.deleted_at IS NULL
      AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  ) OR (
    cli_session.selected_company_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.company_memberships membership
      WHERE membership.user_id = cli_session.user_id
        AND membership.company_id = cli_session.selected_company_id
        AND membership.status = 'active'
    )
  ) THEN
    UPDATE public.cli_sessions
    SET revoked_at = now(), revocation_reason = 'actor_access_removed'
    WHERE id = cli_session.id AND revoked_at IS NULL;
    DELETE FROM auth.sessions
    WHERE id = cli_session.actor_auth_session_id
      AND user_id = cli_session.user_id;
    RETURN jsonb_build_object('error', 'invalid_refresh_token');
  END IF;

  RETURN jsonb_build_object(
    'sessionId', cli_session.id,
    'userId', cli_session.user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_cli_session_credentials_v1(
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
  IF NOT FOUND OR cli_session.revoked_at IS NOT NULL
    OR cli_session.refresh_expires_at <= now()
  THEN
    RETURN jsonb_build_object('error', 'invalid_refresh_token');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users actor
    JOIN auth.sessions old_actor_session
      ON old_actor_session.user_id = actor.id
     AND old_actor_session.id = cli_session.actor_auth_session_id
    WHERE actor.id = cli_session.user_id
      AND actor.deleted_at IS NULL
      AND (actor.banned_until IS NULL OR actor.banned_until <= now())
  ) OR (
    cli_session.selected_company_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.company_memberships membership
      WHERE membership.user_id = cli_session.user_id
        AND membership.company_id = cli_session.selected_company_id
        AND membership.status = 'active'
    )
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
  SET access_token_hash = p_next_access_token_hash,
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

CREATE OR REPLACE FUNCTION public.select_cli_session_company_v1(
  p_actor_user_id UUID,
  p_cli_session_id UUID,
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_company_id UUID;
  selected_company_name TEXT;
  selected_role TEXT;
BEGIN
  PERFORM cli_private.require_service_role();
  IF NOT EXISTS (
    SELECT 1 FROM public.cli_sessions session
    WHERE session.id = p_cli_session_id
      AND session.user_id = p_actor_user_id
      AND session.revoked_at IS NULL
      AND session.refresh_expires_at > now()
  ) THEN
    RETURN jsonb_build_object('error', 'invalid_session');
  END IF;

  SELECT company.id, company.name, membership.role
  INTO selected_company_id, selected_company_name, selected_role
  FROM public.company_memberships membership
  JOIN public.companies company ON company.id = membership.company_id
  WHERE membership.user_id = p_actor_user_id
    AND membership.company_id = p_company_id
    AND membership.status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  UPDATE public.cli_sessions
  SET selected_company_id = p_company_id, last_used_at = now()
  WHERE id = p_cli_session_id AND user_id = p_actor_user_id;

  RETURN jsonb_build_object(
    'company', jsonb_build_object(
      'id', selected_company_id,
      'name', selected_company_name,
      'role', selected_role
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.select_cli_session_company_v1(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_cli_session_company_v1(UUID, UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
