import type {
  ConnectorAdapter,
  ConnectorCursor,
  ConnectorPullInput,
  ConnectorPullResult,
  ConnectorRecord,
} from "./types"

// ShipHero GraphQL adapter. Pulls in three phases per sync cycle —
// purchase orders first (that pass also builds the vendor_id -> name map the
// inventory phase needs for product_vendor rows), then inventory, then sales
// orders (incremental against the salesSince watermark).
//
// ShipHero rate limits on a credit/complexity budget, so every page request
// is followed by a fixed pause and page sizes stay small — same settings the
// proven standalone pull scripts converged on.

const SHIPHERO_API = "https://public-api.shiphero.com/graphql"
const PAGE_PAUSE_MS = 1500
const INVENTORY_PAGE = 50
const PO_PAGE = 25
const SALES_PAGE = 20
// Overlap window re-pulled on every incremental sales sync so late edits to
// recent orders (cancellations, address holds) are still picked up.
const SALES_OVERLAP_DAYS = 7

const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String) {
    products {
      request_id
      complexity
      data(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            sku
            name
            vendors { vendor_id vendor_sku price }
            warehouse_products {
              warehouse_id
              on_hand
              allocated
              available
              backorder
              reorder_level
              reorder_amount
            }
          }
        }
      }
    }
  }
`

const PURCHASE_ORDERS_QUERY = `
  query PurchaseOrders($first: Int!, $after: String) {
    purchase_orders {
      request_id
      complexity
      data(first: $first, after: $after, sort: "-po_date") {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            po_number
            vendor_id
            vendor { name }
            po_date
            fulfillment_status
            subtotal
            total_price
            line_items(first: 25) {
              edges { node { sku quantity price product_name } }
            }
          }
        }
      }
    }
  }
`

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String) {
    orders {
      request_id
      complexity
      data(first: $first, after: $after, sort: "-order_date") {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            order_number
            order_date
            fulfillment_status
            total_price
            line_items(first: 20) {
              edges { node { sku quantity price product_name } }
            }
          }
        }
      }
    }
  }
`

type GraphqlExecutor = (query: string, variables: Record<string, unknown>) => Promise<unknown>

type ShipheroCursor = ConnectorCursor & {
  phase: "purchase_orders" | "inventory" | "sales_orders"
  after: string | null
  vendorNames: Record<string, string>
  maxSalesOrderDate: string | null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createShipheroGraphqlExecutor(apiKey: string): GraphqlExecutor {
  return async (query, variables) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(SHIPHERO_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, variables }),
      })
      if (response.status === 429) {
        await sleep(5000 * (attempt + 1))
        continue
      }
      if (!response.ok) {
        throw new Error(`shiphero_http_${response.status}`)
      }
      const body = (await response.json()) as { data?: unknown; errors?: Array<{ message?: string }> }
      const throttled = body.errors?.some((error) =>
        /throttl|credit|rate/i.test(error.message ?? "")
      )
      if (throttled) {
        await sleep(5000 * (attempt + 1))
        continue
      }
      if (body.errors?.length) {
        throw new Error(`shiphero_graphql: ${body.errors[0]?.message ?? "unknown"}`)
      }
      return body.data
    }
    throw new Error("shiphero_rate_limited")
  }
}

function initialCursor(watermarks: Record<string, string>): ShipheroCursor {
  return {
    phase: "purchase_orders",
    after: null,
    vendorNames: {},
    maxSalesOrderDate: watermarks.salesSince ?? null,
  }
}

