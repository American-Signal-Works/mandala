import type {
  ConnectorAdapter,
  ConnectorCursor,
  ConnectorPullInput,
  ConnectorPullResult,
  ConnectorRecord,
} from "./types"

// ShipHero GraphQL adapter. Pulls vendors first so product/vendor records keep
// complete names even when a vendor has no recently changed purchase order,
// followed by purchase orders, inventory, and recent sales orders.
//
// ShipHero rate limits on a credit/complexity budget, so every page request
// is followed by a fixed pause and page sizes stay small — same settings the
// proven standalone pull scripts converged on.

const SHIPHERO_API = "https://public-api.shiphero.com/graphql"
const SHIPHERO_REFRESH_API = "https://public-api.shiphero.com/auth/refresh"
const PAGE_PAUSE_MS = 1500
const VENDOR_PAGE = 50
const INVENTORY_PAGE = 50
const PO_PAGE = 25
const SALES_PAGE = 20
// Overlap update windows so provider writes that land on a timestamp boundary
// are re-read. The first sales import only needs the recent demand horizon.
const UPDATE_OVERLAP_DAYS = 2
const INITIAL_SALES_LOOKBACK_DAYS = 45
const REQUEST_TIMEOUT_MS = 6_000
const MAX_NETWORK_ATTEMPTS = 2
// ShipHero's credit bucket refills over tens of seconds, so a throttled
// request must actually wait for the refill instead of retrying a second
// later. ShipHero states the wait in its error ("Try again in N seconds");
// honor it when present, bounded so the worker stays inside its slot. The
// budget is shared across the whole executor lifetime (= one worker slot).
const MAX_THROTTLE_ATTEMPTS = 4
const THROTTLE_WAIT_BUDGET_MS = 35_000
const MIN_THROTTLE_WAIT_MS = 2_000
const MAX_THROTTLE_WAIT_MS = 30_000
const FALLBACK_THROTTLE_WAITS_MS = [5_000, 10_000, 20_000]

const VENDORS_QUERY = `
  query Vendors($first: Int!, $after: String) {
    vendors {
      request_id
      complexity
      data(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { id name } }
      }
    }
  }
`

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
  query PurchaseOrders($first: Int!, $after: String, $updatedFrom: DateTime, $fulfillmentStatus: String) {
    purchase_orders(updated_from: $updatedFrom, fulfillment_status: $fulfillmentStatus) {
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
            line_items(first: 100) {
              pageInfo { hasNextPage }
              edges { node { sku quantity price product_name } }
            }
          }
        }
      }
    }
  }
`

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String, $updatedFrom: ISODateTime, $orderDateFrom: ISODateTime) {
    orders(updated_from: $updatedFrom, order_date_from: $orderDateFrom) {
      request_id
      complexity
      data(first: $first, after: $after, sort: "-order_date") {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            order_number
            order_date
            updated_at
            fulfillment_status
            total_price
            line_items(first: 100) {
              pageInfo { hasNextPage }
              edges { node { sku quantity price product_name } }
            }
          }
        }
      }
    }
  }
`

type GraphqlExecutor = (
  query: string,
  variables: Record<string, unknown>
) => Promise<unknown>

