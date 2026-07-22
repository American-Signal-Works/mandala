-- Keep connector credentials and raw sync failures server-only. Production
-- briefly received a table-wide SELECT grant while the Sandbox reader still
-- ran as the caller. The reader now uses an authorized server-side client, so
-- restore the original column-scoped member projection in every environment.
revoke select on table public.external_sources from authenticated;
grant select (
  id,
  company_id,
  source_key,
  kind,
  name,
  sync_status,
  last_synced_at,
  created_at,
  updated_at
) on table public.external_sources to authenticated;

-- The snapshot ranks a bounded set of SKUs, then enriches only those rows.
-- This index keeps the bounded enrichment probes cheap as connector data grows.
create index if not exists external_records_company_type_sku_updated_idx
  on public.external_records (
    company_id,
    record_type,
    ((payload->>'sku')),
    updated_at desc
  )
  where coalesce(payload->>'sku', '') <> '';

create or replace function sandbox_private.build_workspace_snapshot_v1(
  p_company_id uuid,
  p_candidate_limit integer default 25
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with
authorized as materialized (
  select 1
  where public.has_company_role(p_company_id, 'viewer')
),
bounded as (
  select least(greatest(coalesce(p_candidate_limit, 25), 1), 100) as candidate_limit
),
catalog_stats as materialized (
  select
    catalog.source_id,
    sum(catalog.record_count)::integer as record_count,
    max(catalog.freshest_observed_at) as freshest_record_at
  from public.workspace_data_catalogs catalog
  where catalog.company_id = p_company_id
    and exists (select 1 from authorized)
  group by catalog.source_id
),
source_stats as (
  select
    source.id,
    source.source_key,
    source.kind,
    source.name,
    source.sync_status,
    source.last_synced_at,
    coalesce(catalog.record_count, 0) as record_count,
    catalog.freshest_record_at
  from public.external_sources source
  left join catalog_stats catalog on catalog.source_id = source.id
  where source.company_id = p_company_id
    and exists (select 1 from authorized)
),
sales_anchor as materialized (
  select max(left(record.payload->>'order_date', 10)::date) as anchor_date
  from public.external_records record
  where record.company_id = p_company_id
    and record.record_type = 'sales_order'
    and record.payload->>'order_date' ~ '^\d{4}-\d{2}-\d{2}'
    and exists (select 1 from authorized)
),
inventory as materialized (
  select
    record.payload->>'sku' as sku,
    max(record.payload->>'product_name') as product_name,
    sum(case when jsonb_typeof(record.payload->'on_hand') = 'number'
      then (record.payload->>'on_hand')::numeric else 0 end) as on_hand,
    sum(case when jsonb_typeof(record.payload->'allocated') = 'number'
      then (record.payload->>'allocated')::numeric else 0 end) as allocated,
    sum(case when jsonb_typeof(record.payload->'available') = 'number'
      then (record.payload->>'available')::numeric else 0 end) as available,
    sum(case when jsonb_typeof(record.payload->'backorder') = 'number'
      then (record.payload->>'backorder')::numeric else 0 end) as backorder,
    sum(case when jsonb_typeof(record.payload->'reorder_level') = 'number'
      then (record.payload->>'reorder_level')::numeric else 0 end) as reorder_level,
    sum(case when jsonb_typeof(record.payload->'reorder_amount') = 'number'
      then (record.payload->>'reorder_amount')::numeric else 0 end) as reorder_amount,
    max(record.pulled_at) as pulled_at
  from public.external_records record
  where record.company_id = p_company_id
    and record.record_type = 'inventory_position'
    and coalesce(record.payload->>'sku', '') <> ''
    and exists (select 1 from authorized)
  group by record.payload->>'sku'
),
candidate_inventory as materialized (
  select inventory.*
  from inventory
  where inventory.available <= inventory.reorder_level
     or inventory.backorder > 0
     or inventory.reorder_amount > 0
),
sales_30 as materialized (
  select
    line->>'sku' as sku,
    sum(case when jsonb_typeof(line->'quantity') = 'number'
      then (line->>'quantity')::numeric else 0 end) as units
  from public.external_records record
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(record.payload->'lines') = 'array'
      then record.payload->'lines' else '[]'::jsonb end
  ) line
  join candidate_inventory candidate on candidate.sku = line->>'sku'
  cross join sales_anchor anchor
  where record.company_id = p_company_id
    and record.record_type = 'sales_order'
    and coalesce(record.payload->>'fulfillment_status', '') <> 'canceled'
    and record.payload->>'order_date' ~ '^\d{4}-\d{2}-\d{2}'
    and left(record.payload->>'order_date', 10)::date >= anchor.anchor_date - 30
    and coalesce(line->>'sku', '') <> ''
    and exists (select 1 from authorized)
  group by line->>'sku'
),
open_purchase_orders as materialized (
  select
    line->>'sku' as sku,
    sum(case when jsonb_typeof(line->'quantity') = 'number'
      then (line->>'quantity')::numeric else 0 end) as open_units,
    count(distinct record.id)::integer as open_order_count
  from public.external_records record
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(record.payload->'lines') = 'array'
      then record.payload->'lines' else '[]'::jsonb end
  ) line
  join candidate_inventory candidate on candidate.sku = line->>'sku'
  where record.company_id = p_company_id
    and record.record_type = 'purchase_order'
    and record.payload->>'fulfillment_status' = 'pending'
    and coalesce(line->>'sku', '') <> ''
    and exists (select 1 from authorized)
  group by line->>'sku'
),
candidate_ranked as materialized (
  select
    candidate.sku,
    candidate.product_name,
    candidate.on_hand,
    candidate.allocated,
    candidate.available,
    candidate.backorder,
    candidate.reorder_level,
    candidate.reorder_amount,
    candidate.pulled_at as inventory_pulled_at,
    greatest(coalesce(sales.units, 0), 0) as recent_sales_units,
    coalesce(purchase_orders.open_units, 0) as open_po_units,
    coalesce(purchase_orders.open_order_count, 0) as open_po_count,
    greatest(
      greatest(
        candidate.reorder_amount,
        candidate.reorder_level - candidate.available,
        candidate.backorder,
        0
      ) - coalesce(purchase_orders.open_units, 0),
      0
    ) as recommended_quantity
  from candidate_inventory candidate
  left join sales_30 sales on sales.sku = candidate.sku
  left join open_purchase_orders purchase_orders
    on purchase_orders.sku = candidate.sku
),
candidate_limited as materialized (
  select ranked.*
  from candidate_ranked ranked
  order by
    (ranked.inventory_pulled_at < now() - interval '72 hours'),
    ranked.backorder desc,
    ranked.recommended_quantity desc,
    ranked.recent_sales_units desc,
    ranked.sku
  limit (select candidate_limit from bounded)
),
vendor_ranked as materialized (
  select
    record.payload->>'sku' as sku,
    record.payload->>'vendor_name' as vendor_name,
    record.payload->>'vendor_sku' as vendor_sku,
    case when jsonb_typeof(record.payload->'vendor_cost') = 'number'
      then (record.payload->>'vendor_cost')::numeric else null end as vendor_cost,
    row_number() over (
      partition by record.payload->>'sku'
      order by
        (record.payload->>'vendor_name' is null),
        case when jsonb_typeof(record.payload->'vendor_cost') = 'number'
          then (record.payload->>'vendor_cost')::numeric else null end nulls last,
        record.updated_at desc
    ) as preference_rank
  from public.external_records record
  join candidate_limited candidate on candidate.sku = record.payload->>'sku'
  where record.company_id = p_company_id
    and record.record_type = 'product_vendor'
    and coalesce(record.payload->>'sku', '') <> ''
    and exists (select 1 from authorized)
),
curated_vendor as materialized (
  select distinct on (record.payload->>'sku')
    record.payload->>'sku' as sku,
    record.payload->>'vendor' as vendor_name,
    record.payload->>'vendor_sku' as vendor_sku,
    case when jsonb_typeof(record.payload->'confidence') = 'number'
      then (record.payload->>'confidence')::numeric else null end as confidence,
    case when jsonb_typeof(record.payload->'confirmed') = 'boolean'
      then (record.payload->>'confirmed')::boolean else false end as confirmed
  from public.external_records record
  join candidate_limited candidate on candidate.sku = record.payload->>'sku'
  where record.company_id = p_company_id
    and record.record_type = 'sku_vendor_map'
    and coalesce(record.payload->>'sku', '') <> ''
    and exists (select 1 from authorized)
  order by
    record.payload->>'sku',
    case when jsonb_typeof(record.payload->'confirmed') = 'boolean'
      then (record.payload->>'confirmed')::boolean else false end desc,
    case when jsonb_typeof(record.payload->'confidence') = 'number'
      then (record.payload->>'confidence')::numeric else 0 end desc,
    record.updated_at desc
),
trello_cards as materialized (
  select
    record.payload->>'sku' as sku,
    count(*) filter (where case
      when jsonb_typeof(record.payload->'closed') = 'boolean'
        then (record.payload->>'closed')::boolean = false
      else true
    end)::integer as open_card_count,
    max(record.payload->>'list_name') filter (where case
      when jsonb_typeof(record.payload->'closed') = 'boolean'
        then (record.payload->>'closed')::boolean = false
      else true
    end) as current_list
  from public.external_records record
  join candidate_limited candidate on candidate.sku = record.payload->>'sku'
  where record.company_id = p_company_id
    and record.record_type = 'board_card'
    and coalesce(record.payload->>'sku', '') <> ''
    and exists (select 1 from authorized)
  group by record.payload->>'sku'
),
candidate_enriched as (
  select
    candidate.*,
    coalesce(curated.vendor_name, vendor.vendor_name) as vendor_name,
    coalesce(curated.vendor_sku, vendor.vendor_sku) as vendor_sku,
    vendor.vendor_cost,
    curated.confidence as vendor_confidence,
    coalesce(curated.confirmed, false) as vendor_confirmed,
    coalesce(trello.open_card_count, 0) as trello_open_card_count,
    trello.current_list as trello_list,
    case
      when candidate.inventory_pulled_at < now() - interval '72 hours' then 'blocked'
      when coalesce(curated.vendor_name, vendor.vendor_name) is null then 'blocked'
      when candidate.recommended_quantity <= 0 then 'no_action'
      else 'ready_for_review'
    end as recommendation_status
  from candidate_limited candidate
  left join vendor_ranked vendor
    on vendor.sku = candidate.sku and vendor.preference_rank = 1
  left join curated_vendor curated on curated.sku = candidate.sku
  left join trello_cards trello on trello.sku = candidate.sku
)
select jsonb_build_object(
  'schemaVersion', 1,
  'mode', 'sandbox',
  'ephemeral', true,
  'companyId', p_company_id,
  'createdAt', now(),
  'dataAnchorAt', (select anchor_date from sales_anchor),
  'recordCount', coalesce((select sum(record_count)::integer from catalog_stats), 0),
  'candidateCount', (select count(*)::integer from candidate_inventory),
  'sources', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', source.id,
      'key', source.source_key,
      'kind', source.kind,
      'name', source.name,
      'syncStatus', source.sync_status,
      'lastSyncedAt', source.last_synced_at,
      'recordCount', source.record_count,
      'freshestRecordAt', source.freshest_record_at,
      'stale', coalesce(
        coalesce(source.freshest_record_at, source.last_synced_at) < now() - interval '72 hours',
        true
      )
    ) order by source.name)
    from source_stats source
  ), '[]'::jsonb),
  'candidates', coalesce((
    select jsonb_agg(jsonb_build_object(
      'sku', candidate.sku,
      'productName', candidate.product_name,
      'inventory', jsonb_build_object(
        'onHand', candidate.on_hand,
        'allocated', candidate.allocated,
        'available', candidate.available,
        'backorder', candidate.backorder,
        'reorderLevel', candidate.reorder_level,
        'reorderAmount', candidate.reorder_amount,
        'pulledAt', candidate.inventory_pulled_at
      ),
      'recentSalesUnits', candidate.recent_sales_units,
      'openPurchaseOrders', jsonb_build_object(
        'count', candidate.open_po_count,
        'units', candidate.open_po_units
      ),
      'vendor', case when candidate.vendor_name is null then null else jsonb_build_object(
        'name', candidate.vendor_name,
        'vendorSku', candidate.vendor_sku,
        'unitCost', candidate.vendor_cost,
        'mappingConfidence', candidate.vendor_confidence,
        'mappingConfirmed', candidate.vendor_confirmed
      ) end,
      'trello', jsonb_build_object(
        'openCardCount', candidate.trello_open_card_count,
        'currentList', candidate.trello_list
      ),
      'recommendation', jsonb_build_object(
        'status', candidate.recommendation_status,
        'quantity', candidate.recommended_quantity,
        'reasons', jsonb_build_array(
          format('Available inventory is %s against a reorder level of %s.', candidate.available, candidate.reorder_level),
          format('Recent 30-day sales are %s units.', candidate.recent_sales_units),
          format('Pending purchase orders cover %s units.', candidate.open_po_units)
        ),
        'warnings', to_jsonb(array_remove(array[
          case when candidate.inventory_pulled_at < now() - interval '72 hours'
            then 'Inventory data is older than 72 hours.' end,
          case when candidate.vendor_name is null
            then 'No vendor mapping is available.' end,
          case when candidate.open_po_units > 0
            then 'An existing pending purchase order may already cover part of the need.' end
        ]::text[], null))
      ),
      'sources', to_jsonb(array_remove(array[
        'inventory_position',
        case when candidate.recent_sales_units > 0 then 'sales_order' end,
        case when candidate.open_po_count > 0 then 'purchase_order' end,
        case when candidate.vendor_name is not null
          and candidate.vendor_confidence is not null then 'sku_vendor_map'
          when candidate.vendor_name is not null then 'product_vendor' end,
        case when candidate.trello_open_card_count > 0 then 'board_card' end
      ]::text[], null))
    ) order by
      (candidate.inventory_pulled_at < now() - interval '72 hours'),
      candidate.backorder desc,
      candidate.recommended_quantity desc,
      candidate.recent_sales_units desc,
      candidate.sku)
    from candidate_enriched candidate
  ), '[]'::jsonb)
);
$$;

