-- Cycle 0.0.7: code-free hosted CLI authorization and revocable CLI sessions.
-- Raw browser, polling, and Mandala API credentials never enter persistent tables.

CREATE SCHEMA IF NOT EXISTS cli_private;
REVOKE ALL ON SCHEMA cli_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA cli_private TO service_role;

CREATE TABLE public.cli_device_authorizations (
  id UUID PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  browser_token_hash TEXT NOT NULL UNIQUE,
  requester_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'approved', 'denied', 'expired', 'exchanging', 'consumed'
    )),
  client_name TEXT NOT NULL,
  client_version TEXT NOT NULL,
  client_platform TEXT NOT NULL,
  requested_scopes TEXT[] NOT NULL DEFAULT ARRAY['workspace:control']::TEXT[],
  approved_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  selected_company_id UUID REFERENCES public.companies(id) ON DELETE RESTRICT,
  exchange_nonce UUID,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 5
    CHECK (poll_interval_seconds BETWEEN 5 AND 30),
  poll_attempts INTEGER NOT NULL DEFAULT 0 CHECK (poll_attempts >= 0),
  last_polled_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (device_code_hash ~ '^[a-f0-9]{64}$'),
  CHECK (browser_token_hash ~ '^[a-f0-9]{64}$'),
  CHECK (requester_hash ~ '^[a-f0-9]{64}$'),
  CHECK (length(client_name) BETWEEN 1 AND 120),
  CHECK (length(client_version) BETWEEN 1 AND 40),
  CHECK (length(client_platform) BETWEEN 1 AND 80),
  CHECK (cardinality(requested_scopes) BETWEEN 1 AND 10),
  CHECK (expires_at > created_at),
  CHECK (
    status NOT IN ('approved', 'exchanging', 'consumed')
    OR (approved_user_id IS NOT NULL AND selected_company_id IS NOT NULL)
  ),
  CHECK (status <> 'exchanging' OR exchange_nonce IS NOT NULL)
);

CREATE INDEX cli_device_authorizations_requester_created_idx
  ON public.cli_device_authorizations(requester_hash, created_at DESC);
CREATE INDEX cli_device_authorizations_expiry_idx
  ON public.cli_device_authorizations(expires_at)
  WHERE status IN ('pending', 'approved', 'exchanging');

CREATE TABLE public.cli_authorization_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('verification', 'decision')),
  subject_hash TEXT NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cli_authorization_attempts_subject_idx
  ON public.cli_authorization_attempts(attempt_kind, subject_hash, attempted_at DESC);

CREATE TABLE public.cli_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  actor_auth_session_id UUID NOT NULL UNIQUE,
  actor_session_ciphertext TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  selected_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['workspace:control']::TEXT[],
  client_name TEXT NOT NULL,
  client_version TEXT NOT NULL,
  client_platform TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  CHECK (access_token_hash ~ '^[a-f0-9]{64}$'),
  CHECK (refresh_token_hash ~ '^[a-f0-9]{64}$'),
  CHECK (length(actor_session_ciphertext) BETWEEN 20 AND 20000),
  CHECK (cardinality(scopes) BETWEEN 1 AND 10),
  CHECK (length(client_name) BETWEEN 1 AND 120),
  CHECK (length(client_version) BETWEEN 1 AND 40),
  CHECK (length(client_platform) BETWEEN 1 AND 80),
  CHECK (revocation_reason IS NULL OR length(revocation_reason) BETWEEN 1 AND 120),
  CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL)),
  CHECK (access_expires_at > created_at),
  CHECK (refresh_expires_at > access_expires_at)
);

CREATE INDEX cli_sessions_user_created_idx
  ON public.cli_sessions(user_id, created_at DESC);
CREATE INDEX cli_sessions_active_idx
  ON public.cli_sessions(user_id, last_used_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE public.cli_device_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cli_authorization_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cli_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cli_device_authorizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cli_authorization_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cli_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cli_device_authorizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cli_authorization_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cli_authorization_attempts_id_seq TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cli_sessions TO service_role;

CREATE FUNCTION cli_private.require_service_role()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.jwt() ->> 'role'), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION cli_private.record_attempt(
  p_attempt_kind TEXT,
  p_subject_hash TEXT,
  p_limit INTEGER,
  p_window INTERVAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_count INTEGER;
BEGIN
  IF p_attempt_kind NOT IN ('verification', 'decision')
    OR p_subject_hash !~ '^[a-f0-9]{64}$'
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_window < INTERVAL '1 second'
    OR p_window > INTERVAL '1 day'
  THEN
    RAISE EXCEPTION 'invalid_cli_authorization_attempt' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_attempt_kind || ':' || p_subject_hash)
  );

  SELECT count(*)::INTEGER
  INTO attempt_count
  FROM public.cli_authorization_attempts attempt
  WHERE attempt.attempt_kind = p_attempt_kind
    AND attempt.subject_hash = p_subject_hash
    AND attempt.attempted_at >= now() - p_window;

  IF attempt_count >= p_limit THEN
    RETURN false;
  END IF;

  INSERT INTO public.cli_authorization_attempts(attempt_kind, subject_hash)
  VALUES (p_attempt_kind, p_subject_hash);
  RETURN true;
