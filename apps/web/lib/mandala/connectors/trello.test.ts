import { afterEach, describe, expect, it, vi } from "vitest"

import { createTrelloAdapter, createTrelloExecutor } from "./trello"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createTrelloAdapter", () => {
  it("normalizes procurement custom fields for the shared evidence model", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ id: "list-1", name: "PO Created" }])
      .mockResolvedValueOnce([
        { id: "field-sku", name: "SKU" },
        { id: "field-quantity", name: "Order Quantity" },
        { id: "field-number", name: "Order Number" },
      ])
      .mockResolvedValueOnce([
        {
          id: "64f000000000000000000001",
          name: "Order SKU-1",
          idList: "list-1",
          closed: false,
          due: null,
          dateLastActivity: "2026-07-17T00:00:00Z",
          customFieldItems: [
            { idCustomField: "field-sku", value: { text: "SKU-1" } },
            { idCustomField: "field-quantity", value: { number: "12" } },
            { idCustomField: "field-number", value: { text: "PO-123" } },
          ],
        },
      ])

    const result = await createTrelloAdapter({ execute }).pull({
      cursor: null,
      config: { boardId: "board-1" },
      watermarks: {},
      budget: { maxApiCalls: 3 },
      now: new Date("2026-07-17T00:00:00Z"),
    })

    expect(result).toMatchObject({ nextCursor: null, apiCalls: 3 })
    expect(result.records).toEqual([
      expect.objectContaining({
        recordType: "board_card",
        payload: expect.objectContaining({
          sku: "SKU-1",
          quantity: 12,
          order_quantity: 12,
          order_number: "PO-123",
          list_name: "PO Created",
        }),
      }),
    ])
  })

  it("requires a board id before making provider calls", async () => {
    const execute = vi.fn()
    await expect(
      createTrelloAdapter({ execute }).pull({
        cursor: null,
        config: {},
        watermarks: {},
        budget: { maxApiCalls: 3 },
        now: new Date("2026-07-17T00:00:00Z"),
      })
    ).rejects.toThrow("trello_board_id_missing")
    expect(execute).not.toHaveBeenCalled()
  })

  it("does not exceed an undersized API-call budget", async () => {
    const execute = vi.fn()
    await expect(
      createTrelloAdapter({ execute }).pull({
        cursor: null,
        config: { boardId: "board-1" },
        watermarks: {},
        budget: { maxApiCalls: 2 },
        now: new Date("2026-07-17T00:00:00Z"),
      })
    ).rejects.toThrow("trello_api_budget_too_small")
    expect(execute).not.toHaveBeenCalled()
  })
})

describe("createTrelloExecutor", () => {
  it("keeps the secret token out of request URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    await createTrelloExecutor("public-key", "secret-token")(
      "boards/board-1/lists",
      "fields=name"
    )

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.trello.com/1/boards/board-1/lists?fields=name"
    )
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: {
          Authorization:
            'OAuth oauth_consumer_key="public-key", oauth_token="secret-token"',
        },
      })
    )
  })
})