revoke all on function sandbox_private.build_workspace_snapshot_v1(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function sandbox_private.build_workspace_snapshot_v1(uuid, integer)
  to authenticated, service_role;

comment on function sandbox_private.build_workspace_snapshot_v1(uuid, integer) is
  'Builds a bounded read-only Sandbox projection by ranking candidates before enriching the selected rows.';

-- The private lifecycle functions historically used SQLSTATE 40001 for an
-- ordinary optimistic-version conflict. PostgREST clients treat 40001 as a
-- transient serialization failure and retry the same stale version. Translate
-- only this named application conflict at the public boundary so callers get
-- one stable response; preserve genuine serialization failures unchanged.
create or replace function public.transition_agent_lifecycle_v1(
  p_company_id uuid,
  p_workflow_id uuid,
  p_transition text,
  p_expected_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return workflow_private.transition_agent_lifecycle(
    p_company_id,
    p_workflow_id,
    p_transition,
    p_expected_version,
    p_reason
  );
exception
  when serialization_failure then
    if sqlerrm = 'stale_agent_state' then
      raise exception 'stale_agent_state' using errcode = 'P0001';
    end if;
    raise;
end;
$$;

create or replace function public.record_agent_test_evaluation_v1(
  p_company_id uuid,
  p_workflow_id uuid,
  p_expected_version bigint,
  p_sample_run_id uuid,
  p_sample_item_id uuid,
  p_client_issues jsonb default '[]'::jsonb,
  p_evaluator_version text default '1.0.0',
  p_reason text default 'Sandbox readiness evaluated.'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return workflow_private.record_agent_test_evaluation_payload(
    p_company_id,
    p_workflow_id,
    p_expected_version,
    p_sample_run_id,
    p_sample_item_id,
    p_client_issues,
    p_evaluator_version,
    p_reason
  );
exception
  when serialization_failure then
    if sqlerrm = 'stale_agent_state' then
      raise exception 'stale_agent_state' using errcode = 'P0001';
    end if;
    raise;
end;
$$;

create or replace function public.rollback_agent_workflow(
  p_company_id uuid,
  p_workflow_id uuid,
  p_binding_snapshot_id uuid,
  p_expected_current_workflow_id uuid,
  p_expected_state_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return workflow_private.rollback_agent_workflow_runtime_bridge(
    p_company_id,
    p_workflow_id,
    p_binding_snapshot_id,
    p_expected_current_workflow_id,
    p_expected_state_version,
    p_reason
  );
exception
  when serialization_failure then
    if sqlerrm = 'stale_agent_state' then
      raise exception 'stale_agent_state' using errcode = 'P0001';
    end if;
    raise;
end;
$$;

revoke all on function public.transition_agent_lifecycle_v1(uuid, uuid, text, bigint, text)
  from public, anon;
grant execute on function public.transition_agent_lifecycle_v1(uuid, uuid, text, bigint, text)
  to authenticated;
revoke all on function public.record_agent_test_evaluation_v1(uuid, uuid, bigint, uuid, uuid, jsonb, text, text)
  from public, anon;
grant execute on function public.record_agent_test_evaluation_v1(uuid, uuid, bigint, uuid, uuid, jsonb, text, text)
  to authenticated;
revoke all on function public.rollback_agent_workflow(uuid, uuid, uuid, uuid, bigint, text)
  from public, anon;
grant execute on function public.rollback_agent_workflow(uuid, uuid, uuid, uuid, bigint, text)
  to authenticated;

notify pgrst, 'reload schema';
