-- Cycle 0.0.6: one invitation lifecycle shared by workspace onboarding and
-- ongoing team management. Raw invitation tokens never enter Postgres.

CREATE SCHEMA IF NOT EXISTS invitation_private;
REVOKE ALL ON SCHEMA invitation_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.company_invitations (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_hash TEXT NOT NULL,
  inviter_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'accepted', 'revoked', 'expired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  delivery_id UUID REFERENCES public.email_deliveries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  CHECK (expires_at > issued_at),
  CHECK ((state = 'accepted') = (accepted_at IS NOT NULL)),
  CHECK ((state = 'accepted') = (accepted_user_id IS NOT NULL)),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX company_invitations_one_pending_recipient_idx
  ON public.company_invitations (company_id, recipient_hash)
  WHERE state = 'pending';
CREATE INDEX company_invitations_company_state_idx
  ON public.company_invitations (company_id, state, created_at DESC);

CREATE TABLE public.company_invitation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  invitation_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  token_digest TEXT NOT NULL UNIQUE
    CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'superseded', 'used', 'revoked', 'expired')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  UNIQUE (invitation_id, version),
  FOREIGN KEY (invitation_id, company_id)
    REFERENCES public.company_invitations(id, company_id) ON DELETE CASCADE
);

CREATE INDEX company_invitation_tokens_invitation_state_idx
  ON public.company_invitation_tokens (invitation_id, state, version DESC);

CREATE TABLE public.company_invitation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  invitation_id UUID NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('issued', 'resent', 'revoked', 'expired', 'accepted')),
  invitation_version INTEGER NOT NULL CHECK (invitation_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (invitation_id, company_id)
    REFERENCES public.company_invitations(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX company_invitation_events_company_created_idx
  ON public.company_invitation_events (company_id, created_at DESC);

CREATE FUNCTION invitation_private.reject_invitation_event_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'company_invitation_event_immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER company_invitation_events_immutable
BEFORE UPDATE OR DELETE ON public.company_invitation_events
FOR EACH ROW EXECUTE FUNCTION invitation_private.reject_invitation_event_change();

CREATE TRIGGER company_invitations_touch
BEFORE UPDATE ON public.company_invitations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invitation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invitation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_invitations_owner_select
  ON public.company_invitations FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'owner'));
CREATE POLICY company_invitation_events_owner_select
  ON public.company_invitation_events FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'owner'));

REVOKE ALL ON TABLE public.company_invitations,
  public.company_invitation_tokens,
  public.company_invitation_events
FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.company_invitations,
  public.company_invitation_tokens TO service_role;

CREATE FUNCTION invitation_private.normalize_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$ SELECT lower(trim(p_email)) $$;