export function createShipheroAdapter(options: { execute: GraphqlExecutor }): ConnectorAdapter {
  const { execute } = options

  async function pullPurchaseOrders(cursor: ShipheroCursor, budget: number) {
    const records: ConnectorRecord[] = []
    let after = cursor.after
    let apiCalls = 0
    const vendorNames = { ...cursor.vendorNames }
    while (apiCalls < budget) {
      const data = (await execute(PURCHASE_ORDERS_QUERY, { first: PO_PAGE, after })) as {
        purchase_orders: { data: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: Array<{ node: PurchaseOrderNode }> } }
      }
      apiCalls += 1
      const page = data.purchase_orders.data
      for (const { node } of page.edges) {
        if (node.vendor_id && node.vendor?.name) vendorNames[node.vendor_id] = node.vendor.name
        records.push(purchaseOrderRecord(node))
        if (node.vendor_id) {
          records.push({
            recordType: "vendor",
            externalId: node.vendor_id,
            payload: { name: node.vendor?.name ?? null },
          })
        }
      }
      if (!page.pageInfo.hasNextPage) {
        return { records, apiCalls, nextCursor: { ...cursor, phase: "inventory" as const, after: null, vendorNames } }
      }
      after = page.pageInfo.endCursor
      await sleep(PAGE_PAUSE_MS)
    }
    return { records, apiCalls, nextCursor: { ...cursor, after, vendorNames } }
  }

  async function pullInventory(cursor: ShipheroCursor, budget: number) {
    const records: ConnectorRecord[] = []
    let after = cursor.after
    let apiCalls = 0
    while (apiCalls < budget) {
      const data = (await execute(PRODUCTS_QUERY, { first: INVENTORY_PAGE, after })) as {
        products: { data: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: Array<{ node: ProductNode }> } }
      }
      apiCalls += 1
      const page = data.products.data
      for (const { node } of page.edges) {
        for (const wp of node.warehouse_products ?? []) {
          records.push({
            recordType: "inventory_position",
            externalId: `${node.sku}@${wp.warehouse_id}`,
            payload: {
              sku: node.sku,
              on_hand: wp.on_hand ?? 0,
              allocated: wp.allocated ?? 0,
              available: wp.available ?? 0,
              backorder: wp.backorder ?? 0,
              product_name: node.name ?? null,
              warehouse_id: wp.warehouse_id,
              reorder_level: wp.reorder_level ?? 0,
              reorder_amount: wp.reorder_amount ?? 0,
            },
          })
        }
        for (const vendor of node.vendors ?? []) {
          records.push({
            recordType: "product_vendor",
            externalId: `${node.sku}@${vendor.vendor_id}`,
            payload: {
              sku: node.sku,
              vendor_sku: vendor.vendor_sku ?? "",
              vendor_cost: vendor.price != null ? Number(vendor.price) : 0,
              vendor_name: cursor.vendorNames[vendor.vendor_id] ?? null,
              vendor_external_id: vendor.vendor_id,
            },
          })
        }
      }
      if (!page.pageInfo.hasNextPage) {
        return { records, apiCalls, nextCursor: { ...cursor, phase: "sales_orders" as const, after: null } }
      }
      after = page.pageInfo.endCursor
      await sleep(PAGE_PAUSE_MS)
    }
    return { records, apiCalls, nextCursor: { ...cursor, after } }
  }

  async function pullSalesOrders(cursor: ShipheroCursor, budget: number, salesSince: string | null) {
    const records: ConnectorRecord[] = []
    let after = cursor.after
    let apiCalls = 0
    let maxSalesOrderDate = cursor.maxSalesOrderDate
    const cutoff = salesSince ? overlapCutoff(salesSince) : null
    while (apiCalls < budget) {
      const data = (await execute(ORDERS_QUERY, { first: SALES_PAGE, after })) as {
        orders: { data: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: Array<{ node: SalesOrderNode }> } }
      }
      apiCalls += 1
      const page = data.orders.data
      let reachedCutoff = false
      for (const { node } of page.edges) {
        if (node.order_date && (!maxSalesOrderDate || node.order_date > maxSalesOrderDate)) {
          maxSalesOrderDate = node.order_date
        }
        if (cutoff && node.order_date && node.order_date < cutoff) {
          reachedCutoff = true
          break
        }
        records.push(salesOrderRecord(node))
      }
      if (reachedCutoff || !page.pageInfo.hasNextPage) {
        return { records, apiCalls, nextCursor: null, maxSalesOrderDate }
      }
      after = page.pageInfo.endCursor
      await sleep(PAGE_PAUSE_MS)
    }
    return { records, apiCalls, nextCursor: { ...cursor, after, maxSalesOrderDate }, maxSalesOrderDate }
  }

  return {
    kind: "shiphero",
    async pull(input: ConnectorPullInput): Promise<ConnectorPullResult> {
      const cursor = (input.cursor as ShipheroCursor | null) ?? initialCursor(input.watermarks)
      const budget = input.budget.maxApiCalls

      if (cursor.phase === "purchase_orders") {
        const result = await pullPurchaseOrders(cursor, budget)
        return { records: result.records, nextCursor: result.nextCursor, apiCalls: result.apiCalls }
      }
      if (cursor.phase === "inventory") {
        const result = await pullInventory(cursor, budget)
        return { records: result.records, nextCursor: result.nextCursor, apiCalls: result.apiCalls }
      }
      const result = await pullSalesOrders(cursor, budget, input.watermarks.salesSince ?? null)
      return {
        records: result.records,
        nextCursor: result.nextCursor,
        apiCalls: result.apiCalls,
        watermarks: result.maxSalesOrderDate ? { salesSince: result.maxSalesOrderDate } : undefined,
      }
    },
  }
}

