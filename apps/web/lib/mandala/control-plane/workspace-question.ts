import type { WorkflowSupabaseClient } from "@/lib/mandala/workflows"
import { randomUUID } from "node:crypto"
import {
  normalizeProcurementOpenOrderObjects,
  type ProcurementEvidenceRole,
} from "../workspace-data/normalizers/procurement-open-orders"
import type {
  WorkspaceDataStore,
  WorkspaceSourceCoverage,
} from "../workspace-data/provider"
import { getWorkspaceMappingTemplate } from "../workspace-data/mapping-templates"
import { SupabaseWorkspaceDataStore } from "../workspace-data/supabase-store"

const maximumRecordsPerDataset = 20_000

type LoadedProcurementDataset = {
  dataset: ReturnType<typeof procurementDatasets>[number]
  records: Awaited<ReturnType<WorkspaceDataStore["loadRecords"]>>
  coverage: WorkspaceSourceCoverage[]
}

export function isOpenPurchaseOrderCountQuestion(input: string): boolean {
  return (
    /\b(?:how many|count|number of)\b/i.test(input) &&
    /\b(?:open|pending|outstanding)\b/i.test(input) &&
    /\b(?:po(?:s|'s)?|purchase orders?)\b/i.test(input)
  )
}

export function isLargestPastDatedOpenPurchaseOrderQuestion(
  input: string
): boolean {
  return (
    /\b(?:biggest|largest|highest(?:[ -]?value)?)\b/i.test(input) &&
    /\b(?:open|pending|outstanding)\b/i.test(input) &&
    /\b(?:late|overdue|past[ -]?due)\b/i.test(input) &&
    /\b(?:po(?:s|'s)?|purchase orders?)\b/i.test(input)
  )
}

export function isWorkspaceProcurementQuestion(input: string): boolean {
  return (
    isOpenPurchaseOrderCountQuestion(input) ||
    isLargestPastDatedOpenPurchaseOrderQuestion(input)
  )
}

export async function answerWorkspaceQuestion(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  question: string
}): Promise<string | null> {
  const store = new SupabaseWorkspaceDataStore(input.supabase, randomUUID())
  if (isOpenPurchaseOrderCountQuestion(input.question)) {
    return answerOpenPurchaseOrderCount(input.companyId, store)
  }
  if (isLargestPastDatedOpenPurchaseOrderQuestion(input.question)) {
    return answerLargestPastDatedOpenPurchaseOrder(input.companyId, store)
  }
  return null
}

export async function answerOpenPurchaseOrderCount(
  companyId: string,
  store: WorkspaceDataStore
): Promise<string> {
  const loaded = await loadProcurementEvidence(companyId, store)
  const coverage = loaded.flatMap((entry) => entry.coverage)
  const objects = normalizeProcurementOpenOrderObjects(
    loaded.map(({ dataset, records }) => ({
      role: dataset.evidenceRole,
      records,
    }))
  )
  const authoritative = objects.filter(({ roles }) =>
    roles.includes("authoritative")
  )
  const matchedAcrossSources = authoritative.filter(({ roles }) =>
    roles.includes("tracking")
  )
  const trackingOnly = objects.filter(
    ({ roles }) =>
      roles.includes("tracking") && !roles.includes("authoritative")
  )
  const { complete: coverageComplete, truncated } = coverageState(loaded, [
    "authoritative",
    "tracking",
  ])

  if (!coverageComplete) {
    const problems = coverageProblems(coverage, truncated)
    if (authoritative.length === 0) {
      return `I can’t safely give an open-PO count because not every configured procurement source is current and readable. ${problems}`
    }
    return `I found at least ${formatCount(authoritative.length)} open POs in authoritative sources, but the count is incomplete. ${problems}`
  }

  const authoritativeSources = sourceNames(coverage, "authoritative")
  const trackingSources = sourceNames(coverage, "tracking")
  const authorityLabel = authoritativeSources.join(" and ") || "The ERP source"
  if (trackingSources.length === 0) {
    return `${authorityLabel} shows ${formatCount(authoritative.length)} open POs. Every configured authoritative source was checked successfully.`
  }
  return `${authorityLabel} shows ${formatCount(authoritative.length)} open POs. I also checked ${trackingSources.join(" and ")}: ${formatCount(trackingOnly.length)} open procurement tracking ${trackingOnly.length === 1 ? "card is" : "cards are"} not deterministically linked to an authoritative PO, and ${formatCount(matchedAcrossSources.length)} ${matchedAcrossSources.length === 1 ? "matches" : "match"} the same PO.`
}

export async function answerLargestPastDatedOpenPurchaseOrder(
  companyId: string,
  store: WorkspaceDataStore,
  now: Date = new Date()
): Promise<string> {
  const loaded = await loadProcurementEvidence(companyId, store, [
    "authoritative",
  ])
  const authoritativeLoaded = loaded.filter(
    ({ dataset }) => dataset.evidenceRole === "authoritative"
  )
  const coverage = authoritativeLoaded.flatMap((entry) => entry.coverage)
  const { complete, truncated } = coverageState(loaded, ["authoritative"])
  if (!complete) {
    return `I can’t safely identify the largest past-dated open PO because not every configured authoritative procurement source is current and readable. ${coverageProblems(coverage, truncated)}`
  }

  const recordsById = new Map(
    authoritativeLoaded.flatMap(({ records }) =>
      records.map((record) => [record.id, record] as const)
    )
  )
  const objects = normalizeProcurementOpenOrderObjects(
    authoritativeLoaded.map(({ dataset, records }) => ({
      role: dataset.evidenceRole,
      records,
    }))
  )
  const candidates = objects.flatMap((object) => {
    const records = object.sources
      .map(({ recordId }) => recordsById.get(recordId))
      .filter((record): record is NonNullable<typeof record> => Boolean(record))
    const ranked = records
      .map(purchaseOrderCandidate)
      .filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== null && candidate.date.getTime() < now.getTime()
      )
      .sort((left, right) => right.value - left.value)
    return ranked.slice(0, 1)
  })
  const largest = candidates.sort((left, right) => right.value - left.value)[0]
  if (!largest) {
    return "I couldn’t find an open authoritative PO with both a past date and a numeric total."
  }

  const authorityLabel = sourceNames(coverage, "authoritative").join(" and ")
  const dateLabel = largest.dateField === "po_date" ? "PO date" : "due date"
  const caveat =
    largest.dateField === "po_date"
      ? " ShipHero does not provide a separate due-date field in these records, so this proves the PO date is past, not that the vendor is contractually late."
      : ""
  return `The largest open ${authorityLabel || "authoritative"} PO with a past ${dateLabel} is ${largest.reference} for ${formatCurrency(largest.value)} from ${largest.vendor}. Its ${dateLabel} is ${formatDate(largest.date)}.${caveat}`
}

function procurementDatasets() {
  const mapping = getWorkspaceMappingTemplate({
    capabilityKey: "procurement.open-orders.read",
    capabilityVersion: "1.0.0",
  })
  if (!mapping) throw new Error("procurement_open_orders_mapping_missing")
  return mapping.datasets.filter(
    (
      dataset
    ): dataset is typeof dataset & { evidenceRole: ProcurementEvidenceRole } =>
      dataset.evidenceRole === "authoritative" ||
      dataset.evidenceRole === "tracking"
  )
}

async function loadProcurementEvidence(
  companyId: string,
  store: WorkspaceDataStore,
  roles: readonly ProcurementEvidenceRole[] = ["authoritative", "tracking"]
): Promise<LoadedProcurementDataset[]> {
  return Promise.all(
    procurementDatasets()
      .filter((dataset) => roles.includes(dataset.evidenceRole))
      .map(async (dataset) => {
        const records = await store.loadRecords({
          companyId,
          sourceKey: dataset.sourceKey,
          recordType: dataset.recordType,
          limit: maximumRecordsPerDataset,
        })
        const coverage = store.inspectCoverage
          ? await store.inspectCoverage({
              companyId,
              sourceKey: dataset.sourceKey,
              recordType: dataset.recordType,
              businessObject: dataset.businessObject,
              evidenceRole: dataset.evidenceRole,
              maximumFreshnessHours: dataset.maximumFreshnessHours,
            })
          : []
        return { dataset, records, coverage }
      })
  )
}

function coverageState(
  loaded: readonly LoadedProcurementDataset[],
  roles: readonly ProcurementEvidenceRole[]
): { complete: boolean; truncated: boolean } {
  const relevant = loaded.filter(({ dataset }) =>
    roles.includes(dataset.evidenceRole)
  )
  const coverage = relevant.flatMap((entry) => entry.coverage)
  const truncated = relevant.some(
    ({ records, coverage: results }) =>
      results.reduce((total, result) => total + result.recordCount, 0) >
      records.length
  )
  return {
    complete:
      !truncated &&
      coverage.length > 0 &&
      coverage.every(({ status }) => status === "checked") &&
      roles.every((role) =>
        coverage.some(
          ({ evidenceRole, status }) =>
            evidenceRole === role && status === "checked"
        )
      ),
    truncated,
  }
}

function purchaseOrderCandidate(record: {
  externalId: string
  payload: Record<string, unknown>
}) {
  const value = numericValue(
    record.payload.total_price ??
      record.payload.total ??
      record.payload.subtotal
  )
  const dated = purchaseOrderDate(record.payload)
  if (value === null || !dated) return null
  return {
    reference:
      textValue(
        record.payload.po_number ??
          record.payload.purchase_order_number ??
          record.payload.order_number
      ) ?? record.externalId,
    vendor: textValue(record.payload.vendor_name) ?? "an unknown vendor",
    value,
    ...dated,
  }
}

function purchaseOrderDate(payload: Record<string, unknown>) {
  for (const field of [
    "due_date",
    "expected_delivery_date",
    "expected_date",
    "po_date",
  ] as const) {
    const value = textValue(payload[field])
    if (!value) continue
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return { date, dateField: field }
  }
  return null
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return null
  const parsed = Number(value.replace(/[$,]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function sourceNames(
  coverage: readonly WorkspaceSourceCoverage[],
  role: ProcurementEvidenceRole
): string[] {
  return [
    ...new Set(
      coverage
        .filter(
          ({ evidenceRole, status }) =>
            evidenceRole === role && status === "checked"
        )
        .map(({ sourceKey }) => displaySourceName(sourceKey))
    ),
  ]
}

function coverageProblems(
  coverage: readonly WorkspaceSourceCoverage[],
  truncated: boolean
): string {
  const problems = coverage
    .filter(({ status }) => status !== "checked")
    .map(
      ({ sourceKey, status }) => `${displaySourceName(sourceKey)} is ${status}`
    )
  if (truncated) problems.push("the bounded record scan was incomplete")
  if (problems.length === 0) problems.push("source coverage is missing")
  return `${problems.join("; ")}.`
}

function displaySourceName(sourceKey: string): string {
  if (sourceKey.toLowerCase() === "shiphero") return "ShipHero"
  if (sourceKey.toLowerCase() === "trello") return "Trello"
  return sourceKey
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(value)
}
