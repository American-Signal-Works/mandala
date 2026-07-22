import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createShipheroAdapter,
  createShipheroGraphqlExecutor,
} from "./shiphero"

const pullInput = {
  cursor: null,
  config: {},
  watermarks: {},
  budget: { maxApiCalls: 1 },
  now: new Date("2026-07-17T00:00:00Z"),
}

const purchaseOrderInput = {
  ...pullInput,
  cursor: {
    phase: "purchase_orders",
    after: null,
    vendorNames: {},
    cycleStartedAt: "2026-07-17T00:00:00.000Z",
    poUpdatedFrom: null,
    poInitialStatus: "pending",
    salesUpdatedFrom: null,
    salesOrderDateFrom: "2026-06-02T00:00:00.000Z",
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createShipheroAdapter", () => {
  it("loads every vendor name before inventory mapping", async () => {
    const execute = vi.fn().mockResolvedValue({
      vendors: {
        data: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [{ node: { id: "vendor-1", name: "Acme Supply" } }],
        },
      },
    })

    const result = await createShipheroAdapter({ execute }).pull(pullInput)

    expect(result.records).toEqual([
      {
        recordType: "vendor",
        externalId: "vendor-1",
        payload: { name: "Acme Supply" },
      },
    ])
    expect(result.nextCursor).toEqual(
      expect.objectContaining({
        phase: "purchase_orders",
        vendorNames: { "vendor-1": "Acme Supply" },
      })
    )
  })

  it("rejects an incomplete purchase-order line list instead of recording false coverage", async () => {
    const execute = vi.fn().mockResolvedValue({
      purchase_orders: {
        data: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [
            {
              node: {
                id: "po-1",
                po_number: "PO-1",
                line_items: {
                  pageInfo: { hasNextPage: true },
                  edges: [{ node: { sku: "SKU-1", quantity: 1 } }],
                },
              },
            },
          ],
        },
      },
    })

    await expect(
      createShipheroAdapter({ execute }).pull(purchaseOrderInput)
    ).rejects.toThrow("shiphero_purchase_order_lines_truncated:po-1")
  })

  it("records a complete purchase order and moves to inventory", async () => {
    const execute = vi.fn().mockResolvedValue({
      purchase_orders: {
        data: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [
            {
              node: {
                id: "po-1",
                po_number: "PO-1",
                line_items: {
                  pageInfo: { hasNextPage: false },
                  edges: [{ node: { sku: "SKU-1", quantity: 2 } }],
                },
              },
            },
          ],
        },
      },
    })

    const result = await createShipheroAdapter({ execute }).pull(
      purchaseOrderInput
    )
    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: "purchase_order",
        externalId: "po-1",
        payload: expect.objectContaining({
          po_number: "PO-1",
          lines: [expect.objectContaining({ sku: "SKU-1", quantity: 2 })],
        }),
      }),
    ])
    expect(result.nextCursor).toEqual(
      expect.objectContaining({ phase: "inventory" })
    )
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("purchase_orders(updated_from"),
      expect.objectContaining({
        updatedFrom: null,
        fulfillmentStatus: "pending",
      })
    )
  })

  it("uses an overlap-safe update window after the initial PO import", async () => {
    const execute = vi.fn().mockResolvedValue({
      purchase_orders: {
        data: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [],
        },
      },
    })

    await createShipheroAdapter({ execute }).pull({
      ...purchaseOrderInput,
      cursor: {
        ...purchaseOrderInput.cursor,
        poUpdatedFrom: "2026-07-15T00:00:00.000Z",
        poInitialStatus: null,
      },
    })

    expect(execute).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        updatedFrom: "2026-07-15T00:00:00.000Z",
        fulfillmentStatus: null,
      })
    )
  })

  it("advances PO and sales watermarks only after the whole cycle completes", async () => {
    const execute = vi.fn().mockResolvedValue({
      orders: {
        data: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [],
        },
      },
    })

    const result = await createShipheroAdapter({ execute }).pull({
      ...pullInput,
      cursor: {
        phase: "sales_orders",
        after: null,
        vendorNames: {},
        cycleStartedAt: "2026-07-17T00:00:00.000Z",
        poUpdatedFrom: null,
        poInitialStatus: "pending",
        salesUpdatedFrom: "2026-07-15T00:00:00.000Z",
        salesOrderDateFrom: null,
      },
    })

    expect(result.watermarks).toEqual({
      poSince: "2026-07-17T00:00:00.000Z",
      salesSince: "2026-07-17T00:00:00.000Z",
    })
  })
})

