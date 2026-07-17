-- The full Context corpus makes admission checks a hot path. The claim RPC
-- verifies whether a canonical record has ever been admitted by joining its
-- outbox history to claimed events. These indexes keep that safety check and
-- pending-work ordering bounded as the queue grows.

CREATE INDEX context_index_events_claimed_outbox_idx
  ON public.context_index_events(company_id, provider, outbox_id)
  WHERE event_type = 'claimed' AND outbox_id IS NOT NULL;

CREATE INDEX context_index_outbox_pending_company_idx
  ON public.context_index_outbox(
    company_id, provider, available_at, created_at, id
  )
  WHERE delivery_state IN ('pending', 'retry');