END;
$$;

CREATE FUNCTION public.create_cli_device_authorization_v1(
  p_id UUID,
  p_device_code_hash TEXT,
  p_browser_token_hash TEXT,
  p_requester_hash TEXT,
  p_client_name TEXT,
  p_client_version TEXT,
  p_client_platform TEXT,
  p_requested_scopes TEXT[] DEFAULT ARRAY['workspace:control']::TEXT[],
  p_expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '10 minutes'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recent_requests INTEGER;
BEGIN
  PERFORM cli_private.require_service_role();

  IF p_id IS NULL
    OR p_device_code_hash !~ '^[a-f0-9]{64}$'
    OR p_browser_token_hash !~ '^[a-f0-9]{64}$'
    OR p_requester_hash !~ '^[a-f0-9]{64}$'
    OR length(COALESCE(p_client_name, '')) NOT BETWEEN 1 AND 120
    OR length(COALESCE(p_client_version, '')) NOT BETWEEN 1 AND 40
    OR length(COALESCE(p_client_platform, '')) NOT BETWEEN 1 AND 80
    OR cardinality(COALESCE(p_requested_scopes, ARRAY[]::TEXT[])) NOT BETWEEN 1 AND 10
    OR p_requested_scopes <@ ARRAY['workspace:control']::TEXT[] IS NOT TRUE
    OR p_expires_at <= now() + INTERVAL '2 minutes'
    OR p_expires_at > now() + INTERVAL '15 minutes'
  THEN
    RAISE EXCEPTION 'invalid_cli_device_authorization' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_requester_hash));
  SELECT count(*)::INTEGER
  INTO recent_requests
  FROM public.cli_device_authorizations device_request
  WHERE device_request.requester_hash = p_requester_hash
    AND device_request.created_at >= now() - INTERVAL '10 minutes';

  IF recent_requests >= 5 THEN
    RAISE EXCEPTION 'cli_authorization_rate_limited' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.cli_device_authorizations(
    id,
    device_code_hash,
    browser_token_hash,
    requester_hash,
    client_name,
    client_version,
    client_platform,
    requested_scopes,
    expires_at
  ) VALUES (
    p_id,
    p_device_code_hash,
    p_browser_token_hash,
    p_requester_hash,
    p_client_name,
    p_client_version,
    p_client_platform,
    p_requested_scopes,
    p_expires_at
  );

  RETURN jsonb_build_object(
    'authorizationId', p_id,
    'expiresAt', p_expires_at,
    'intervalSeconds', 5
  );
END;
$$;

CREATE FUNCTION public.inspect_cli_device_authorization_v1(
  p_browser_token_hash TEXT,
  p_subject_hash TEXT,
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
    'verification', p_subject_hash, 10, INTERVAL '5 minutes'
  ) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  SELECT *
  INTO device_request
  FROM public.cli_device_authorizations candidate
  WHERE candidate.browser_token_hash = p_browser_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF device_request.expires_at <= now()
    AND device_request.status IN ('pending', 'approved')
  THEN
    UPDATE public.cli_device_authorizations
    SET status = 'expired', updated_at = now()
    WHERE id = device_request.id;
    device_request.status := 'expired';
  END IF;

  IF device_request.status IN ('approved', 'exchanging', 'consumed')
    AND device_request.approved_user_id IS DISTINCT FROM p_actor_user_id
  THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'authorizationId', device_request.id,
    'status', device_request.status,
    'clientName', device_request.client_name,
    'clientVersion', device_request.client_version,
    'clientPlatform', device_request.client_platform,
    'requestedScopes', to_jsonb(device_request.requested_scopes),
    'expiresAt', device_request.expires_at,
    'selectedCompanyId', device_request.selected_company_id
  );
END;
$$;