CREATE FUNCTION invitation_private.email_hash(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(invitation_private.normalize_email(p_email), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

CREATE FUNCTION invitation_private.require_owner(p_company_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := (SELECT auth.uid());
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.company_memberships membership
    WHERE membership.company_id = p_company_id
      AND membership.user_id = actor_id
      AND membership.status = 'active'
      AND membership.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'invitation_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN actor_id;
END;
$$;

CREATE FUNCTION invitation_private.safe_projection(
  p_invitation public.company_invitations
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'invitationId', p_invitation.id,
    'companyId', p_invitation.company_id,
    'recipientEmail', p_invitation.recipient_email,
    'state', p_invitation.state,
    'version', p_invitation.version,
    'issuedAt', p_invitation.issued_at,
    'expiresAt', p_invitation.expires_at,
    'deliveryId', p_invitation.delivery_id
  )
$$;

CREATE FUNCTION public.issue_company_invitation(
  p_invitation_id UUID,
  p_company_id UUID,
  p_recipient_email TEXT,
  p_token_digest TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID;
  normalized_email TEXT := invitation_private.normalize_email(p_recipient_email);
  normalized_hash TEXT;
  invitation public.company_invitations%ROWTYPE;
  delivery public.email_deliveries%ROWTYPE;
BEGIN
  actor_id := invitation_private.require_owner(p_company_id);
  IF p_invitation_id IS NULL
    OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_token_digest !~ '^[0-9a-f]{64}$'
    OR p_expires_at <= now()
    OR p_expires_at > now() + interval '72 hours 1 minute'
  THEN
    RAISE EXCEPTION 'invalid_invitation' USING ERRCODE = '22023';
  END IF;
  normalized_hash := invitation_private.email_hash(normalized_email);

  PERFORM company.id FROM public.companies company
  WHERE company.id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.company_invitations candidate
  SET state = 'expired'
  WHERE candidate.company_id = p_company_id
    AND candidate.recipient_hash = normalized_hash
    AND candidate.state = 'pending'
    AND candidate.expires_at <= now();
  UPDATE public.company_invitation_tokens token
  SET state = 'expired'
  WHERE token.company_id = p_company_id
    AND token.state = 'active'
    AND token.expires_at <= now();

  IF EXISTS (
    SELECT 1 FROM auth.users user_record
    JOIN public.company_memberships membership
      ON membership.user_id = user_record.id
     AND membership.company_id = p_company_id
     AND membership.status = 'active'
    WHERE lower(user_record.email) = normalized_email
  ) THEN
    RAISE EXCEPTION 'already_active_member' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.company_invitations (
    id, company_id, recipient_email, recipient_hash, inviter_user_id,
    state, version, issued_at, expires_at
  ) VALUES (
    p_invitation_id, p_company_id, normalized_email, normalized_hash,
    actor_id, 'pending', 1, now(), p_expires_at
  ) RETURNING * INTO invitation;

  INSERT INTO public.company_invitation_tokens (
    company_id, invitation_id, version, token_digest, expires_at
  ) VALUES (
    p_company_id, invitation.id, 1, p_token_digest, p_expires_at
  );

  SELECT * INTO delivery FROM public.enqueue_email_delivery(
    p_company_id,
    'company-invitation:' || invitation.id::TEXT || ':1',
    'workspace_invite',
    '1',
    'company_invitation:' || invitation.id::TEXT || ':1',
    normalized_email,
    now()
  );
  UPDATE public.company_invitations SET delivery_id = delivery.id
  WHERE id = invitation.id RETURNING * INTO invitation;

  INSERT INTO public.company_invitation_events (
    company_id, invitation_id, actor_user_id, event_type, invitation_version
  ) VALUES (p_company_id, invitation.id, actor_id, 'issued', 1);

  RETURN invitation_private.safe_projection(invitation);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'active_invitation_exists' USING ERRCODE = '23505';
END;
$$;

CREATE FUNCTION public.resend_company_invitation(
  p_invitation_id UUID,
  p_token_digest TEXT,
  p_expires_at TIMESTAMPTZ,
  p_expected_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invitation public.company_invitations%ROWTYPE;
  actor_id UUID;
  next_version INTEGER;
  delivery public.email_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO invitation FROM public.company_invitations
  WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002'; END IF;
  actor_id := invitation_private.require_owner(invitation.company_id);
  IF invitation.state <> 'pending' OR invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_not_pending' USING ERRCODE = '55000';
  END IF;
  IF p_expected_version <> invitation.version + 1 THEN
    RAISE EXCEPTION 'invitation_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF p_token_digest !~ '^[0-9a-f]{64}$'
    OR p_expires_at <= now()
    OR p_expires_at > now() + interval '72 hours 1 minute'
  THEN
    RAISE EXCEPTION 'invalid_invitation' USING ERRCODE = '22023';
  END IF;

  UPDATE public.company_invitation_tokens
  SET state = 'superseded'
  WHERE invitation_id = invitation.id AND state = 'active';
  next_version := p_expected_version;
  UPDATE public.company_invitations
  SET version = next_version, issued_at = now(), expires_at = p_expires_at,
      delivery_id = NULL
  WHERE id = invitation.id RETURNING * INTO invitation;
  INSERT INTO public.company_invitation_tokens (
    company_id, invitation_id, version, token_digest, expires_at
  ) VALUES (
    invitation.company_id, invitation.id, next_version,
    p_token_digest, p_expires_at
  );

  SELECT * INTO delivery FROM public.enqueue_email_delivery(
    invitation.company_id,
    'company-invitation:' || invitation.id::TEXT || ':' || next_version::TEXT,
    'workspace_invite', '1',
    'company_invitation:' || invitation.id::TEXT || ':' || next_version::TEXT,
    invitation.recipient_email, now()
  );
  UPDATE public.company_invitations SET delivery_id = delivery.id
  WHERE id = invitation.id RETURNING * INTO invitation;
  INSERT INTO public.company_invitation_events (
    company_id, invitation_id, actor_user_id, event_type, invitation_version
  ) VALUES (
    invitation.company_id, invitation.id, actor_id, 'resent', next_version
  );
  RETURN invitation_private.safe_projection(invitation);
END;
$$;

CREATE FUNCTION public.get_company_invitation_resend_version(
  p_invitation_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE invitation public.company_invitations%ROWTYPE;
BEGIN
  SELECT * INTO invitation FROM public.company_invitations
  WHERE id = p_invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM invitation_private.require_owner(invitation.company_id);
  IF invitation.state <> 'pending' OR invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_not_pending' USING ERRCODE = '55000';
  END IF;
  RETURN invitation.version + 1;
END;
$$;

CREATE FUNCTION public.revoke_company_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invitation public.company_invitations%ROWTYPE;
  actor_id UUID;
BEGIN
  SELECT * INTO invitation FROM public.company_invitations
  WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002'; END IF;
  actor_id := invitation_private.require_owner(invitation.company_id);
  IF invitation.state <> 'pending' THEN
    RAISE EXCEPTION 'invitation_not_pending' USING ERRCODE = '55000';
  END IF;
  UPDATE public.company_invitations
  SET state = 'revoked', revoked_at = now()
  WHERE id = invitation.id RETURNING * INTO invitation;
  UPDATE public.company_invitation_tokens SET state = 'revoked'
  WHERE invitation_id = invitation.id AND state = 'active';
  INSERT INTO public.company_invitation_events (
    company_id, invitation_id, actor_user_id, event_type, invitation_version
  ) VALUES (
    invitation.company_id, invitation.id, actor_id, 'revoked', invitation.version
  );
  RETURN invitation_private.safe_projection(invitation);
END;
$$;

CREATE FUNCTION public.inspect_company_invitation(p_token_digest TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  token public.company_invitation_tokens%ROWTYPE;
  invitation public.company_invitations%ROWTYPE;
  company_name TEXT;
  projected_state TEXT;
BEGIN
  IF p_token_digest !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('state', 'missing');
  END IF;
  SELECT * INTO token FROM public.company_invitation_tokens
  WHERE token_digest = p_token_digest FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'missing'); END IF;
  SELECT * INTO invitation FROM public.company_invitations
  WHERE id = token.invitation_id FOR UPDATE;
  IF token.state = 'active' AND token.expires_at <= now() THEN
    UPDATE public.company_invitation_tokens SET state = 'expired'
    WHERE id = token.id;
    UPDATE public.company_invitations SET state = 'expired'
    WHERE id = invitation.id AND state = 'pending';
    token.state := 'expired';
  END IF;
  SELECT name INTO company_name FROM public.companies WHERE id = invitation.company_id;
  projected_state := CASE token.state
    WHEN 'active' THEN CASE WHEN invitation.state = 'pending' THEN 'valid' ELSE invitation.state END
    WHEN 'used' THEN 'used'
    ELSE token.state
  END;
  RETURN jsonb_build_object(
    'state', projected_state,
    'workspaceName', company_name,
    'expiresAt', token.expires_at
  );
END;
$$;

CREATE FUNCTION public.accept_company_invitation(p_token_digest TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := (SELECT auth.uid());
  actor_email TEXT;
  token public.company_invitation_tokens%ROWTYPE;
  invitation public.company_invitations%ROWTYPE;
  membership public.company_memberships%ROWTYPE;
  previous_status TEXT;
  previous_role TEXT;
  inviter_email TEXT;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT lower(email) INTO actor_email FROM auth.users WHERE id = actor_id;
  SELECT * INTO token FROM public.company_invitation_tokens
  WHERE token_digest = p_token_digest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_missing' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO invitation FROM public.company_invitations
  WHERE id = token.invitation_id FOR UPDATE;
  IF token.state <> 'active' THEN
    RAISE EXCEPTION 'invitation_%', token.state USING ERRCODE = '55000';
  END IF;
  IF token.expires_at <= now() OR invitation.expires_at <= now() THEN
    UPDATE public.company_invitation_tokens SET state = 'expired' WHERE id = token.id;
    UPDATE public.company_invitations SET state = 'expired'
      WHERE id = invitation.id AND state = 'pending';
    RAISE EXCEPTION 'invitation_expired' USING ERRCODE = '55000';
  END IF;
  IF invitation.state <> 'pending' THEN
    RAISE EXCEPTION 'invitation_%', invitation.state USING ERRCODE = '55000';
  END IF;
  IF actor_email IS NULL OR actor_email <> invitation.recipient_email THEN
    RAISE EXCEPTION 'session_replacement_required' USING ERRCODE = '42501';
  END IF;

  PERFORM id FROM public.companies WHERE id = invitation.company_id FOR UPDATE;
  SELECT * INTO membership FROM public.company_memberships
  WHERE company_id = invitation.company_id AND user_id = actor_id FOR UPDATE;
  IF FOUND THEN
    IF membership.status = 'active' THEN
      RAISE EXCEPTION 'already_active_member' USING ERRCODE = '55000';
    END IF;
    previous_status := membership.status;
    previous_role := membership.role;
    UPDATE public.company_memberships SET role = 'owner', status = 'active', updated_at = now()
    WHERE id = membership.id RETURNING * INTO membership;
  ELSE
    INSERT INTO public.company_memberships (company_id, user_id, role, status)
    VALUES (invitation.company_id, actor_id, 'owner', 'active')
    RETURNING * INTO membership;
  END IF;

  INSERT INTO public.company_membership_events (
    company_id, membership_id, actor_user_id, target_user_id, action,
    previous_status, previous_role, next_status, next_role
  ) VALUES (
    invitation.company_id, membership.id, actor_id, actor_id, 'activate',
    previous_status, previous_role, 'active', 'owner'
  );
  UPDATE public.company_invitation_tokens
  SET state = 'used', consumed_at = now() WHERE id = token.id;
  UPDATE public.company_invitations
  SET state = 'accepted', accepted_at = now(), accepted_user_id = actor_id
  WHERE id = invitation.id RETURNING * INTO invitation;
  INSERT INTO public.company_invitation_events (
    company_id, invitation_id, actor_user_id, event_type, invitation_version
  ) VALUES (
    invitation.company_id, invitation.id, actor_id, 'accepted', invitation.version
  );

  SELECT email INTO inviter_email FROM auth.users WHERE id = invitation.inviter_user_id;
  IF inviter_email IS NOT NULL THEN
    PERFORM public.enqueue_email_delivery(
      invitation.company_id,
      'company-invitation-accepted:' || invitation.id::TEXT,
      'workspace_invite_accepted', '1',
      'company_invitation_accepted:' || invitation.id::TEXT,
      inviter_email, now()
    );
  END IF;
  RETURN jsonb_build_object(
    'invitationId', invitation.id,
    'companyId', invitation.company_id,
    'membershipId', membership.id,
    'state', 'accepted',
    'role', 'owner'
  );
END;
$$;

CREATE FUNCTION public.list_company_directory(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM invitation_private.require_owner(p_company_id);
  SELECT jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'membershipId', membership.id,
        'userId', membership.user_id,
        'email', user_record.email,
        'displayName', profile.display_name,
        'role', membership.role,
        'status', CASE WHEN membership.status = 'active' THEN 'active' ELSE 'inactive' END,
        'joinedAt', membership.created_at,
        'updatedAt', membership.updated_at
      ) ORDER BY membership.created_at)
      FROM public.company_memberships membership
      JOIN auth.users user_record ON user_record.id = membership.user_id
      LEFT JOIN public.profiles profile ON profile.user_id = membership.user_id
      WHERE membership.company_id = p_company_id
        AND membership.status IN ('active', 'disabled', 'removed')
    ), '[]'::JSONB),
    'pendingInvitations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'invitationId', invitation.id,
        'recipientEmail', invitation.recipient_email,
        'state', invitation.state,
        'issuedAt', invitation.issued_at,
        'expiresAt', invitation.expires_at,
        'deliveryId', invitation.delivery_id
      ) ORDER BY invitation.created_at)
      FROM public.company_invitations invitation
      WHERE invitation.company_id = p_company_id
        AND invitation.state = 'pending'
    ), '[]'::JSONB)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.purge_company_invitation_pii(
  p_before TIMESTAMPTZ DEFAULT now() - interval '90 days'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE affected INTEGER;
BEGIN
  UPDATE public.company_invitation_tokens token
  SET state = 'expired'
  WHERE token.state = 'active'
    AND token.expires_at <= now();
  UPDATE public.company_invitations invitation
  SET state = 'expired'
  WHERE invitation.state = 'pending'
    AND invitation.expires_at <= now();

  DELETE FROM public.company_invitation_tokens token
  USING public.company_invitations invitation
  WHERE token.invitation_id = invitation.id
    AND invitation.state <> 'pending'
    AND (
      (invitation.state = 'expired' AND invitation.expires_at < p_before)
      OR (invitation.state <> 'expired' AND invitation.updated_at < p_before)
    );
  UPDATE public.company_invitations invitation
  SET recipient_email = 'purged-' || invitation.id::TEXT || '@invalid.test',
      recipient_hash = encode(extensions.digest(convert_to(invitation.id::TEXT, 'UTF8'), 'sha256'), 'hex')
  WHERE invitation.state <> 'pending'
    AND (
      (invitation.state = 'expired' AND invitation.expires_at < p_before)
      OR (invitation.state <> 'expired' AND invitation.updated_at < p_before)
    )
    AND invitation.recipient_email NOT LIKE 'purged-%@invalid.test';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION invitation_private.normalize_email(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION invitation_private.email_hash(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION invitation_private.require_owner(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION invitation_private.safe_projection(public.company_invitations) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION invitation_private.reject_invitation_event_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_company_invitation(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resend_company_invitation(UUID, TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_company_invitation_resend_version(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_company_invitation(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inspect_company_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_company_invitation(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_company_directory(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_company_invitation_pii(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_company_invitation(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resend_company_invitation(UUID, TEXT, TIMESTAMPTZ, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_company_invitation_resend_version(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_company_invitation(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inspect_company_invitation(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_company_directory(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_company_invitation_pii(TIMESTAMPTZ) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
DECLARE existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job
  WHERE jobname = 'purge-company-invitation-pii';
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
  PERFORM cron.schedule(
    'purge-company-invitation-pii',
    '17 4 * * *',
    $job$SELECT public.purge_company_invitation_pii(now() - interval '90 days')$job$
  );

  SELECT jobid INTO existing_job FROM cron.job
  WHERE jobname = 'purge-terminal-email-delivery-pii';
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
  PERFORM cron.schedule(
    'purge-terminal-email-delivery-pii',
    '47 4 * * *',
    $job$SELECT public.purge_terminal_email_delivery_pii(now() - interval '90 days')$job$
  );
END;
$$;
