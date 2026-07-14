-- Cycle 0.0.4: tenant-safe inbox, review, activity, and decision APIs.
-- All outward reads use controlled JSON projections. Private snapshot and
-- receipt tables are intentionally unavailable through the Data API.

ALTER TABLE public.workflow_items
  ADD COLUMN source_type TEXT,
  ADD COLUMN owner_role TEXT,
  ADD COLUMN assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN due_at TIMESTAMPTZ,
  ADD COLUMN queue_search_document TSVECTOR,
  ADD CONSTRAINT workflow_items_source_type_check CHECK (
    source_type IS NULL OR (
      length(source_type) BETWEEN 1 AND 100
      AND source_type ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  ADD CONSTRAINT workflow_items_owner_role_check CHECK (
    owner_role IS NULL
    OR owner_role IN ('owner','admin','approver','member','viewer','agent')
  ),
  ADD CONSTRAINT workflow_items_assignee_company_fkey
    FOREIGN KEY (company_id, assignee_id)
    REFERENCES public.company_memberships(company_id, user_id)
    ON DELETE SET NULL (assignee_id);

CREATE FUNCTION workflow_private.refresh_workflow_queue_search_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.queue_search_document := to_tsvector(
    'simple'::REGCONFIG,
    COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.item_key, '') || ' ' ||
    COALESCE(NEW.item_type, '') || ' ' || COALESCE(NEW.related_records ->> 'sku', '') || ' ' ||
    COALESCE(NEW.related_records ->> 'vendor', '') || ' ' ||
    COALESCE(NEW.related_records ->> 'purchaseOrderId', '') || ' ' ||
    COALESCE(NEW.related_records ->> 'poNumber', '') || ' ' ||
    COALESCE(NEW.related_records ->> 'requestId', '') || ' ' ||
    COALESCE(NEW.related_records ->> 'orderId', '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_items_queue_search_refresh
BEFORE INSERT OR UPDATE OF title,item_key,item_type,related_records
ON public.workflow_items
FOR EACH ROW EXECUTE FUNCTION workflow_private.refresh_workflow_queue_search_document();

UPDATE public.workflow_items item
SET source_type = event.origin
FROM public.workflow_events event
WHERE event.id = item.workflow_event_id
  AND event.company_id = item.company_id
  AND item.source_type IS NULL;

UPDATE public.workflow_items item
SET queue_search_document = to_tsvector(
  'simple'::REGCONFIG,
  COALESCE(item.title, '') || ' ' || COALESCE(item.item_key, '') || ' ' ||
  COALESCE(item.item_type, '') || ' ' || COALESCE(item.related_records ->> 'sku', '') || ' ' ||
  COALESCE(item.related_records ->> 'vendor', '') || ' ' ||
  COALESCE(item.related_records ->> 'purchaseOrderId', '') || ' ' ||
  COALESCE(item.related_records ->> 'poNumber', '') || ' ' ||
  COALESCE(item.related_records ->> 'requestId', '') || ' ' ||
  COALESCE(item.related_records ->> 'orderId', '')
);

CREATE INDEX workflow_items_queue_priority_idx
  ON public.workflow_items (company_id, priority DESC, id)
  WHERE status IN ('active','blocked','approved');
CREATE INDEX workflow_items_queue_created_idx
  ON public.workflow_items (company_id, created_at DESC, id)
  WHERE status IN ('active','blocked','approved');
CREATE INDEX workflow_items_queue_updated_idx
  ON public.workflow_items (company_id, updated_at DESC, id)
  WHERE status IN ('active','blocked','approved');
CREATE INDEX workflow_items_queue_due_idx
  ON public.workflow_items (company_id, due_at, id)
  WHERE status IN ('active','blocked','approved');
CREATE INDEX workflow_items_queue_filters_idx
  ON public.workflow_items (
    company_id, item_type, source_type, owner_role, assignee_id, status
  );
CREATE INDEX workflow_items_queue_search_idx
  ON public.workflow_items USING GIN (queue_search_document);

-- Resolve is a decision about an item and deliberately does not require an
-- action draft. Existing decisions remain one-per-draft.
ALTER TABLE public.workflow_decisions
  ALTER COLUMN action_draft_id DROP NOT NULL,
  DROP CONSTRAINT workflow_decisions_decision_check,
  ADD CONSTRAINT workflow_decisions_decision_check CHECK (
    decision IN ('approve','edit','reject','request_rework','resolve')
  ),
  ADD CONSTRAINT workflow_decisions_resolve_draft_check CHECK (
    (decision = 'resolve' AND action_draft_id IS NULL)
    OR (decision <> 'resolve' AND action_draft_id IS NOT NULL)
  );

CREATE TABLE public.workflow_decision_outcomes (
  decision_id UUID NOT NULL,
  company_id UUID NOT NULL,
  workflow_item_id UUID NOT NULL,
  expected_version TEXT NOT NULL CHECK (expected_version ~ '^[a-f0-9]{64}$'),
  prior_state JSONB NOT NULL CHECK (jsonb_typeof(prior_state) = 'object'),
  result_state JSONB NOT NULL CHECK (jsonb_typeof(result_state) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id),
  FOREIGN KEY (decision_id, company_id)
    REFERENCES public.workflow_decisions(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_item_id, company_id)
    REFERENCES public.workflow_items(id, company_id) ON DELETE CASCADE
);

ALTER TABLE public.workflow_decision_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workflow_decision_outcomes
  FROM PUBLIC, anon, authenticated;

CREATE TABLE workflow_private.workflow_decision_receipts (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  workflow_item_id UUID NOT NULL,
  decision_id UUID NOT NULL,
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, actor_id, idempotency_key),
  FOREIGN KEY (workflow_item_id, company_id)
    REFERENCES public.workflow_items(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (decision_id, company_id)
    REFERENCES public.workflow_decisions(id, company_id) ON DELETE CASCADE,
  CONSTRAINT workflow_decision_receipts_key_check CHECK (
    length(idempotency_key) BETWEEN 8 AND 200
    AND idempotency_key !~ '[[:cntrl:]]'
  ),
  CONSTRAINT workflow_decision_receipts_no_secret_result_check CHECK (
    result::TEXT !~* '"(rawToken|tokenHash|authorization|password|secret|credential|apiKey|prompt|memoryRefs|trace)"[[:space:]]*:'
    AND result::TEXT !~* 'bearer[[:space:]]+[a-z0-9._~+/-]+'
  )
);

REVOKE ALL ON TABLE workflow_private.workflow_decision_receipts
  FROM PUBLIC, anon, authenticated;

-- Queue pages enumerate an immutable list of item identifiers, which prevents
-- updates between requests from causing duplicates or skipped work.
CREATE TABLE workflow_private.workflow_queue_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query_hash TEXT NOT NULL CHECK (query_hash ~ '^[a-f0-9]{64}$'),
  item_ids UUID[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
  CONSTRAINT workflow_queue_snapshots_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT workflow_queue_snapshots_item_limit_check CHECK (
    cardinality(item_ids) <= 10000
  )
);

CREATE INDEX workflow_queue_snapshots_actor_expiry_idx
  ON workflow_private.workflow_queue_snapshots (actor_id, expires_at);
REVOKE ALL ON TABLE workflow_private.workflow_queue_snapshots
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION workflow_private.sanitize_public_jsonb(p_value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  result JSONB;
  member RECORD;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      result := '{}'::JSONB;
      FOR member IN SELECT key, value FROM jsonb_each(p_value)
      LOOP
        IF lower(member.key) ~ '(access.?token|refresh.?token|raw.?token|token.?hash|authorization|password|secret|credential|api.?key|code.?verifier|prompt|hidden.?reason|chain.?of.?thought|memory.?ref|trace|langsmith|langgraph)' THEN
          CONTINUE;
        END IF;
        result := result || jsonb_build_object(
          member.key,
          workflow_private.sanitize_public_jsonb(member.value)
        );
      END LOOP;
      RETURN result;
    WHEN 'array' THEN
      SELECT COALESCE(
        jsonb_agg(workflow_private.sanitize_public_jsonb(value) ORDER BY ordinality),
        '[]'::JSONB
      )
      INTO result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY;
      RETURN result;
    WHEN 'string' THEN
      IF p_value #>> '{}' ~* '(bearer[[:space:]]+[a-z0-9._~+/-]{8,}|(rk|sk|pk)-[a-z0-9_-]{8,}|[a-z0-9_-]{10,}[.][a-z0-9_-]{10,}[.][a-z0-9_-]{10,}|-----begin[[:space:]][a-z0-9[:space:]]*private[[:space:]]+key-----|(password|secret|webhook[[:space:]_.-]*secret)[[:space:]]*[:=][[:space:]]*[^[:space:]]{4,})' THEN
        RETURN to_jsonb('[redacted]'::TEXT);
      END IF;
      RETURN p_value;
    ELSE
      RETURN p_value;
  END CASE;
END;
$$;

CREATE FUNCTION workflow_private.reject_immutable_workflow_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Foreign-key actions execute their row triggers below the initiating
  -- parent operation. Permit only that database-owned cascade path; direct
  -- point mutations, including privileged ones, remain forbidden.
  IF pg_catalog.pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'immutable_workflow_history' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER workflow_context_packets_immutable
BEFORE UPDATE OR DELETE ON public.workflow_context_packets
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_history();
CREATE TRIGGER workflow_recommendation_runs_immutable
BEFORE UPDATE OR DELETE ON public.workflow_recommendation_runs
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_history();
CREATE TRIGGER workflow_evidence_snapshots_immutable
BEFORE UPDATE OR DELETE ON public.workflow_evidence_snapshots
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_history();
CREATE TRIGGER workflow_decisions_immutable
BEFORE UPDATE OR DELETE ON public.workflow_decisions
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_history();
CREATE TRIGGER workflow_decision_outcomes_immutable
BEFORE UPDATE OR DELETE ON public.workflow_decision_outcomes
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_history();
CREATE TRIGGER workflow_audit_events_immutable
BEFORE UPDATE OR DELETE ON public.workflow_audit_events
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_history();
-- Items and runs are deletion roots for the append-only graph. Protect their
-- direct DELETE path without restricting normal state updates.
CREATE TRIGGER workflow_items_history_delete_guard
BEFORE DELETE ON public.workflow_items
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_history();
CREATE TRIGGER workflow_runs_history_delete_guard
BEFORE DELETE ON public.workflow_runs
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_immutable_workflow_history();

CREATE FUNCTION workflow_private.workflow_review_version(
  p_company_id UUID,
  p_workflow_item_id UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH item AS (
    SELECT i.*
    FROM public.workflow_items i
    WHERE i.company_id = p_company_id
      AND i.id = p_workflow_item_id
  ),
  draft AS (
    SELECT d.*
    FROM public.workflow_action_drafts d
    JOIN item ON item.id = d.workflow_item_id
    WHERE d.company_id = p_company_id
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1
  ),
  recommendation AS (
    SELECT r.*
    FROM public.workflow_recommendation_runs r
    JOIN item ON item.id = r.workflow_item_id
    WHERE r.company_id = p_company_id
      AND (
        (EXISTS (SELECT 1 FROM draft) AND r.id = (SELECT recommendation_run_id FROM draft))
        OR NOT EXISTS (SELECT 1 FROM draft)
      )
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 1
  ),
  evidence AS (
    SELECT e.*
    FROM public.workflow_evidence_snapshots e
    JOIN item ON item.id = e.workflow_item_id
    WHERE e.company_id = p_company_id
      AND (
        (EXISTS (SELECT 1 FROM draft) AND e.id = (SELECT evidence_snapshot_id FROM draft))
        OR NOT EXISTS (SELECT 1 FROM draft)
      )
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  ),
  context AS (
    SELECT c.*
    FROM public.workflow_context_packets c
    JOIN item ON item.id = c.workflow_item_id
    WHERE c.company_id = p_company_id
      AND (
        (EXISTS (SELECT 1 FROM recommendation) AND c.id = (SELECT context_packet_id FROM recommendation))
        OR NOT EXISTS (SELECT 1 FROM recommendation)
      )
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 1
  ),
  policy AS (
    SELECT p.*
    FROM public.company_approval_policies p
    JOIN item ON true
    JOIN public.workflow_runs run
      ON run.id = item.workflow_run_id
      AND run.company_id = item.company_id
    LEFT JOIN draft ON true
    WHERE p.company_id = p_company_id
      AND p.workflow_type = run.workflow_type
      AND p.action_type = draft.action_type
    LIMIT 1
  )
  SELECT encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'item', (SELECT jsonb_build_object(
            'id', id, 'status', status, 'priority', priority,
            'resolutionState', resolution_state, 'updatedAt', updated_at
          ) FROM item),
          'draft', (SELECT jsonb_build_object(
            'id', id, 'status', status, 'payloadHash', payload_hash,
            'updatedAt', updated_at
          ) FROM draft),
          'recommendation', (SELECT jsonb_build_object(
            'id', id, 'status', status, 'warningState', warning_state,
            'warnings', warnings, 'freshnessState', freshness_state,
            'createdAt', created_at
          ) FROM recommendation),
          'evidence', (SELECT jsonb_build_object('id', id, 'createdAt', created_at) FROM evidence),
          'context', (SELECT jsonb_build_object(
            'id', id, 'freshnessState', freshness_state,
            'warnings', warnings, 'createdAt', created_at
          ) FROM context),
          'policy', (SELECT jsonb_build_object(
            'id', id, 'minimumRole', minimum_role,
            'requireHumanApproval', require_human_approval,
            'requireWarningAcknowledgement', require_warning_acknowledgement,
            'updatedAt', updated_at
          ) FROM policy)
        )::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

CREATE FUNCTION workflow_private.workflow_activity_details(
  p_event_type TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT workflow_private.sanitize_public_jsonb(
    CASE p_event_type
      WHEN 'decision_recorded' THEN jsonb_strip_nulls(jsonb_build_object(
        'decisionId', p_payload -> 'decisionId',
        'actionDraftId', p_payload -> 'actionDraftId',
        'decision', p_payload -> 'decision',
        'edited', p_payload -> 'edited',
        'priorState', p_payload -> 'priorState',
        'resultState', p_payload -> 'resultState'
      ))
      WHEN 'mock_action_executed' THEN jsonb_strip_nulls(jsonb_build_object(
        'actionAttemptId', p_payload -> 'actionAttemptId',
        'mockExternalId', p_payload -> 'mockExternalId'
      ))
      WHEN 'mock_action_execution_failed' THEN jsonb_strip_nulls(
        jsonb_build_object('errorCode', p_payload -> 'errorCode')
      )
      WHEN 'execution_token_reissued' THEN jsonb_strip_nulls(jsonb_build_object(
        'decisionId', p_payload -> 'decisionId',
        'actionDraftId', p_payload -> 'actionDraftId'
      ))
      WHEN 'recommendation_created' THEN jsonb_strip_nulls(
        jsonb_build_object('recommendationRunId', p_payload -> 'recommendationRunId')
      )
      ELSE '{}'::JSONB
    END
  )
$$;

CREATE FUNCTION workflow_private.list_workflow_activity_v1(
  p_company_id UUID,
  p_workflow_item_id UUID,
  p_limit INTEGER,
  p_before_created_at TIMESTAMPTZ,
  p_before_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET jit = off
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  result JSONB;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL OR p_workflow_item_id IS NULL
    OR p_limit NOT BETWEEN 1 AND 100
    OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL))
  THEN
    RAISE EXCEPTION 'invalid_activity_request' USING ERRCODE = '22023';
  END IF;

  PERFORM workflow_private.require_company_role(
    p_company_id, 'viewer', current_user_id
  );
  PERFORM 1
  FROM public.workflow_items item
  WHERE item.id = p_workflow_item_id
    AND item.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH candidate AS (
    SELECT audit.*
    FROM public.workflow_audit_events audit
    WHERE audit.company_id = p_company_id
      AND audit.workflow_item_id = p_workflow_item_id
      AND (
        p_before_created_at IS NULL
        OR (audit.created_at, audit.id) < (p_before_created_at, p_before_id)
      )
    ORDER BY audit.created_at DESC, audit.id DESC
    LIMIT p_limit + 1
  ),
  page AS (
    SELECT *
    FROM candidate
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit
  ),
  projected AS (
    SELECT
      page.id,
      page.created_at,
      jsonb_build_object(
        'id', page.id,
        'type', page.event_type,
        'summary', workflow_private.sanitize_public_jsonb(to_jsonb(page.summary)),
        'details', workflow_private.workflow_activity_details(
          page.event_type, page.payload
        ),
        'actor', jsonb_build_object(
          'type', CASE page.actor_type
            WHEN 'system_agent' THEN 'agent'
            ELSE 'user'
          END,
          'id', page.actor_id
        ),
        'reason', workflow_private.sanitize_public_jsonb(to_jsonb(decision.reason)),
        'priorState', outcome.prior_state,
        'resultState', outcome.result_state,
        'createdAt', page.created_at
      ) AS value
    FROM page
    LEFT JOIN public.workflow_decisions decision
      ON decision.company_id = page.company_id
     AND decision.id::TEXT = page.payload ->> 'decisionId'
    LEFT JOIN public.workflow_decision_outcomes outcome
      ON outcome.company_id = decision.company_id
     AND outcome.decision_id = decision.id
  ),
  last_row AS (
    SELECT id, created_at
    FROM page
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'items', COALESCE(
      (SELECT jsonb_agg(value ORDER BY created_at DESC, id DESC) FROM projected),
      '[]'::JSONB
    ),
    'nextPage', CASE
      WHEN (SELECT count(*) FROM candidate) > p_limit THEN (
        SELECT jsonb_build_object(
          'beforeCreatedAt', created_at,
          'beforeId', id
        )
        FROM last_row
      )
      ELSE NULL
    END
  )
  INTO result;

  RETURN result;
END;
$$;

CREATE FUNCTION public.list_workflow_activity_v1(
  p_company_id UUID,
  p_workflow_item_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.list_workflow_activity_v1(
    p_company_id,
    p_workflow_item_id,
    p_limit,
    p_before_created_at,
    p_before_id
  )
$$;

CREATE FUNCTION workflow_private.normalize_workflow_queue_query(p_query JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  result JSONB;
  values_text TEXT[];
  member JSONB;
  member_text TEXT;
BEGIN
  IF jsonb_typeof(p_query) IS DISTINCT FROM 'object'
    OR pg_column_size(p_query) > 16384
    OR p_query - ARRAY['search','statuses','itemTypes','priorities','sourceTypes','ownerRoles','assigneeIds','sort','limit','snapshotId','position'] <> '{}'
  THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
  IF p_query ? 'search' AND (jsonb_typeof(p_query->'search')<>'string' OR length(p_query->>'search')>200 OR p_query->>'search' ~ '[[:cntrl:]]')
  THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
  IF p_query ? 'limit' AND (
    jsonb_typeof(p_query->'limit')<>'number'
    OR p_query->>'limit' !~ '^[0-9]{1,3}$'
    OR (p_query->>'limit')::INTEGER NOT BETWEEN 1 AND 100
  )
  THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
  IF p_query ? 'sort' AND (
    jsonb_typeof(p_query->'sort')<>'object'
    OR NOT (p_query->'sort' ?& ARRAY['key','direction'])
    OR (p_query->'sort') - ARRAY['key','direction'] <> '{}'
    OR jsonb_typeof(p_query#>'{sort,key}') <> 'string'
    OR jsonb_typeof(p_query#>'{sort,direction}') <> 'string'
    OR p_query#>>'{sort,key}' NOT IN ('priority','createdAt','updatedAt','dueAt')
    OR p_query#>>'{sort,direction}' NOT IN ('asc','desc')
  )
  THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
  IF (p_query?'snapshotId')<>(p_query?'position')
  THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
  IF p_query?'snapshotId' AND (
    jsonb_typeof(p_query->'snapshotId')<>'string'
    OR p_query->>'snapshotId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_query->'position')<>'number'
    OR p_query->>'position' !~ '^[0-9]{1,5}$'
    OR (p_query->>'position')::INTEGER NOT BETWEEN 0 AND 10000
  )
  THEN RAISE EXCEPTION 'invalid_queue_cursor' USING ERRCODE='22023'; END IF;

  IF p_query?'statuses' THEN
    IF jsonb_typeof(p_query->'statuses') <> 'array'
      OR jsonb_array_length(p_query->'statuses') NOT BETWEEN 1 AND 20
    THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    FOR member IN SELECT value FROM jsonb_array_elements(p_query->'statuses') LOOP
      IF jsonb_typeof(member) <> 'string' OR member #>> '{}' NOT IN ('active','blocked','approved','rejected','executed','resolved')
      THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    END LOOP;
    SELECT array_agg(value) INTO values_text FROM jsonb_array_elements_text(p_query->'statuses') value;
  ELSE values_text:=ARRAY['active','blocked','approved']; END IF;
  result:=jsonb_build_object('search',NULLIF(lower(btrim(COALESCE(p_query->>'search',''))),''),'statuses',values_text);

  IF p_query?'itemTypes' THEN
    IF jsonb_typeof(p_query->'itemTypes') <> 'array' OR jsonb_array_length(p_query->'itemTypes') NOT BETWEEN 1 AND 20
    THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    FOR member IN SELECT value FROM jsonb_array_elements(p_query->'itemTypes') LOOP
      member_text:=member#>>'{}';
      IF jsonb_typeof(member)<>'string' OR length(member_text)>100 OR member_text !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    END LOOP;
    SELECT array_agg(value) INTO values_text FROM jsonb_array_elements_text(p_query->'itemTypes') value;
  ELSE values_text:=ARRAY[]::TEXT[]; END IF;
  result:=result||jsonb_build_object('itemTypes',values_text);
  IF p_query?'sourceTypes' THEN
    IF jsonb_typeof(p_query->'sourceTypes') <> 'array' OR jsonb_array_length(p_query->'sourceTypes') NOT BETWEEN 1 AND 20
    THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    FOR member IN SELECT value FROM jsonb_array_elements(p_query->'sourceTypes') LOOP
      member_text:=member#>>'{}';
      IF jsonb_typeof(member)<>'string' OR length(member_text)>100 OR member_text !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    END LOOP;
    SELECT array_agg(value) INTO values_text FROM jsonb_array_elements_text(p_query->'sourceTypes') value;
  ELSE values_text:=ARRAY[]::TEXT[]; END IF;
  result:=result||jsonb_build_object('sourceTypes',values_text);
  IF p_query?'ownerRoles' THEN
    IF jsonb_typeof(p_query->'ownerRoles') <> 'array' OR jsonb_array_length(p_query->'ownerRoles') NOT BETWEEN 1 AND 20
    THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    FOR member IN SELECT value FROM jsonb_array_elements(p_query->'ownerRoles') LOOP
      IF jsonb_typeof(member)<>'string' OR member#>>'{}' NOT IN ('owner','admin','approver','member','viewer','agent')
      THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    END LOOP;
    SELECT array_agg(value) INTO values_text FROM jsonb_array_elements_text(p_query->'ownerRoles') value;
  ELSE values_text:=ARRAY[]::TEXT[]; END IF;
  result:=result||jsonb_build_object('ownerRoles',values_text);

  IF p_query?'priorities' THEN
    IF jsonb_typeof(p_query->'priorities') <> 'array' OR jsonb_array_length(p_query->'priorities') NOT BETWEEN 1 AND 20
    THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    FOR member IN SELECT value FROM jsonb_array_elements(p_query->'priorities') LOOP
      IF jsonb_typeof(member)<>'number' OR member#>>'{}' !~ '^[0-9]{1,3}$' OR (member#>>'{}')::INTEGER NOT BETWEEN 0 AND 100
      THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    END LOOP;
  END IF;

  IF p_query?'assigneeIds' THEN
    IF jsonb_typeof(p_query->'assigneeIds') <> 'array' OR jsonb_array_length(p_query->'assigneeIds') NOT BETWEEN 1 AND 20
    THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    FOR member IN SELECT value FROM jsonb_array_elements(p_query->'assigneeIds') LOOP
      IF jsonb_typeof(member)<>'string' OR member#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
    END LOOP;
  END IF;

  result:=result||jsonb_build_object(
    'priorities',COALESCE(p_query->'priorities','[]'),
    'assigneeIds',COALESCE(p_query->'assigneeIds','[]'),
    'sort',jsonb_build_object('key',COALESCE(p_query#>>'{sort,key}','priority'),'direction',COALESCE(p_query#>>'{sort,direction}','desc')),
    'limit',COALESCE((p_query->>'limit')::INTEGER,50),
    'snapshotId',p_query->'snapshotId','position',p_query->'position'
  );
  RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023';
END;
$$;

CREATE FUNCTION workflow_private.workflow_queue_item_ids(p_company_id UUID,p_normalized JSONB)
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET jit = off
AS $$
DECLARE
  ids UUID[];
  sql_text TEXT;
  sort_column TEXT;
  sort_direction TEXT:=p_normalized#>>'{sort,direction}';
BEGIN
  sort_column:=CASE p_normalized#>>'{sort,key}' WHEN 'priority' THEN 'item.priority' WHEN 'createdAt' THEN 'item.created_at' WHEN 'updatedAt' THEN 'item.updated_at' ELSE 'item.due_at' END;
  sql_text:=format('SELECT COALESCE(array_agg(id),ARRAY[]::UUID[]) FROM (SELECT item.id FROM public.workflow_items item JOIN public.workflow_events event ON event.id=item.workflow_event_id AND event.company_id=item.company_id WHERE item.company_id=$1 AND item.status=ANY($2) AND (cardinality($3)=0 OR item.item_type=ANY($3)) AND (cardinality($4)=0 OR item.priority=ANY($4)) AND (cardinality($5)=0 OR COALESCE(item.source_type,event.origin)=ANY($5)) AND (cardinality($6)=0 OR item.owner_role=ANY($6)) AND (cardinality($7)=0 OR item.assignee_id=ANY($7)) AND ($8 IS NULL OR item.queue_search_document @@ plainto_tsquery(''simple''::REGCONFIG,$8)) ORDER BY %s %s NULLS LAST,item.id %s LIMIT 10001) q',sort_column,upper(sort_direction),upper(sort_direction));
  EXECUTE sql_text INTO ids USING p_company_id,
    ARRAY(SELECT jsonb_array_elements_text(p_normalized->'statuses')),
    ARRAY(SELECT jsonb_array_elements_text(p_normalized->'itemTypes')),
    ARRAY(SELECT value::INTEGER FROM jsonb_array_elements_text(p_normalized->'priorities') value),
    ARRAY(SELECT jsonb_array_elements_text(p_normalized->'sourceTypes')),
    ARRAY(SELECT jsonb_array_elements_text(p_normalized->'ownerRoles')),
    ARRAY(SELECT value::UUID FROM jsonb_array_elements_text(p_normalized->'assigneeIds') value),
    p_normalized->>'search';
  RETURN ids;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023';
END;
$$;

CREATE FUNCTION workflow_private.workflow_available_actions(
  p_company_id UUID,
  p_item_id UUID,
  p_actor_role TEXT
)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET jit = off
AS $$
  WITH item AS (
    SELECT i.*, run.workflow_type
    FROM public.workflow_items i
    JOIN public.workflow_runs run
      ON run.id = i.workflow_run_id
     AND run.company_id = i.company_id
    WHERE i.company_id = p_company_id
      AND i.id = p_item_id
  ), draft AS (
    SELECT d.*
    FROM public.workflow_action_drafts d
    JOIN item ON item.id = d.workflow_item_id
    WHERE d.company_id = p_company_id
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1
  ), recommendation AS (
    SELECT r.*
    FROM public.workflow_recommendation_runs r
    JOIN draft
      ON r.id = draft.recommendation_run_id
     AND r.company_id = draft.company_id
  ), context AS (
    SELECT c.*
    FROM public.workflow_context_packets c
    JOIN recommendation r
      ON c.id = r.context_packet_id
     AND c.company_id = r.company_id
  ), evidence AS (
    SELECT e.*
    FROM public.workflow_evidence_snapshots e
    JOIN draft
      ON e.id = draft.evidence_snapshot_id
     AND e.company_id = draft.company_id
  ), selected AS (
    SELECT
      item.*,
      draft.id AS draft_id,
      draft.action_type,
      draft.status AS draft_status,
      draft.edit_policy,
      recommendation.status AS recommendation_status,
      recommendation.warning_state,
      recommendation.freshness_state AS recommendation_freshness_state,
      context.id AS context_id,
      context.freshness_state AS context_freshness_state,
      evidence.id AS evidence_id,
      COALESCE(policy.minimum_role, 'approver') AS minimum_role
    FROM item
    LEFT JOIN draft ON true
    LEFT JOIN recommendation ON true
    LEFT JOIN context ON true
    LEFT JOIN evidence ON true
    LEFT JOIN public.company_approval_policies policy
      ON policy.company_id = item.company_id
     AND policy.workflow_type = item.workflow_type
     AND policy.action_type = draft.action_type
  )
  SELECT COALESCE(array_remove(ARRAY[
    CASE WHEN public.company_role_rank(p_actor_role) >= public.company_role_rank(minimum_role)
      AND status IN ('active','blocked') THEN 'resolve' END,
    CASE WHEN public.company_role_rank(p_actor_role) >= public.company_role_rank(minimum_role)
      AND status IN ('active','blocked') AND draft_status='pending_review' THEN 'reject' END,
    CASE WHEN public.company_role_rank(p_actor_role) >= public.company_role_rank(minimum_role)
      AND status IN ('active','blocked') AND draft_status='pending_review' THEN 'request_rework' END,
    CASE WHEN public.company_role_rank(p_actor_role) >= public.company_role_rank(minimum_role)
      AND status IN ('active','blocked') AND draft_status='pending_review'
      AND recommendation_status='ready_for_review' AND warning_state<>'blocked'
      AND context_freshness_state<>'stale' AND recommendation_freshness_state<>'stale'
      AND evidence_id IS NOT NULL THEN 'approve' END,
    CASE WHEN public.company_role_rank(p_actor_role) >= public.company_role_rank(minimum_role)
      AND status IN ('active','blocked') AND draft_status='pending_review'
      AND recommendation_status='ready_for_review' AND warning_state<>'blocked'
      AND context_freshness_state<>'stale' AND recommendation_freshness_state<>'stale'
      AND evidence_id IS NOT NULL
      AND COALESCE((edit_policy->>'editable')::BOOLEAN,false) THEN 'edit' END,
    CASE WHEN public.company_role_rank(p_actor_role) >= public.company_role_rank(minimum_role)
      AND status='approved' AND draft_status='approved' THEN 'execute_mock' END
  ]::TEXT[],NULL), ARRAY[]::TEXT[])
  FROM selected
$$;

CREATE FUNCTION workflow_private.workflow_queue_item_projection(p_company_id UUID,p_item_id UUID,p_actor_role TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET jit = off
AS $$
  WITH item AS (
    SELECT i.*,e.origin FROM public.workflow_items i JOIN public.workflow_events e ON e.id=i.workflow_event_id AND e.company_id=i.company_id WHERE i.company_id=p_company_id AND i.id=p_item_id
  ), draft AS (
    SELECT d.* FROM public.workflow_action_drafts d JOIN item ON item.id=d.workflow_item_id WHERE d.company_id=p_company_id ORDER BY d.created_at DESC,d.id DESC LIMIT 1
  ), recommendation AS (
    SELECT r.* FROM public.workflow_recommendation_runs r JOIN draft ON r.id=draft.recommendation_run_id AND r.company_id=draft.company_id
  ), context AS (
    SELECT c.* FROM public.workflow_context_packets c JOIN recommendation r ON c.id=r.context_packet_id AND c.company_id=r.company_id
  ), evidence AS (
    SELECT e.* FROM public.workflow_evidence_snapshots e JOIN draft ON e.id=draft.evidence_snapshot_id AND e.company_id=draft.company_id
  )
  SELECT jsonb_build_object('id',item.id,'workflowRunId',item.workflow_run_id,'itemKey',item.item_key,'itemType',item.item_type,'title',item.title,'status',item.status,'priority',item.priority,'sourceType',COALESCE(item.source_type,item.origin),'ownerRole',item.owner_role,'assigneeId',item.assignee_id,'dueAt',item.due_at,'draft',CASE WHEN draft.id IS NULL THEN NULL ELSE jsonb_build_object('id',draft.id,'actionType',draft.action_type,'status',draft.status,'updatedAt',draft.updated_at) END,'nextActions',to_jsonb(workflow_private.workflow_available_actions(p_company_id,item.id,p_actor_role)),'createdAt',item.created_at,'updatedAt',item.updated_at)
  FROM item LEFT JOIN draft ON true
$$;

CREATE OR REPLACE FUNCTION workflow_private.list_workflow_queue_v1(p_company_id UUID,p_query JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid UUID;
  role_name TEXT;
  normalized JSONB;
  canonical_hash TEXT;
  sid UUID;
  pos INTEGER:=0;
  item_ids UUID[];
  created TIMESTAMPTZ;
  item_id UUID;
  page_items JSONB:='[]'::JSONB;
  page_limit INTEGER;
BEGIN
  uid:=auth.uid();
  IF uid IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501'; END IF;
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'invalid_queue_query' USING ERRCODE='22023'; END IF;
  role_name:=workflow_private.require_company_role(p_company_id,'viewer',uid);
  normalized:=workflow_private.normalize_workflow_queue_query(p_query);
  page_limit:=(normalized->>'limit')::INTEGER;
  canonical_hash:=encode(extensions.digest(convert_to((normalized-ARRAY['snapshotId','position','limit'])::TEXT,'UTF8'),'sha256'),'hex');
  IF normalized->>'snapshotId' IS NOT NULL THEN
    BEGIN sid:=(normalized->>'snapshotId')::UUID; pos:=(normalized->>'position')::INTEGER; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_queue_cursor' USING ERRCODE='22023'; END;
    SELECT s.item_ids,s.created_at INTO item_ids,created FROM workflow_private.workflow_queue_snapshots s WHERE s.id=sid AND s.company_id=p_company_id AND s.actor_id=uid AND s.query_hash=canonical_hash AND s.expires_at>now();
    IF NOT FOUND OR pos<0 OR pos>cardinality(item_ids) THEN RAISE EXCEPTION 'invalid_queue_cursor' USING ERRCODE='22023'; END IF;
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('workflow-queue-snapshots:' || uid::TEXT, 0)
    );
    DELETE FROM workflow_private.workflow_queue_snapshots s
    WHERE s.expires_at <= now();
    DELETE FROM workflow_private.workflow_queue_snapshots stale
    WHERE stale.id IN (
      SELECT candidate.id
      FROM workflow_private.workflow_queue_snapshots candidate
      WHERE candidate.actor_id = uid
        AND candidate.expires_at > now()
      ORDER BY candidate.created_at DESC, candidate.id DESC
      OFFSET 19
    );
    item_ids:=workflow_private.workflow_queue_item_ids(p_company_id,normalized);
    IF cardinality(item_ids)>10000 THEN RAISE EXCEPTION 'queue_query_too_broad' USING ERRCODE='54000'; END IF;
    INSERT INTO workflow_private.workflow_queue_snapshots(company_id,actor_id,query_hash,item_ids)
    VALUES(p_company_id,uid,canonical_hash,item_ids)
    RETURNING id,created_at INTO sid,created;
  END IF;
  FOREACH item_id IN ARRAY COALESCE(item_ids[pos+1:LEAST(pos+page_limit,cardinality(item_ids))],ARRAY[]::UUID[]) LOOP
    page_items:=page_items||jsonb_build_array(workflow_private.workflow_queue_item_projection(p_company_id,item_id,role_name));
  END LOOP;
  RETURN jsonb_build_object('items',page_items,'nextPage',CASE WHEN pos+page_limit<cardinality(item_ids) THEN jsonb_build_object('snapshotId',sid,'position',pos+page_limit,'snapshotAt',created) ELSE NULL END);
END;
$$;

CREATE FUNCTION public.list_workflow_queue_v1(
  p_company_id UUID,
  p_query JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.list_workflow_queue_v1(p_company_id, p_query)
$$;

CREATE FUNCTION workflow_private.get_workflow_review_v1(
  p_company_id UUID,
  p_workflow_item_id UUID,
  p_activity_limit INTEGER,
  p_activity_before_created_at TIMESTAMPTZ,
  p_activity_before_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  membership_role TEXT;
  item public.workflow_items%ROWTYPE;
  event public.workflow_events%ROWTYPE;
  context public.workflow_context_packets%ROWTYPE;
  recommendation public.workflow_recommendation_runs%ROWTYPE;
  evidence public.workflow_evidence_snapshots%ROWTYPE;
  draft public.workflow_action_drafts%ROWTYPE;
  policy public.company_approval_policies%ROWTYPE;
  minimum_role TEXT := 'approver';
  require_human_approval BOOLEAN := true;
  require_warning_acknowledgement BOOLEAN := true;
  review_state TEXT;
  available_actions TEXT[] := ARRAY[]::TEXT[];
  version TEXT;
  activity JSONB;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL OR p_workflow_item_id IS NULL
    OR p_activity_limit NOT BETWEEN 1 AND 100
    OR ((p_activity_before_created_at IS NULL) <> (p_activity_before_id IS NULL))
  THEN
    RAISE EXCEPTION 'invalid_review_request' USING ERRCODE = '22023';
  END IF;
  membership_role := workflow_private.require_company_role(
    p_company_id, 'viewer', current_user_id
  );

  SELECT candidate.* INTO item
  FROM public.workflow_items candidate
  WHERE candidate.company_id = p_company_id
    AND candidate.id = p_workflow_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT candidate.* INTO STRICT event
  FROM public.workflow_events candidate
  WHERE candidate.company_id = p_company_id
    AND candidate.id = item.workflow_event_id;
  SELECT candidate.* INTO draft
  FROM public.workflow_action_drafts candidate
  WHERE candidate.company_id = p_company_id
    AND candidate.workflow_item_id = item.id
  ORDER BY candidate.created_at DESC, candidate.id DESC
  LIMIT 1;
  SELECT candidate.* INTO recommendation
  FROM public.workflow_recommendation_runs candidate
  WHERE candidate.company_id = p_company_id
    AND candidate.workflow_item_id = item.id
    AND (
      (draft.id IS NOT NULL AND candidate.id = draft.recommendation_run_id)
      OR draft.id IS NULL
    )
  ORDER BY candidate.created_at DESC, candidate.id DESC
  LIMIT 1;
  SELECT candidate.* INTO context
  FROM public.workflow_context_packets candidate
  WHERE candidate.company_id = p_company_id
    AND candidate.workflow_item_id = item.id
    AND (
      (recommendation.id IS NOT NULL AND candidate.id = recommendation.context_packet_id)
      OR recommendation.id IS NULL
    )
  ORDER BY candidate.created_at DESC, candidate.id DESC
  LIMIT 1;
  SELECT candidate.* INTO evidence
  FROM public.workflow_evidence_snapshots candidate
  WHERE candidate.company_id = p_company_id
    AND candidate.workflow_item_id = item.id
    AND (
      (draft.id IS NOT NULL AND candidate.id = draft.evidence_snapshot_id)
      OR draft.id IS NULL
    )
  ORDER BY candidate.created_at DESC, candidate.id DESC
  LIMIT 1;

  IF draft.id IS NOT NULL THEN
    SELECT candidate.* INTO policy
    FROM public.company_approval_policies candidate
    JOIN public.workflow_runs run
      ON run.company_id = candidate.company_id
     AND run.workflow_type = candidate.workflow_type
    WHERE candidate.company_id = p_company_id
      AND run.id = item.workflow_run_id
      AND candidate.action_type = draft.action_type
    LIMIT 1;
    minimum_role := COALESCE(policy.minimum_role, 'approver');
    require_human_approval := COALESCE(policy.require_human_approval, true);
    require_warning_acknowledgement := COALESCE(
      policy.require_warning_acknowledgement, true
    );
  END IF;

  review_state := CASE
    WHEN item.status IN ('approved','rejected','executed','resolved')
      OR draft.status IN ('approved','rejected','rework_requested','executed')
      THEN 'already_resolved'
    WHEN context.id IS NULL OR recommendation.id IS NULL
      OR evidence.id IS NULL OR draft.id IS NULL
      THEN 'missing_context'
    WHEN item.status = 'blocked'
      OR recommendation.status = 'blocked'
      OR recommendation.warning_state = 'blocked'
      THEN 'blocked'
    WHEN context.freshness_state = 'stale'
      OR recommendation.freshness_state = 'stale'
      THEN 'stale'
    ELSE 'ready'
  END;

  available_actions := workflow_private.workflow_available_actions(
    p_company_id, item.id, membership_role
  );

  version := workflow_private.workflow_review_version(p_company_id, item.id);
  activity := workflow_private.list_workflow_activity_v1(
    p_company_id,
    item.id,
    p_activity_limit,
    p_activity_before_created_at,
    p_activity_before_id
  );

  RETURN jsonb_build_object(
    'item', jsonb_build_object(
      'id', item.id,
      'workflowRunId', item.workflow_run_id,
      'itemKey', item.item_key,
      'itemType', item.item_type,
      'title', item.title,
      'status', item.status,
      'priority', item.priority,
      'sourceType', COALESCE(item.source_type, event.origin),
      'ownerRole', item.owner_role,
      'assigneeId', item.assignee_id,
      'dueAt', item.due_at,
      'draft', CASE WHEN draft.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', draft.id, 'actionType', draft.action_type,
        'status', draft.status, 'updatedAt', draft.updated_at
      ) END,
      'nextActions', to_jsonb(available_actions),
      'createdAt', item.created_at,
      'updatedAt', item.updated_at
    ),
    'recordSnapshot', CASE WHEN context.id IS NULL THEN NULL ELSE jsonb_build_object(
      'contextPacketId', context.id,
      'sources', workflow_private.sanitize_public_jsonb(context.sources),
      'facts', workflow_private.sanitize_public_jsonb(context.facts),
      'freshnessState', context.freshness_state,
      'warnings', workflow_private.sanitize_public_jsonb(context.warnings),
      'capturedAt', context.created_at
    ) END,
    'recommendation', CASE WHEN recommendation.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', recommendation.id,
      'status', recommendation.status,
      'rationaleSummary', workflow_private.sanitize_public_jsonb(
        to_jsonb(recommendation.rationale_summary)
      ),
      'warningState', recommendation.warning_state,
      'warnings', workflow_private.sanitize_public_jsonb(recommendation.warnings),
      'confidence', recommendation.confidence,
      'freshnessState', recommendation.freshness_state,
      'output', workflow_private.sanitize_public_jsonb(recommendation.output),
      'createdAt', recommendation.created_at
    ) END,
    'evidence', CASE WHEN evidence.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', evidence.id,
      'sourceRefs', workflow_private.sanitize_public_jsonb(evidence.source_refs),
      'assumptions', workflow_private.sanitize_public_jsonb(evidence.assumptions),
      'warnings', workflow_private.sanitize_public_jsonb(evidence.warnings),
      'evidence', workflow_private.sanitize_public_jsonb(evidence.evidence),
      'createdAt', evidence.created_at
    ) END,
    'draft', CASE WHEN draft.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', draft.id,
      'actionType', draft.action_type,
      'status', draft.status,
      'payload', workflow_private.sanitize_public_jsonb(draft.payload),
      'editPolicy', workflow_private.sanitize_public_jsonb(draft.edit_policy),
      'updatedAt', draft.updated_at
    ) END,
    'policy', jsonb_build_object(
      'minimumRole', minimum_role,
      'requireHumanApproval', require_human_approval,
      'requireWarningAcknowledgement', require_warning_acknowledgement
    ),
    'reviewState', review_state,
    'version', version,
    'availableActions', to_jsonb(available_actions),
    'activity', activity
  );
END;
$$;

CREATE FUNCTION public.get_workflow_review_v1(
  p_company_id UUID,
  p_workflow_item_id UUID,
  p_activity_limit INTEGER DEFAULT 50,
  p_activity_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_activity_before_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.get_workflow_review_v1(
    p_company_id,
    p_workflow_item_id,
    p_activity_limit,
    p_activity_before_created_at,
    p_activity_before_id
  )
$$;

CREATE FUNCTION workflow_private.record_workflow_decision_v2(
  p_company_id UUID,
  p_workflow_item_id UUID,
  p_action_draft_id UUID,
  p_decision TEXT,
  p_expected_version TEXT,
  p_idempotency_key TEXT,
  p_reason TEXT,
  p_warnings_acknowledged BOOLEAN,
  p_edited_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  item public.workflow_items%ROWTYPE;
  draft public.workflow_action_drafts%ROWTYPE;
  selected_draft public.workflow_action_drafts%ROWTYPE;
  run public.workflow_runs%ROWTYPE;
  context public.workflow_context_packets%ROWTYPE;
  recommendation public.workflow_recommendation_runs%ROWTYPE;
  evidence public.workflow_evidence_snapshots%ROWTYPE;
  decision_record public.workflow_decisions%ROWTYPE;
  policy public.company_approval_policies%ROWTYPE;
  receipt workflow_private.workflow_decision_receipts%ROWTYPE;
  mutation_result JSONB;
  canonical_request JSONB;
  request_hash TEXT;
  current_version TEXT;
  next_version TEXT;
  prior_state JSONB;
  result_state JSONB;
  response JSONB;
  safe_receipt_result JSONB;
  execution_token JSONB := NULL;
  minimum_role TEXT := 'approver';
  policy_action_type TEXT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL OR p_workflow_item_id IS NULL
    OR p_decision NOT IN ('approve','edit','reject','request_rework','resolve')
    OR p_expected_version IS NULL
    OR p_expected_version !~ '^[a-f0-9]{64}$'
    OR p_idempotency_key IS NULL
    OR length(p_idempotency_key) NOT BETWEEN 8 AND 200
    OR p_idempotency_key ~ '[[:cntrl:]]'
    OR (p_reason IS NOT NULL AND (
      length(p_reason) > 2000 OR p_reason ~ '[[:cntrl:]]'
    ))
    OR (p_edited_payload IS NOT NULL AND (
      jsonb_typeof(p_edited_payload) <> 'object'
      OR pg_column_size(p_edited_payload) > 65536
    ))
    OR (p_decision = 'resolve' AND p_action_draft_id IS NOT NULL)
    OR (p_decision <> 'resolve' AND p_action_draft_id IS NULL)
    OR (p_decision = 'edit' AND p_edited_payload IS NULL)
    OR (p_decision <> 'edit' AND p_edited_payload IS NOT NULL)
  THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  -- Authenticate tenant access before taking any item, run, or draft lock so
  -- outsiders cannot use error or timing differences to discover identifiers.
  PERFORM workflow_private.require_company_role(
    p_company_id, 'viewer', current_user_id
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::TEXT || ':' || current_user_id::TEXT || ':' || p_idempotency_key,
      0
    )
  );

  canonical_request := jsonb_build_object(
    'companyId', p_company_id,
    'workItemId', p_workflow_item_id,
    'actionDraftId', p_action_draft_id,
    'decision', p_decision,
    'expectedVersion', p_expected_version,
    'reason', p_reason,
    'warningsAcknowledged', COALESCE(p_warnings_acknowledged, false),
    'editedPayload', p_edited_payload
  );
  request_hash := encode(
    extensions.digest(convert_to(canonical_request::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT candidate.* INTO receipt
  FROM workflow_private.workflow_decision_receipts candidate
  WHERE candidate.company_id = p_company_id
    AND candidate.actor_id = current_user_id
    AND candidate.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF receipt.request_hash <> request_hash THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '23505';
    END IF;
    RETURN receipt.result || jsonb_build_object(
      'duplicate', true,
      'executionToken', NULL,
      'needsTokenReissue', p_decision IN ('approve','edit')
    );
  END IF;

  SELECT candidate.* INTO item
  FROM public.workflow_items candidate
  WHERE candidate.id = p_workflow_item_id
    AND candidate.company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT candidate.* INTO STRICT run
  FROM public.workflow_runs candidate
  WHERE candidate.id = item.workflow_run_id
    AND candidate.company_id = p_company_id
  FOR UPDATE;

  SELECT candidate.* INTO selected_draft
  FROM public.workflow_action_drafts candidate
  WHERE candidate.company_id = p_company_id
    AND candidate.workflow_item_id = item.id
  ORDER BY candidate.created_at DESC, candidate.id DESC
  LIMIT 1
  FOR UPDATE;

  IF p_action_draft_id IS NOT NULL THEN
    IF selected_draft.id IS NULL THEN
      RAISE EXCEPTION 'draft_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF selected_draft.id IS DISTINCT FROM p_action_draft_id THEN
      RAISE EXCEPTION 'stale_draft' USING ERRCODE = '40001';
    END IF;
    draft := selected_draft;
    policy_action_type := draft.action_type;
    SELECT candidate.* INTO context
    FROM public.workflow_context_packets candidate
    WHERE candidate.company_id = p_company_id
      AND candidate.workflow_item_id = item.id
      AND candidate.id = (
        SELECT selected.context_packet_id
        FROM public.workflow_recommendation_runs selected
        WHERE selected.id = draft.recommendation_run_id
          AND selected.company_id = p_company_id
      )
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1;
    SELECT candidate.* INTO recommendation
    FROM public.workflow_recommendation_runs candidate
    WHERE candidate.company_id = p_company_id
      AND candidate.workflow_item_id = item.id
      AND candidate.id = draft.recommendation_run_id
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1;
    SELECT candidate.* INTO evidence
    FROM public.workflow_evidence_snapshots candidate
    WHERE candidate.company_id = p_company_id
      AND candidate.workflow_item_id = item.id
      AND candidate.id = draft.evidence_snapshot_id
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1;
  ELSE
    policy_action_type := selected_draft.action_type;
  END IF;
  IF policy_action_type IS NOT NULL THEN
    SELECT candidate.* INTO policy
    FROM public.company_approval_policies candidate
    WHERE candidate.company_id = p_company_id
      AND candidate.workflow_type = run.workflow_type
      AND candidate.action_type = policy_action_type
    FOR SHARE;
    minimum_role := COALESCE(policy.minimum_role, 'approver');
  END IF;
  PERFORM workflow_private.require_company_role(
    p_company_id, minimum_role, current_user_id
  );

  current_version := workflow_private.workflow_review_version(
    p_company_id, p_workflow_item_id
  );
  IF current_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'stale_version' USING ERRCODE = '40001';
  END IF;
  IF p_decision IN ('approve','edit') AND (
    context.id IS NULL
    OR evidence.id IS NULL
    OR recommendation.id IS NULL
    OR recommendation.status <> 'ready_for_review'
    OR recommendation.warning_state = 'blocked'
    OR context.freshness_state = 'stale'
    OR recommendation.freshness_state = 'stale'
  ) THEN
    RAISE EXCEPTION 'review_not_approvable' USING ERRCODE = '55000';
  END IF;

  prior_state := jsonb_build_object(
    'itemStatus', item.status,
    'draftStatus', CASE WHEN draft.id IS NULL THEN NULL ELSE draft.status END
  );

  IF p_decision = 'resolve' THEN
    IF item.status NOT IN ('active','blocked') THEN
      RAISE EXCEPTION 'invalid_state' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.workflow_decisions (
      id, company_id, workflow_run_id, workflow_item_id, action_draft_id,
      decision, actor_type, decided_by, reason, warnings_acknowledged,
      edited_payload
    ) VALUES (
      gen_random_uuid(), p_company_id, item.workflow_run_id, item.id, NULL,
      'resolve', 'user', current_user_id, p_reason,
      COALESCE(p_warnings_acknowledged, false), NULL
    ) RETURNING * INTO decision_record;

    UPDATE public.workflow_items candidate
    SET status = 'resolved',
        resolution_state = candidate.resolution_state || jsonb_build_object(
          'lastDecision', 'resolve',
          'reason', p_reason,
          'warningsAcknowledged', COALESCE(p_warnings_acknowledged, false)
        ),
        updated_at = now()
    WHERE candidate.id = item.id
      AND candidate.company_id = p_company_id
    RETURNING * INTO item;
    result_state := jsonb_build_object(
      'itemStatus', item.status,
      'draftStatus', NULL
    );

    INSERT INTO public.workflow_audit_events (
      id, company_id, actor_type, actor_id, workflow_run_id,
      workflow_item_id, event_type, summary, payload, trace
    ) VALUES (
      gen_random_uuid(), p_company_id, 'user', current_user_id,
      item.workflow_run_id, item.id, 'decision_recorded',
      'Workflow decision recorded: resolve.',
      jsonb_build_object(
        'decisionId', decision_record.id,
        'decision', 'resolve',
        'priorState', prior_state,
        'resultState', result_state
      ),
      '{}'::JSONB
    );
  ELSE
    IF item.status NOT IN ('active','blocked') OR draft.status <> 'pending_review' THEN
      RAISE EXCEPTION 'invalid_state' USING ERRCODE = '55000';
    END IF;
    mutation_result := workflow_private.record_workflow_decision(
      p_company_id,
      p_action_draft_id,
      p_decision,
      p_reason,
      COALESCE(p_warnings_acknowledged, false),
      p_edited_payload
    );
    SELECT candidate.* INTO STRICT decision_record
    FROM public.workflow_decisions candidate
    WHERE candidate.id = (mutation_result #>> '{decision,id}')::UUID
      AND candidate.company_id = p_company_id;
    SELECT candidate.* INTO STRICT item
    FROM public.workflow_items candidate
    WHERE candidate.id = p_workflow_item_id
      AND candidate.company_id = p_company_id;
    SELECT candidate.* INTO STRICT draft
    FROM public.workflow_action_drafts candidate
    WHERE candidate.id = p_action_draft_id
      AND candidate.company_id = p_company_id;
    result_state := jsonb_build_object(
      'itemStatus', item.status,
      'draftStatus', draft.status
    );
    execution_token := mutation_result -> 'executionToken';
  END IF;

  INSERT INTO public.workflow_decision_outcomes (
    decision_id, company_id, workflow_item_id, expected_version,
    prior_state, result_state
  ) VALUES (
    decision_record.id, p_company_id, item.id, p_expected_version,
    prior_state, result_state
  );
  next_version := workflow_private.workflow_review_version(
    p_company_id, p_workflow_item_id
  );

  response := jsonb_build_object(
    'decision', jsonb_build_object(
      'id', decision_record.id,
      'decision', decision_record.decision,
      'reason', workflow_private.sanitize_public_jsonb(
        to_jsonb(decision_record.reason)
      ),
      'warningsAcknowledged', decision_record.warnings_acknowledged,
      'createdAt', decision_record.created_at
    ),
    'draft', CASE WHEN draft.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', draft.id,
      'actionType', draft.action_type,
      'status', draft.status,
      'updatedAt', draft.updated_at
    ) END,
    'item', jsonb_build_object(
      'id', item.id,
      'workflowRunId', item.workflow_run_id,
      'itemKey', item.item_key,
      'itemType', item.item_type,
      'title', item.title,
      'status', item.status,
      'priority', item.priority,
      'sourceType', item.source_type,
      'ownerRole', item.owner_role,
      'assigneeId', item.assignee_id,
      'dueAt', item.due_at,
      'draft', CASE WHEN draft.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', draft.id, 'actionType', draft.action_type,
        'status', draft.status, 'updatedAt', draft.updated_at
      ) END,
      'nextActions', '[]'::JSONB,
      'createdAt', item.created_at,
      'updatedAt', item.updated_at
    ),
    'executionToken', execution_token,
    'duplicate', false,
    'needsTokenReissue', false,
    'priorState', prior_state,
    'resultState', result_state,
    'version', next_version
  );
  safe_receipt_result := response - 'executionToken';

  INSERT INTO workflow_private.workflow_decision_receipts (
    company_id, actor_id, idempotency_key, request_hash,
    workflow_item_id, decision_id, result
  ) VALUES (
    p_company_id, current_user_id, p_idempotency_key, request_hash,
    item.id, decision_record.id, safe_receipt_result
  );

  RETURN response;
END;
$$;

CREATE FUNCTION public.record_workflow_decision_v2(
  p_company_id UUID,
  p_workflow_item_id UUID,
  p_decision TEXT,
  p_expected_version TEXT,
  p_idempotency_key TEXT,
  p_action_draft_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_warnings_acknowledged BOOLEAN DEFAULT false,
  p_edited_payload JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.record_workflow_decision_v2(
    p_company_id,
    p_workflow_item_id,
    p_action_draft_id,
    p_decision,
    p_expected_version,
    p_idempotency_key,
    p_reason,
    p_warnings_acknowledged,
    p_edited_payload
  )
$$;

REVOKE ALL ON FUNCTION workflow_private.sanitize_public_jsonb(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.refresh_workflow_queue_search_document()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.reject_immutable_workflow_history()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.workflow_review_version(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.workflow_activity_details(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.list_workflow_activity_v1(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.list_workflow_queue_v1(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.normalize_workflow_queue_query(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.workflow_queue_item_ids(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.workflow_queue_item_projection(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.workflow_available_actions(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.get_workflow_review_v1(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_workflow_decision(
  UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_workflow_decision_v2(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.list_workflow_queue_v1(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_workflow_review_v1(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_workflow_activity_v1(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_workflow_decision(
  UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_workflow_decision_v2(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;

-- Raw workflow records include internal payloads, traces, memory references,
-- and token-adjacent state. Product reads must go through the projections above.
REVOKE SELECT ON TABLE
  public.workflow_runs,
  public.workflow_events,
  public.workflow_items,
  public.workflow_context_packets,
  public.workflow_recommendation_runs,
  public.workflow_evidence_snapshots,
  public.workflow_action_drafts,
  public.workflow_decisions,
  public.workflow_execution_tokens,
  public.workflow_action_attempts,
  public.workflow_audit_events,
  public.workflow_decision_outcomes
FROM authenticated;

GRANT EXECUTE ON FUNCTION public.list_workflow_queue_v1(UUID, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workflow_review_v1(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_workflow_activity_v1(
  UUID, UUID, INTEGER, TIMESTAMPTZ, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_decision_v2(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, JSONB
) TO authenticated;
