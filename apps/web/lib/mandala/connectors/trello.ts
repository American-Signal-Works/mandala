import type {
  ConnectorAdapter,
  ConnectorCursor,
  ConnectorPullInput,
  ConnectorPullResult,
  ConnectorRecord,
} from "./types"

// Trello REST adapter for the procurement board. Cards map 1:1 to
// board_card records; procurement metadata (SKU, vendor, PO dates) lives in
// Trello custom fields, resolved via the board's customFields definition.
// The board id comes from external_sources.config.boardId.

const TRELLO_API = "https://api.trello.com/1"
const CARDS_PAGE = 1000

type TrelloExecutor = (path: string, params?: string) => Promise<unknown>

type TrelloCursor = ConnectorCursor & { phase: "cards"; before: string | null }

export function createTrelloExecutor(key: string, token: string): TrelloExecutor {
  return async (path, params = "") => {
    const auth = `key=${key}&token=${token}`
    const response = await fetch(`${TRELLO_API}/${path}?${auth}${params ? `&${params}` : ""}`)
    if (!response.ok) {
      throw new Error(`trello_http_${response.status}`)
    }
    return response.json()
  }
}

type TrelloList = { id: string; name: string }
type TrelloCustomField = {
  id: string
  name: string
  options?: Array<{ id: string; value?: { text?: string } }>
}
type TrelloCardFieldItem = {
  idCustomField: string
  idValue?: string
  value?: { text?: string; number?: string; date?: string }
}
type TrelloCard = {
  id: string
  name: string
  idList: string
  closed: boolean
  due: string | null
  dateLastActivity: string
  labels?: Array<{ name?: string }>
  customFieldItems?: TrelloCardFieldItem[]
}

export function createTrelloAdapter(options: { execute: TrelloExecutor }): ConnectorAdapter {
  const { execute } = options

  return {
    kind: "trello",
    async pull(input: ConnectorPullInput): Promise<ConnectorPullResult> {
      const boardId = typeof input.config.boardId === "string" ? input.config.boardId : null
      if (!boardId) throw new Error("trello_board_id_missing")

      const cursor = (input.cursor as TrelloCursor | null) ?? { phase: "cards" as const, before: null }
      let apiCalls = 0

      // Board metadata is two cheap requests; re-fetching per slice keeps the
      // cursor small and list/field renames current.
      const lists = (await execute(`boards/${boardId}/lists`, "fields=name&filter=all")) as TrelloList[]
      const customFields = (await execute(`boards/${boardId}/customFields`)) as TrelloCustomField[]
      apiCalls += 2

      const listNameById = new Map(lists.map((list) => [list.id, list.name]))
      const fieldById = new Map(customFields.map((field) => [field.id, field]))
      const optionValueById = new Map<string, string | undefined>()
      for (const field of customFields) {
        for (const option of field.options ?? []) optionValueById.set(option.id, option.value?.text)
      }

      const records: ConnectorRecord[] = []
      let before = cursor.before
      while (apiCalls < input.budget.maxApiCalls) {
        const page = (await execute(
          `boards/${boardId}/cards/all`,
          `limit=${CARDS_PAGE}&fields=name,idList,closed,due,dateLastActivity,labels&customFieldItems=true${before ? `&before=${before}` : ""}`
        )) as TrelloCard[]
        apiCalls += 1
        for (const card of page) {
          records.push(cardRecord(card, listNameById, fieldById, optionValueById))
        }
        const first = page[0]
        if (page.length < CARDS_PAGE || !first) {
          return { records, nextCursor: null, apiCalls }
        }
        before = page.reduce((min, card) => (card.id < min ? card.id : min), first.id)
      }
      return { records, nextCursor: { ...cursor, before }, apiCalls }
    },
  }
}

function cardRecord(
  card: TrelloCard,
  listNameById: Map<string, string>,
  fieldById: Map<string, TrelloCustomField>,
  optionValueById: Map<string, string | undefined>
): ConnectorRecord {
  const fields: Record<string, unknown> = {}
  for (const item of card.customFieldItems ?? []) {
    const field = fieldById.get(item.idCustomField)
    if (!field) continue
    let value: unknown = null
    if (item.value?.text !== undefined) value = item.value.text
    else if (item.value?.number !== undefined) value = Number(item.value.number)
    else if (item.value?.date !== undefined) value = item.value.date
    else if (item.idValue) value = optionValueById.get(item.idValue) ?? null
    fields[field.name] = value
  }

  const labels = (card.labels ?? []).map((label) => label.name).filter(Boolean)
  return {
    recordType: "board_card",
    externalId: card.id,
    payload: {
      due: card.due,
      sku: fields["SKU"] ?? null,
      name: card.name,
      closed: card.closed,
      labels: labels.length ? labels : null,
      vendor: fields["Vendor"] ?? null,
      list_name: listNameById.get(card.idList) ?? card.idList,
      warehouse: fields["Warehouse"] ?? null,
      order_type: fields["Order Type"] ?? null,
      order_number: fields["Order Number"] != null ? String(fields["Order Number"]) : null,
      po_ship_date: fields["PO Ship Date"] ?? null,
      last_activity: card.dateLastActivity,
      order_quantity: fields["Order Quantity"] ?? null,
      card_created_at: new Date(parseInt(card.id.slice(0, 8), 16) * 1000).toISOString(),
      po_expected_date: fields["PO Expected Date"] ?? null,
      po_received_date: fields["PO Received Date"] ?? null,
      po_confirmed_date: fields["PO Confirmed Date"] ?? null,
    },
  }
}

export function createTrelloAdapterFromEnvironment(): ConnectorAdapter {
  const key = process.env.TRELLO_KEY?.trim()
  const token = process.env.TRELLO_TOKEN?.trim()
  if (!key || !token) throw new Error("trello_credentials_missing")
  return createTrelloAdapter({ execute: createTrelloExecutor(key, token) })
}