CREATE FUNCTION public.decide_cli_device_authorization_v1(
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

  SELECT *
  INTO device_request
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

  SELECT company.name
  INTO company_name
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

CREATE FUNCTION public.claim_cli_device_authorization_v1(
  p_device_code_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  device_request public.cli_device_authorizations%ROWTYPE;
  claim_nonce UUID;
BEGIN
  PERFORM cli_private.require_service_role();
  IF p_device_code_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid_device_code' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO device_request
  FROM public.cli_device_authorizations candidate
  WHERE candidate.device_code_hash = p_device_code_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_device_code');
  END IF;

  IF device_request.expires_at <= now()
    AND device_request.status IN ('pending', 'approved')
  THEN
    UPDATE public.cli_device_authorizations
    SET status = 'expired', updated_at = now()
    WHERE id = device_request.id;
    device_request.status := 'expired';
  END IF;

  IF device_request.status IN ('denied', 'expired', 'consumed') THEN
    RETURN jsonb_build_object('status', device_request.status);
  END IF;

  IF device_request.last_polled_at IS NOT NULL
    AND now() < device_request.last_polled_at
      + make_interval(secs => device_request.poll_interval_seconds)
  THEN
    UPDATE public.cli_device_authorizations
    SET
      poll_attempts = poll_attempts + 1,
      poll_interval_seconds = LEAST(30, poll_interval_seconds + 5),
      last_polled_at = now(),
      updated_at = now()
    WHERE id = device_request.id
    RETURNING poll_interval_seconds INTO device_request.poll_interval_seconds;
    RETURN jsonb_build_object(
      'status', 'slow_down',
      'intervalSeconds', device_request.poll_interval_seconds
    );
  END IF;

  UPDATE public.cli_device_authorizations
  SET poll_attempts = poll_attempts + 1, last_polled_at = now(), updated_at = now()
  WHERE id = device_request.id;

  IF device_request.status = 'pending' OR device_request.status = 'exchanging' THEN
    RETURN jsonb_build_object(
      'status', 'authorization_pending',
      'intervalSeconds', device_request.poll_interval_seconds
    );
  END IF;
  IF device_request.status <> 'approved' THEN
    RETURN jsonb_build_object('status', 'invalid_device_code');
  END IF;

  claim_nonce := gen_random_uuid();
  UPDATE public.cli_device_authorizations
  SET status = 'exchanging', exchange_nonce = claim_nonce, updated_at = now()
  WHERE id = device_request.id;

  RETURN jsonb_build_object(
    'status', 'exchange_ready',
    'authorizationId', device_request.id,
    'exchangeNonce', claim_nonce,
    'userId', device_request.approved_user_id,
    'companyId', device_request.selected_company_id,
    'requestedScopes', to_jsonb(device_request.requested_scopes),
    'clientName', device_request.client_name,
    'clientVersion', device_request.client_version,
    'clientPlatform', device_request.client_platform
  );
END;
$$;

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
    SELECT 1
    FROM auth.sessions actor_session
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
  SET status = 'consumed', consumed_at = now(), exchange_nonce = NULL, updated_at = now()
  WHERE id = device_request.id;

  RETURN jsonb_build_object(
    'sessionId', session_id,
    'companyId', device_request.selected_company_id
  );
END;
$$;

CREATE FUNCTION public.release_cli_device_authorization_v1(
  p_authorization_id UUID,
  p_exchange_nonce UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM cli_private.require_service_role();
  UPDATE public.cli_device_authorizations
  SET status = 'approved', exchange_nonce = NULL, updated_at = now()
  WHERE id = p_authorization_id
    AND status = 'exchanging'
    AND exchange_nonce = p_exchange_nonce
    AND expires_at > now();
END;
$$;

CREATE FUNCTION public.validate_cli_session_v1(
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

  SELECT *
  INTO cli_session
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

CREATE FUNCTION public.inspect_cli_session_refresh_v1(
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

  SELECT *
  INTO cli_session
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

  RETURN jsonb_build_object(
    'sessionId', cli_session.id,
    'userId', cli_session.user_id
  );
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

  SELECT *
  INTO cli_session
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
    SELECT 1
    FROM auth.sessions new_actor_session
    WHERE new_actor_session.id = p_actor_auth_session_id
      AND new_actor_session.user_id = cli_session.user_id
  ) THEN
    RETURN jsonb_build_object('error', 'actor_session_invalid');
  END IF;

  SELECT auth_user.email
  INTO user_email
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
  SELECT *
  INTO cli_session
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

REVOKE ALL ON FUNCTION cli_private.require_service_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION cli_private.record_attempt(TEXT, TEXT, INTEGER, INTERVAL)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_cli_device_authorization_v1(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.inspect_cli_device_authorization_v1(TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_cli_device_authorization_v1(TEXT, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_cli_device_authorization_v1(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_cli_device_authorization_v1(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_cli_device_authorization_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_cli_session_v1(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.inspect_cli_session_refresh_v1(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rotate_cli_session_credentials_v1(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_cli_session_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_all_cli_sessions_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_cli_device_authorization_v1(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.inspect_cli_device_authorization_v1(TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_cli_device_authorization_v1(TEXT, TEXT, TEXT, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_cli_device_authorization_v1(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_cli_device_authorization_v1(
  UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT
)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cli_device_authorization_v1(UUID, UUID)
  TO service_role;
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

COMMENT ON TABLE public.cli_device_authorizations IS
  'Short-lived hosted CLI authorization state. Only SHA-256 token digests are stored.';
COMMENT ON TABLE public.cli_sessions IS
  'Revocable Mandala API-only CLI sessions. Client credentials are SHA-256 digests; the user-scoped database session is encrypted server-side.';