function overlapCutoff(salesSince: string): string {
  const parsed = new Date(salesSince)
  if (Number.isNaN(parsed.getTime())) return salesSince
  parsed.setUTCDate(parsed.getUTCDate() - SALES_OVERLAP_DAYS)
  return parsed.toISOString()
}

type LineItems = { edges?: Array<{ node: { sku?: string; quantity?: number; price?: string | number; product_name?: string } }> }
type PurchaseOrderNode = {
  id: string
  po_number?: string
  vendor_id?: string
  vendor?: { name?: string }
  po_date?: string
  fulfillment_status?: string
  subtotal?: string | number
  total_price?: string | number
  line_items?: LineItems
}
type ProductNode = {
  sku: string
  name?: string
  vendors?: Array<{ vendor_id: string; vendor_sku?: string; price?: string | number }>
  warehouse_products?: Array<{
    warehouse_id: string
    on_hand?: number
    allocated?: number
    available?: number
    backorder?: number
    reorder_level?: number
    reorder_amount?: number
  }>
}
type SalesOrderNode = {
  id: string
  order_number?: string
  order_date?: string
  fulfillment_status?: string
  total_price?: string | number
  line_items?: LineItems
}

function mapLines(lineItems?: LineItems) {
  return (lineItems?.edges ?? []).map(({ node }) => ({
    sku: node.sku,
    price: node.price != null ? Number(node.price) : 0,
    quantity: node.quantity ?? 0,
    product_name: node.product_name ?? null,
  }))
}

function purchaseOrderRecord(node: PurchaseOrderNode): ConnectorRecord {
  return {
    recordType: "purchase_order",
    externalId: node.id,
    payload: {
      lines: mapLines(node.line_items),
      po_date: node.po_date,
      subtotal: node.subtotal != null ? Number(node.subtotal) : 0,
      po_number: node.po_number,
      total_price: node.total_price != null ? Number(node.total_price) : 0,
      vendor_name: node.vendor?.name ?? "Unknown Vendor",
      source_row_id: node.id,
      fulfillment_status: node.fulfillment_status,
      vendor_external_id: node.vendor_id ?? null,
    },
  }
}

function salesOrderRecord(node: SalesOrderNode): ConnectorRecord {
  return {
    recordType: "sales_order",
    externalId: node.id,
    payload: {
      lines: mapLines(node.line_items),
      order_date: node.order_date,
      total_price: node.total_price != null ? Number(node.total_price) : 0,
      order_number: node.order_number,
      source_row_id: node.id,
      fulfillment_status: node.fulfillment_status,
    },
  }
}

export function createShipheroAdapterFromEnvironment(): ConnectorAdapter {
  const apiKey = process.env.SHIPHERO_API_KEY?.trim()
  if (!apiKey) throw new Error("shiphero_api_key_missing")
  return createShipheroAdapter({ execute: createShipheroGraphqlExecutor(apiKey) })
}