type ShipheroCursor = ConnectorCursor & {
  phase: "vendors" | "purchase_orders" | "inventory" | "sales_orders"
  after: string | null
  vendorNames: Record<string, string>
  cycleStartedAt: string
  poUpdatedFrom: string | null
  poInitialStatus: "pending" | null
  salesUpdatedFrom: string | null
  salesOrderDateFrom: string | null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type ShipheroCredentials = {
  accessToken?: string
  refreshToken?: string
}

export function createShipheroGraphqlExecutor(
  credentials: string | ShipheroCredentials
): GraphqlExecutor {
  let accessToken =
    typeof credentials === "string" ? credentials : credentials.accessToken
  const refreshToken =
    typeof credentials === "string" ? undefined : credentials.refreshToken

  async function refreshAccessToken() {
    if (!refreshToken) throw new Error("shiphero_access_token_missing")
    let response: Response
    try {
      response = await fetch(SHIPHERO_REFRESH_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new Error("shiphero_token_refresh_failed")
    }
    if (!response.ok) throw new Error("shiphero_token_refresh_failed")
    const body = (await response.json()) as { access_token?: unknown }
    if (typeof body.access_token !== "string" || !body.access_token.trim()) {
      throw new Error("shiphero_token_refresh_failed")
    }
    accessToken = body.access_token.trim()
    return accessToken
  }

  // Shared across every request this executor makes (one executor lives for
  // one worker slot), so stacked throttle waits cannot blow the slot budget.
  let throttleWaitBudgetMs = THROTTLE_WAIT_BUDGET_MS

  async function waitForCreditRefill(
    throttleAttempt: number,
    suggestedWaitMs: number | null
  ): Promise<boolean> {
    const fallback =
      FALLBACK_THROTTLE_WAITS_MS[
        Math.min(throttleAttempt, FALLBACK_THROTTLE_WAITS_MS.length - 1)
      ]!
    const wait = Math.min(
      Math.max(suggestedWaitMs ?? fallback, MIN_THROTTLE_WAIT_MS),
      MAX_THROTTLE_WAIT_MS
    )
    if (wait > throttleWaitBudgetMs) return false
    throttleWaitBudgetMs -= wait
    await sleep(wait)
    return true
  }

  return async (query, variables) => {
    if (!accessToken) await refreshAccessToken()
    let refreshedAfterUnauthorized = false
    let networkFailures = 0
    let throttleAttempts = 0
    while (true) {
      let response: Response
      try {
        response = await fetch(SHIPHERO_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch {
        networkFailures += 1
        if (networkFailures < MAX_NETWORK_ATTEMPTS) {
          await sleep(1000 * networkFailures)
          continue
        }
        throw new Error("shiphero_request_failed")
      }
      if (
        response.status === 401 &&
        refreshToken &&
        !refreshedAfterUnauthorized
      ) {
        await refreshAccessToken()
        refreshedAfterUnauthorized = true
        continue
      }
      if (response.status === 429) {
        throttleAttempts += 1
        if (
          throttleAttempts >= MAX_THROTTLE_ATTEMPTS ||
          !(await waitForCreditRefill(throttleAttempts - 1, null))
        ) {
          throw new Error("shiphero_rate_limited")
        }
        continue
      }
      if (!response.ok) {
        throw new Error(`shiphero_http_${response.status}`)
      }
      const body = (await response.json()) as {
        data?: unknown
        errors?: Array<{ message?: string; time_remaining?: string }>
      }
      const throttledError = body.errors?.find((error) =>
        /throttl|credit|rate/i.test(error.message ?? "")
      )
      if (throttledError) {
        throttleAttempts += 1
        if (
          throttleAttempts >= MAX_THROTTLE_ATTEMPTS ||
          !(await waitForCreditRefill(
            throttleAttempts - 1,
            suggestedThrottleWaitMs(throttledError)
          ))
        ) {
          throw new Error("shiphero_rate_limited")
        }
        continue
      }
      if (body.errors?.length) {
        // Provider messages can contain account-specific data; keep the
        // persisted/returned worker error deliberately opaque.
        throw new Error("shiphero_graphql_error")
      }
      return body.data
    }
  }
}

// ShipHero throttle errors state their own refill wait, either as a
// `time_remaining` field ("44 seconds") or inline in the message ("Try
// again in 4 seconds"). Returns milliseconds, or null when unstated.
function suggestedThrottleWaitMs(error: {
  message?: string
  time_remaining?: string
}): number | null {
  const source = `${error.time_remaining ?? ""} ${error.message ?? ""}`
  const match = source.match(/(\d+(?:\.\d+)?)\s*sec/i)
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null
}

function overlapStart(value: string, days: number): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  parsed.setUTCDate(parsed.getUTCDate() - days)
  return parsed.toISOString()
}

function initialCursor(
  watermarks: Record<string, string>,
  now: Date
): ShipheroCursor {
  const cycleStartedAt = now.toISOString()
  return {
    phase: "vendors",
    after: null,
    vendorNames: {},
    cycleStartedAt,
    poUpdatedFrom: watermarks.poSince
      ? overlapStart(watermarks.poSince, UPDATE_OVERLAP_DAYS)
      : null,
    poInitialStatus: watermarks.poSince ? null : "pending",
    salesUpdatedFrom: watermarks.salesSince
      ? overlapStart(watermarks.salesSince, UPDATE_OVERLAP_DAYS)
      : null,
    salesOrderDateFrom: watermarks.salesSince
      ? null
      : overlapStart(cycleStartedAt, INITIAL_SALES_LOOKBACK_DAYS),
  }
}

export function createShipheroAdapter(options: {
  execute: GraphqlExecutor
}): ConnectorAdapter {
  const { execute } = options

  async function pullVendors(cursor: ShipheroCursor, budget: number) {
    const records: ConnectorRecord[] = []
    let after = cursor.after
    let apiCalls = 0
    const vendorNames = { ...cursor.vendorNames }
    while (apiCalls < budget) {
      const data = (await execute(VENDORS_QUERY, {
        first: VENDOR_PAGE,
        after,
      })) as {
        vendors: {
          data: {
            pageInfo: { hasNextPage: boolean; endCursor: string }
            edges: Array<{ node: VendorNode }>
          }
        }
      }
      apiCalls += 1
      const page = data.vendors.data
      for (const { node } of page.edges) {
        if (node.name) vendorNames[node.id] = node.name
        records.push({
          recordType: "vendor",
          externalId: node.id,
          payload: { name: node.name ?? null },
        })
      }
      if (!page.pageInfo.hasNextPage) {
        return {
          records,
          apiCalls,
          nextCursor: {
            ...cursor,
            phase: "purchase_orders" as const,
            after: null,
            vendorNames,
          },
        }
      }
      after = page.pageInfo.endCursor
      await sleep(PAGE_PAUSE_MS)
    }
    return { records, apiCalls, nextCursor: { ...cursor, after, vendorNames } }
  }

  async function pullPurchaseOrders(cursor: ShipheroCursor, budget: number) {
    const records: ConnectorRecord[] = []
    let after = cursor.after
    let apiCalls = 0
    const vendorNames = { ...cursor.vendorNames }
    while (apiCalls < budget) {
      const data = (await execute(PURCHASE_ORDERS_QUERY, {
        first: PO_PAGE,
        after,
        updatedFrom: cursor.poUpdatedFrom,
        fulfillmentStatus: cursor.poInitialStatus,
      })) as {
        purchase_orders: {
          data: {
            pageInfo: { hasNextPage: boolean; endCursor: string }
            edges: Array<{ node: PurchaseOrderNode }>
          }
        }
      }
      apiCalls += 1
      const page = data.purchase_orders.data
      for (const { node } of page.edges) {
        if (node.vendor_id && node.vendor?.name)
          vendorNames[node.vendor_id] = node.vendor.name
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
        return {
          records,
          apiCalls,
          nextCursor: {
            ...cursor,
            phase: "inventory" as const,
            after: null,
            vendorNames,
          },
        }
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
      const data = (await execute(PRODUCTS_QUERY, {
        first: INVENTORY_PAGE,
        after,
      })) as {
        products: {
          data: {
            pageInfo: { hasNextPage: boolean; endCursor: string }
            edges: Array<{ node: ProductNode }>
          }
        }
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
        return {
          records,
          apiCalls,
          nextCursor: {
            ...cursor,
            phase: "sales_orders" as const,
            after: null,
          },
        }
      }
      after = page.pageInfo.endCursor
      await sleep(PAGE_PAUSE_MS)
    }
    return { records, apiCalls, nextCursor: { ...cursor, after } }
  }

  async function pullSalesOrders(cursor: ShipheroCursor, budget: number) {
    const records: ConnectorRecord[] = []
    let after = cursor.after
    let apiCalls = 0
    while (apiCalls < budget) {
      const data = (await execute(ORDERS_QUERY, {
        first: SALES_PAGE,
        after,
        updatedFrom: cursor.salesUpdatedFrom,
        orderDateFrom: cursor.salesOrderDateFrom,
      })) as {
        orders: {
          data: {
            pageInfo: { hasNextPage: boolean; endCursor: string }
            edges: Array<{ node: SalesOrderNode }>
          }
        }
      }
      apiCalls += 1
      const page = data.orders.data
      for (const { node } of page.edges) {
        records.push(salesOrderRecord(node))
      }
      if (!page.pageInfo.hasNextPage) {
        return { records, apiCalls, nextCursor: null }
      }
      after = page.pageInfo.endCursor
      await sleep(PAGE_PAUSE_MS)
    }
    return { records, apiCalls, nextCursor: { ...cursor, after } }
  }

  return {
    sourceKey: "shiphero",
    async pull(input: ConnectorPullInput): Promise<ConnectorPullResult> {
      const cursor =
        (input.cursor as ShipheroCursor | null) ??
        initialCursor(input.watermarks, input.now)
      const budget = input.budget.maxApiCalls

      if (cursor.phase === "vendors") {
        const result = await pullVendors(cursor, budget)
        return {
          records: result.records,
          nextCursor: result.nextCursor,
          apiCalls: result.apiCalls,
        }
      }
      if (cursor.phase === "purchase_orders") {
        const result = await pullPurchaseOrders(cursor, budget)
        return {
          records: result.records,
          nextCursor: result.nextCursor,
          apiCalls: result.apiCalls,
        }
      }
      if (cursor.phase === "inventory") {
        const result = await pullInventory(cursor, budget)
        return {
          records: result.records,
          nextCursor: result.nextCursor,
          apiCalls: result.apiCalls,
        }
      }
      const result = await pullSalesOrders(cursor, budget)
      return {
        records: result.records,
        nextCursor: result.nextCursor,
        apiCalls: result.apiCalls,
        watermarks:
          result.nextCursor === null
            ? {
                poSince: cursor.cycleStartedAt,
                salesSince: cursor.cycleStartedAt,
              }
            : undefined,
      }
    },
  }
}

type LineItems = {
  pageInfo?: { hasNextPage?: boolean }
  edges?: Array<{
    node: {
      sku?: string
      quantity?: number
      price?: string | number
      product_name?: string
    }
  }>
}
type VendorNode = {
  id: string
  name?: string
}
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
  vendors?: Array<{
    vendor_id: string
    vendor_sku?: string
    price?: string | number
  }>
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
  updated_at?: string
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
  if (node.line_items?.pageInfo?.hasNextPage) {
    throw new Error(`shiphero_purchase_order_lines_truncated:${node.id}`)
  }
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
  if (node.line_items?.pageInfo?.hasNextPage) {
    throw new Error(`shiphero_sales_order_lines_truncated:${node.id}`)
  }
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
  const accessToken =
    process.env.SHIPHERO_ACCESS_TOKEN?.trim() ||
    // Compatibility for environments configured from the original PR draft.
    process.env.SHIPHERO_API_KEY?.trim()
  const refreshToken = process.env.SHIPHERO_REFRESH_TOKEN?.trim()
  if (!accessToken && !refreshToken) {
    throw new Error("shiphero_credentials_missing")
  }
  return createShipheroAdapter({
    execute: createShipheroGraphqlExecutor({ accessToken, refreshToken }),
  })
}
