-- Cycle 0.0.7: read-only real-data Sandbox projection.
--
-- Alba's connector foundation already stores imported provider records in
-- external_sources/external_records. This function consumes that contract
-- without copying payloads into workflow tables or creating Sandbox state.
-- It is SECURITY INVOKER so existing company RLS remains the data boundary.

CREATE FUNCTION public.get_sandbox_workspace_snapshot_v1(
  p_company_id UUID,
  p_candidate_limit INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH
authorized AS (
  SELECT 1
  WHERE public.has_company_role(p_company_id, 'viewer')
),
bounded AS (
  SELECT LEAST(GREATEST(COALESCE(p_candidate_limit, 25), 1), 100) AS candidate_limit
),
source_stats AS (
  SELECT
    source.id,
    source.source_key,
    source.kind,
    source.name,
    source.sync_status,
    source.last_synced_at,
    COUNT(record.id)::INTEGER AS record_count,
    MAX(record.pulled_at) AS freshest_record_at
  FROM public.external_sources source
  LEFT JOIN public.external_records record
    ON record.source_id = source.id
   AND record.company_id = source.company_id
  WHERE source.company_id = p_company_id
    AND EXISTS (SELECT 1 FROM authorized)
  GROUP BY source.id
),
sales_anchor AS (
  SELECT MAX((record.payload->>'order_date')::DATE) AS anchor_date
  FROM public.external_records record
  WHERE record.company_id = p_company_id
    AND record.record_type = 'sales_order'
    AND record.payload->>'order_date' ~ '^\d{4}-\d{2}-\d{2}$'
    AND EXISTS (SELECT 1 FROM authorized)
),
inventory AS (
  SELECT
    record.payload->>'sku' AS sku,
    MAX(record.payload->>'product_name') AS product_name,
    SUM(CASE WHEN jsonb_typeof(record.payload->'on_hand') = 'number'
      THEN (record.payload->>'on_hand')::NUMERIC ELSE 0 END) AS on_hand,
    SUM(CASE WHEN jsonb_typeof(record.payload->'allocated') = 'number'
      THEN (record.payload->>'allocated')::NUMERIC ELSE 0 END) AS allocated,
    SUM(CASE WHEN jsonb_typeof(record.payload->'available') = 'number'
      THEN (record.payload->>'available')::NUMERIC ELSE 0 END) AS available,
    SUM(CASE WHEN jsonb_typeof(record.payload->'backorder') = 'number'
      THEN (record.payload->>'backorder')::NUMERIC ELSE 0 END) AS backorder,
    SUM(CASE WHEN jsonb_typeof(record.payload->'reorder_level') = 'number'
      THEN (record.payload->>'reorder_level')::NUMERIC ELSE 0 END) AS reorder_level,
    SUM(CASE WHEN jsonb_typeof(record.payload->'reorder_amount') = 'number'
      THEN (record.payload->>'reorder_amount')::NUMERIC ELSE 0 END) AS reorder_amount,
    MAX(record.pulled_at) AS pulled_at
  FROM public.external_records record
  WHERE record.company_id = p_company_id
    AND record.record_type = 'inventory_position'
    AND COALESCE(record.payload->>'sku', '') <> ''
    AND EXISTS (SELECT 1 FROM authorized)
  GROUP BY record.payload->>'sku'
),
sales_30 AS (
  SELECT
    line->>'sku' AS sku,
    SUM(CASE WHEN jsonb_typeof(line->'quantity') = 'number'
      THEN (line->>'quantity')::NUMERIC ELSE 0 END) AS units
  FROM public.external_records record
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(record.payload->'lines') = 'array'
      THEN record.payload->'lines' ELSE '[]'::JSONB END
  ) line
  CROSS JOIN sales_anchor anchor
  WHERE record.company_id = p_company_id
    AND record.record_type = 'sales_order'
    AND COALESCE(record.payload->>'fulfillment_status', '') <> 'canceled'
    AND record.payload->>'order_date' ~ '^\d{4}-\d{2}-\d{2}$'
    AND (record.payload->>'order_date')::DATE >= anchor.anchor_date - 30
    AND COALESCE(line->>'sku', '') <> ''
    AND EXISTS (SELECT 1 FROM authorized)
  GROUP BY line->>'sku'
),
open_purchase_orders AS (
  SELECT
    line->>'sku' AS sku,
    SUM(CASE WHEN jsonb_typeof(line->'quantity') = 'number'
      THEN (line->>'quantity')::NUMERIC ELSE 0 END) AS open_units,
    COUNT(DISTINCT record.id)::INTEGER AS open_order_count
  FROM public.external_records record
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(record.payload->'lines') = 'array'
      THEN record.payload->'lines' ELSE '[]'::JSONB END
  ) line
  WHERE record.company_id = p_company_id
    AND record.record_type = 'purchase_order'
    AND record.payload->>'fulfillment_status' = 'pending'
    AND COALESCE(line->>'sku', '') <> ''
    AND EXISTS (SELECT 1 FROM authorized)
  GROUP BY line->>'sku'
),
vendor_ranked AS (
  SELECT
    record.payload->>'sku' AS sku,
    record.payload->>'vendor_name' AS vendor_name,
    record.payload->>'vendor_sku' AS vendor_sku,
    CASE WHEN jsonb_typeof(record.payload->'vendor_cost') = 'number'
      THEN (record.payload->>'vendor_cost')::NUMERIC ELSE NULL END AS vendor_cost,
    ROW_NUMBER() OVER (
      PARTITION BY record.payload->>'sku'
      ORDER BY
        (record.payload->>'vendor_name' IS NULL),
        CASE WHEN jsonb_typeof(record.payload->'vendor_cost') = 'number'
          THEN (record.payload->>'vendor_cost')::NUMERIC ELSE NULL END NULLS LAST,
        record.updated_at DESC
    ) AS preference_rank
  FROM public.external_records record
  WHERE record.company_id = p_company_id
    AND record.record_type = 'product_vendor'
    AND COALESCE(record.payload->>'sku', '') <> ''
    AND EXISTS (SELECT 1 FROM authorized)
),
curated_vendor AS (
  SELECT DISTINCT ON (record.payload->>'sku')
    record.payload->>'sku' AS sku,
    record.payload->>'vendor' AS vendor_name,
    record.payload->>'vendor_sku' AS vendor_sku,
    CASE WHEN jsonb_typeof(record.payload->'confidence') = 'number'
      THEN (record.payload->>'confidence')::NUMERIC ELSE NULL END AS confidence,
    CASE WHEN jsonb_typeof(record.payload->'confirmed') = 'boolean'
      THEN (record.payload->>'confirmed')::BOOLEAN ELSE false END AS confirmed
  FROM public.external_records record
  WHERE record.company_id = p_company_id
    AND record.record_type = 'sku_vendor_map'
    AND COALESCE(record.payload->>'sku', '') <> ''
    AND EXISTS (SELECT 1 FROM authorized)
  ORDER BY
    record.payload->>'sku',
    CASE WHEN jsonb_typeof(record.payload->'confirmed') = 'boolean'
      THEN (record.payload->>'confirmed')::BOOLEAN ELSE false END DESC,
    CASE WHEN jsonb_typeof(record.payload->'confidence') = 'number'
      THEN (record.payload->>'confidence')::NUMERIC ELSE 0 END DESC,
    record.updated_at DESC
),
trello_cards AS (
  SELECT
    record.payload->>'sku' AS sku,
    COUNT(*) FILTER (WHERE CASE
      WHEN jsonb_typeof(record.payload->'closed') = 'boolean'
        THEN (record.payload->>'closed')::BOOLEAN = false
      ELSE true
    END)::INTEGER AS open_card_count,
    MAX(record.payload->>'list_name') FILTER (
      WHERE CASE
        WHEN jsonb_typeof(record.payload->'closed') = 'boolean'
          THEN (record.payload->>'closed')::BOOLEAN = false
        ELSE true
      END
    ) AS current_list
  FROM public.external_records record
  WHERE record.company_id = p_company_id
    AND record.record_type = 'board_card'
    AND COALESCE(record.payload->>'sku', '') <> ''
    AND EXISTS (SELECT 1 FROM authorized)
  GROUP BY record.payload->>'sku'
),
candidate_base AS (
  SELECT
    inventory.sku,
    inventory.product_name,
    inventory.on_hand,
    inventory.allocated,
    inventory.available,
    inventory.backorder,
    inventory.reorder_level,
    inventory.reorder_amount,
    inventory.pulled_at AS inventory_pulled_at,
    GREATEST(COALESCE(sales_30.units, 0), 0) AS recent_sales_units,
    COALESCE(open_purchase_orders.open_units, 0) AS open_po_units,
    COALESCE(open_purchase_orders.open_order_count, 0) AS open_po_count,
    COALESCE(curated_vendor.vendor_name, vendor_ranked.vendor_name) AS vendor_name,
    COALESCE(curated_vendor.vendor_sku, vendor_ranked.vendor_sku) AS vendor_sku,
    vendor_ranked.vendor_cost,
    curated_vendor.confidence AS vendor_confidence,
    COALESCE(curated_vendor.confirmed, false) AS vendor_confirmed,
    COALESCE(trello_cards.open_card_count, 0) AS trello_open_card_count,
    trello_cards.current_list AS trello_list,
    GREATEST(
      GREATEST(
        inventory.reorder_amount,
        inventory.reorder_level - inventory.available,
        inventory.backorder,
        0
      ) - COALESCE(open_purchase_orders.open_units, 0),
      0
    ) AS recommended_quantity
  FROM inventory
  LEFT JOIN sales_30 ON sales_30.sku = inventory.sku
  LEFT JOIN open_purchase_orders ON open_purchase_orders.sku = inventory.sku
  LEFT JOIN vendor_ranked
    ON vendor_ranked.sku = inventory.sku
   AND vendor_ranked.preference_rank = 1
  LEFT JOIN curated_vendor ON curated_vendor.sku = inventory.sku
  LEFT JOIN trello_cards ON trello_cards.sku = inventory.sku
  WHERE inventory.available <= inventory.reorder_level
     OR inventory.backorder > 0
     OR inventory.reorder_amount > 0
),
candidate_ranked AS (
  SELECT
    candidate_base.*,
    CASE
      WHEN candidate_base.inventory_pulled_at < now() - INTERVAL '72 hours' THEN 'blocked'
      WHEN candidate_base.vendor_name IS NULL THEN 'blocked'
      WHEN candidate_base.recommended_quantity <= 0 THEN 'no_action'
      ELSE 'ready_for_review'
    END AS recommendation_status
  FROM candidate_base
),
candidate_limited AS (
  SELECT candidate_ranked.*
  FROM candidate_ranked
  ORDER BY
    (candidate_ranked.inventory_pulled_at < now() - INTERVAL '72 hours'),
    candidate_ranked.backorder DESC,
    candidate_ranked.recommended_quantity DESC,
    candidate_ranked.recent_sales_units DESC,
    candidate_ranked.sku
  LIMIT (SELECT candidate_limit FROM bounded)
)
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'mode', 'sandbox',
  'ephemeral', true,
  'companyId', p_company_id,
  'createdAt', now(),
  'dataAnchorAt', (SELECT anchor_date FROM sales_anchor),
  'recordCount', (
    SELECT COUNT(*)::INTEGER
    FROM public.external_records record
    WHERE record.company_id = p_company_id
      AND EXISTS (SELECT 1 FROM authorized)
  ),
  'candidateCount', (SELECT COUNT(*)::INTEGER FROM candidate_ranked),
  'sources', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', source_stats.id,
      'key', source_stats.source_key,
      'kind', source_stats.kind,
      'name', source_stats.name,
      'syncStatus', source_stats.sync_status,
      'lastSyncedAt', source_stats.last_synced_at,
      'recordCount', source_stats.record_count,
      'freshestRecordAt', source_stats.freshest_record_at,
      'stale', COALESCE(
        COALESCE(source_stats.freshest_record_at, source_stats.last_synced_at) < now() - INTERVAL '72 hours',
        true
      )
    ) ORDER BY source_stats.name)
    FROM source_stats
  ), '[]'::JSONB),
  'candidates', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sku', candidate_limited.sku,
      'productName', candidate_limited.product_name,
      'inventory', jsonb_build_object(
        'onHand', candidate_limited.on_hand,
        'allocated', candidate_limited.allocated,
        'available', candidate_limited.available,
        'backorder', candidate_limited.backorder,
        'reorderLevel', candidate_limited.reorder_level,
        'reorderAmount', candidate_limited.reorder_amount,
        'pulledAt', candidate_limited.inventory_pulled_at
      ),
      'recentSalesUnits', candidate_limited.recent_sales_units,
      'openPurchaseOrders', jsonb_build_object(
        'count', candidate_limited.open_po_count,
        'units', candidate_limited.open_po_units
      ),
      'vendor', CASE WHEN candidate_limited.vendor_name IS NULL THEN NULL ELSE jsonb_build_object(
        'name', candidate_limited.vendor_name,
        'vendorSku', candidate_limited.vendor_sku,
        'unitCost', candidate_limited.vendor_cost,
        'mappingConfidence', candidate_limited.vendor_confidence,
        'mappingConfirmed', candidate_limited.vendor_confirmed
      ) END,
      'trello', jsonb_build_object(
        'openCardCount', candidate_limited.trello_open_card_count,
        'currentList', candidate_limited.trello_list
      ),
      'recommendation', jsonb_build_object(
        'status', candidate_limited.recommendation_status,
        'quantity', candidate_limited.recommended_quantity,
        'reasons', jsonb_build_array(
          format('Available inventory is %s against a reorder level of %s.', candidate_limited.available, candidate_limited.reorder_level),
          format('Recent 30-day sales are %s units.', candidate_limited.recent_sales_units),
          format('Pending purchase orders cover %s units.', candidate_limited.open_po_units)
        ),
        'warnings', to_jsonb(array_remove(ARRAY[
          CASE WHEN candidate_limited.inventory_pulled_at < now() - INTERVAL '72 hours'
            THEN 'Inventory data is older than 72 hours.' END,
          CASE WHEN candidate_limited.vendor_name IS NULL
            THEN 'No vendor mapping is available.' END,
          CASE WHEN candidate_limited.open_po_units > 0
            THEN 'An existing pending purchase order may already cover part of the need.' END
        ]::TEXT[], NULL))
      ),
      'sources', to_jsonb(array_remove(ARRAY[
        'inventory_position',
        CASE WHEN candidate_limited.recent_sales_units > 0 THEN 'sales_order' END,
        CASE WHEN candidate_limited.open_po_count > 0 THEN 'purchase_order' END,
        CASE WHEN candidate_limited.vendor_name IS NOT NULL
          AND candidate_limited.vendor_confidence IS NOT NULL THEN 'sku_vendor_map'
          WHEN candidate_limited.vendor_name IS NOT NULL THEN 'product_vendor' END,
        CASE WHEN candidate_limited.trello_open_card_count > 0 THEN 'board_card' END
      ]::TEXT[], NULL))
    ) ORDER BY
      (candidate_limited.inventory_pulled_at < now() - INTERVAL '72 hours'),
      candidate_limited.backorder DESC,
      candidate_limited.recommended_quantity DESC,
      candidate_limited.recent_sales_units DESC,
      candidate_limited.sku)
    FROM candidate_limited
  ), '[]'::JSONB)
);
$$;

REVOKE ALL ON FUNCTION public.get_sandbox_workspace_snapshot_v1(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sandbox_workspace_snapshot_v1(UUID, INTEGER)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sandbox_workspace_snapshot_v1(UUID, INTEGER) IS
  'Returns a bounded, read-only, RLS-scoped projection of imported provider records for an ephemeral CLI Sandbox session.';