describe("ShipHero query complexity budget", () => {
  // ShipHero charges first(outer) × first(inner) up-front; the nested
  // line_items multiplier is what previously throttled the PO/sales phases.
  // Pin the inner page size so a regression back toward 100 fails loudly.
  it("requests a bounded line_items page for purchase orders", async () => {
    const execute = vi.fn().mockResolvedValue({
      purchase_orders: {
        data: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] },
      },
    })
    await createShipheroAdapter({ execute }).pull(purchaseOrderInput)
    const query = execute.mock.calls[0]?.[0] as string
    expect(query).toContain("line_items(first: 50)")
    expect(query).not.toContain("line_items(first: 100)")
  })

  it("requests a bounded line_items page for sales orders", async () => {
    const execute = vi.fn().mockResolvedValue({
      orders: {
        data: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] },
      },
    })
    await createShipheroAdapter({ execute }).pull({
      ...pullInput,
      cursor: {
        phase: "sales_orders",
        after: null,
        vendorNames: {},
        cycleStartedAt: "2026-07-17T00:00:00.000Z",
        poUpdatedFrom: null,
        poInitialStatus: null,
        salesUpdatedFrom: null,
        salesOrderDateFrom: "2026-06-02T00:00:00.000Z",
      },
    })
    const query = execute.mock.calls[0]?.[0] as string
    expect(query).toContain("line_items(first: 80)")
    expect(query).not.toContain("line_items(first: 100)")
  })
})

describe("createShipheroGraphqlExecutor", () => {
  it("refreshes an access token for unattended connector sync", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "fresh-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    const execute = createShipheroGraphqlExecutor({
      refreshToken: "refresh-token",
    })
    await expect(execute("query { ok }", {})).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/auth/refresh")
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-access-token",
        }),
      })
    )
  })

  it("waits out ShipHero's stated credit refill and then succeeds", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve(
            graphqlResponse({
              errors: [
                {
                  message:
                    "There are not enough credits available to perform this request. Required credits: 1002 Remaining credits: 802. Try again in 3 seconds",
                },
              ],
            })
          )
        )
        .mockImplementationOnce(() =>
          Promise.resolve(graphqlResponse({ data: { ok: true } }))
        )
      vi.stubGlobal("fetch", fetchMock)

      const execute = createShipheroGraphqlExecutor("access-token")
      const pending = execute("query { ok }", {})
      const assertion = expect(pending).resolves.toEqual({ ok: true })
      await vi.runAllTimersAsync()
      await assertion
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("treats HTTP 429 as a credit wait, not an instant failure", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve(new Response(null, { status: 429 }))
        )
        .mockImplementationOnce(() =>
          Promise.resolve(graphqlResponse({ data: { ok: true } }))
        )
      vi.stubGlobal("fetch", fetchMock)

      const execute = createShipheroGraphqlExecutor("access-token")
      const pending = execute("query { ok }", {})
      const assertion = expect(pending).resolves.toEqual({ ok: true })
      await vi.runAllTimersAsync()
      await assertion
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("gives up with shiphero_rate_limited once the shared wait budget is spent", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(
          graphqlResponse({
            errors: [
              {
                message:
                  "There are not enough credits available to perform this request. Try again in 30 seconds",
              },
            ],
          })
        )
      )
      vi.stubGlobal("fetch", fetchMock)

      const execute = createShipheroGraphqlExecutor("access-token")
      const pending = execute("query { ok }", {})
      const assertion = expect(pending).rejects.toThrow(
        "shiphero_rate_limited"
      )
      await vi.runAllTimersAsync()
      await assertion
      // 30s suggested wait fits the 35s budget once; the second throttle
      // cannot afford another 30s wait, so the pull fails over to backoff.
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

function graphqlResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
