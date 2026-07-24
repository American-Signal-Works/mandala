-- Restore explicit browser consent and bind the approved workspace before a
-- hosted CLI session can be issued. Requests created by the superseded
-- auto-approval flow are short-lived; expire any unfinished unbound requests
-- so a mixed deployment cannot exchange one after this migration lands.

UPDATE public.cli_device_authorizations
SET
  status = 'expired',
  exchange_nonce = NULL,
  updated_at = now()
WHERE status IN ('pending', 'approved', 'exchanging')
  AND selected_company_id IS NULL;

WITH revoked_unbound AS (
  UPDATE public.cli_sessions
  SET
    revoked_at = now(),
    revocation_reason = 'authorization_consent_required'
  WHERE selected_company_id IS NULL
    AND revoked_at IS NULL
  RETURNING actor_auth_session_id, user_id
)
DELETE FROM auth.sessions actor_session
USING revoked_unbound
WHERE actor_session.id = revoked_unbound.actor_auth_session_id
  AND actor_session.user_id = revoked_unbound.user_id;

ALTER TABLE public.cli_device_authorizations
  ADD CONSTRAINT cli_device_authorizations_active_selection_check
  CHECK (
    status NOT IN ('approved', 'exchanging')
    OR selected_company_id IS NOT NULL
  );

ALTER TABLE public.cli_sessions
  ADD CONSTRAINT cli_sessions_active_workspace_check
  CHECK (
    revoked_at IS NOT NULL
    OR selected_company_id IS NOT NULL
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
  company_name TEXT;
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
    SET status = 'expired', exchange_nonce = NULL, updated_at = now()
    WHERE id = device_request.id
      AND status IN ('pending', 'approved', 'exchanging');
    RETURN jsonb_build_object('error', 'expired');
  END IF;
  IF device_request.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'already_decided');
  END IF;

  IF p_decision = 'deny' THEN
    UPDATE public.cli_device_authorizations
    SET
      status = 'denied',
      approved_user_id = p_actor_user_id,
      denied_at = now(),
      updated_at = now()
    WHERE id = device_request.id;
    RETURN jsonb_build_object('status', 'denied');
  END IF;

  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'company_required');
  END IF;

  SELECT company.name INTO company_name
  FROM public.company_memberships membership
  JOIN public.companies company ON company.id = membership.company_id
  WHERE membership.company_id = p_company_id
    AND membership.user_id = p_actor_user_id
    AND membership.status = 'active';

  IF company_name IS NULL THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  UPDATE public.cli_device_authorizations
  SET
    status = 'approved',
    approved_user_id = p_actor_user_id,
    selected_company_id = p_company_id,
    approved_at = now(),
    updated_at = now()
  WHERE id = device_request.id;

  RETURN jsonb_build_object(
    'status', 'approved',
    'company', jsonb_build_object('id', p_company_id, 'name', company_name)
  );
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
    OR device_request.selected_company_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_cli_authorization_exchange' USING ERRCODE = '55000';
  END IF;

  IF device_request.expires_at <= now() THEN
    UPDATE public.cli_device_authorizations
    SET status = 'expired', exchange_nonce = NULL, updated_at = now()
    WHERE id = device_request.id;
    RAISE EXCEPTION 'expired_cli_authorization_exchange' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_memberships membership
    WHERE membership.user_id = device_request.approved_user_id
      AND membership.company_id = device_request.selected_company_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'cli_authorization_membership_removed'
      USING ERRCODE = '42501';
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
    access_token_hash,
    refresh_token_hash,
    actor_auth_session_id,
    actor_session_ciphertext,
    user_id,
    selected_company_id,
    scopes,
    client_name,
    client_version,
    client_platform,
    access_expires_at,
    refresh_expires_at
  ) VALUES (
    p_access_token_hash,
    p_refresh_token_hash,
    p_actor_auth_session_id,
    p_actor_session_ciphertext,
    device_request.approved_user_id,
    device_request.selected_company_id,
    device_request.requested_scopes,
    device_request.client_name,
    device_request.client_version,
    device_request.client_platform,
    p_access_expires_at,
    p_refresh_expires_at
  )
  RETURNING id INTO session_id;

  UPDATE public.cli_device_authorizations
  SET
    status = 'consumed',
    consumed_at = now(),
    exchange_nonce = NULL,
    updated_at = now()
  WHERE id = device_request.id;

  RETURN jsonb_build_object(
    'sessionId', session_id,
    'companyId', device_request.selected_company_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decide_cli_device_authorization_v1(
  TEXT, TEXT, TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_cli_device_authorization_v1(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_cli_device_authorization_v1(
  TEXT, TEXT, TEXT, UUID, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_cli_device_authorization_v1(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';
