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

export function isOpenPurchaseOrderCountQuestion(input: string): boolean {
  return (
    /\b(?:how many|count|number of)\b/i.test(input) &&
    /\b(?:open|pending|outstanding)\b/i.test(input) &&
    /\b(?:po(?:s|'s)?|purchase orders?)\b/i.test(input)
  )
}

export async function answerWorkspaceQuestion(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  question: string
}): Promise<string | null> {
  if (!isOpenPurchaseOrderCountQuestion(input.question)) return null
  return answerOpenPurchaseOrderCount(
    input.companyId,
    new SupabaseWorkspaceDataStore(input.supabase, randomUUID())
  )
}

export async function answerOpenPurchaseOrderCount(
  companyId: string,
  store: WorkspaceDataStore
): Promise<string> {
  const mapping = getWorkspaceMappingTemplate({
    capabilityKey: "procurement.open-orders.read",
    capabilityVersion: "1.0.0",
  })
  if (!mapping) throw new Error("procurement_open_orders_mapping_missing")

  const datasets = mapping.datasets.filter(
    (
      dataset
    ): dataset is typeof dataset & { evidenceRole: ProcurementEvidenceRole } =>
      dataset.evidenceRole === "authoritative" ||
      dataset.evidenceRole === "tracking"
  )
  const loaded = await Promise.all(
    datasets.map(async (dataset) => {
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
  const truncated = loaded.some(({ records, coverage: results }) => {
    const catalogCount = results.reduce(
      (total, result) => total + result.recordCount,
      0
    )
    return catalogCount > records.length
  })
  const coverageComplete =
    !truncated &&
    coverage.length > 0 &&
    coverage.every(({ status }) => status === "checked") &&
    coverage.some(
      ({ evidenceRole, status }) =>
        evidenceRole === "authoritative" && status === "checked"
    )

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
