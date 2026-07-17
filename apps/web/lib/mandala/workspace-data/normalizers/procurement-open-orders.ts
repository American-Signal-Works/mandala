import type { WorkspaceExternalRecord } from "../provider"

export type ProcurementEvidenceRole =
  | "authoritative"
  | "tracking"
  | "supporting"

export type ProcurementOpenOrderDataset = {
  role: ProcurementEvidenceRole
  records: readonly WorkspaceExternalRecord[]
}

export type CanonicalOpenOrder = {
  key: string
  sku: string
  quantity: number
  roles: ProcurementEvidenceRole[]
  sources: Array<{
    recordId: string
    sourceId: string
    sourceKey: string
    recordType: string
    externalId: string
  }>
}

/**
 * Deterministically links operational PO rows and tracking cards. Semantic
 * retrieval may suggest additional context, but it never creates or removes a
 * duplicate-check match here.
 */
export function normalizeProcurementOpenOrders(
  datasets: readonly ProcurementOpenOrderDataset[]
): Map<string, CanonicalOpenOrder[]> {
  const canonical = new Map<string, CanonicalOpenOrder>()

  for (const dataset of datasets) {
    for (const record of dataset.records) {
      for (const candidate of candidates(record, dataset.role)) {
        const existing = canonical.get(candidate.key)
        if (!existing) {
          canonical.set(candidate.key, candidate)
          continue
        }
        existing.quantity = Math.max(existing.quantity, candidate.quantity)
        existing.roles = unique([...existing.roles, ...candidate.roles])
        existing.sources = uniqueSources([
          ...existing.sources,
          ...candidate.sources,
        ])
      }
    }
  }

  const bySku = new Map<string, CanonicalOpenOrder[]>()
  for (const order of canonical.values()) {
    const current = bySku.get(order.sku) ?? []
    current.push(order)
    bySku.set(order.sku, current)
  }
  for (const orders of bySku.values()) {
    orders.sort((left, right) => left.key.localeCompare(right.key))
  }
  return bySku
}

function candidates(
  record: WorkspaceExternalRecord,
  role: ProcurementEvidenceRole
): CanonicalOpenOrder[] {
  if (role === "supporting" || isClosed(record.payload)) return []
  const reference = businessReference(record)
  const source = {
    recordId: record.id,
    sourceId: record.sourceId,
    sourceKey: record.sourceKey,
    recordType: record.recordType,
    externalId: record.externalId,
  }

  if (role === "tracking") {
    const sku = nonEmptyString(record.payload.sku)
    if (!sku) return []
    return [
      {
        key: objectKey(reference, record, sku),
        sku,
        quantity: positiveNumber(record.payload.quantity) ?? 0,
        roles: [role],
        sources: [source],
      },
    ]
  }

  const lines = Array.isArray(record.payload.lines)
    ? record.payload.lines
    : [record.payload]
  return lines.flatMap((line) => {
    if (!isRecord(line)) return []
    const sku = nonEmptyString(line.sku) ?? nonEmptyString(record.payload.sku)
    if (!sku) return []
    return [
      {
        key: objectKey(reference, record, sku),
        sku,
        quantity:
          positiveNumber(line.quantity) ??
          positiveNumber(record.payload.quantity) ??
          0,
        roles: [role],
        sources: [source],
      },
    ]
  })
}

function businessReference(record: WorkspaceExternalRecord): string | null {
  for (const field of [
    "purchase_order_number",
    "po_number",
    "order_number",
    "purchaseOrderNumber",
  ]) {
    const value = nonEmptyString(record.payload[field])
    if (value) return normalizeIdentifier(value)
  }
  return normalizeIdentifier(record.externalId)
}

function objectKey(
  reference: string | null,
  record: WorkspaceExternalRecord,
  sku: string
): string {
  const object = reference
    ? `po:${reference}`
    : `source:${normalizeIdentifier(record.sourceKey)}:${normalizeIdentifier(record.externalId)}`
  return `${object}:sku:${normalizeIdentifier(sku)}`
}

function isClosed(payload: Record<string, unknown>): boolean {
  if (payload.closed === true) return true
  const status = [payload.status, payload.fulfillment_status, payload.list_name]
    .map(nonEmptyString)
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase()
  return /(^|\s)(closed|fulfilled|cancelled|canceled|done|archived)(\s|$)/.test(
    status
  )
}

function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "-")
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function uniqueSources(
  sources: CanonicalOpenOrder["sources"]
): CanonicalOpenOrder["sources"] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (seen.has(source.recordId)) return false
    seen.add(source.recordId)
    return true
  })
}
