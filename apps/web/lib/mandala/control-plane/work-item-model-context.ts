import type { WorkflowSupabaseClient } from "@/lib/mandala/workflows"
import type { WorkItemDetail } from "@workspace/control-plane"
import { projectCapabilityDataForModel } from "../capabilities/model-egress"
import {
  resolveCompanyCompilerCapabilities,
  type ResolvedCompilerCapability,
} from "../skills/capabilities"
import type {
  CompiledAgentManifest,
  CompiledCapabilityBinding,
} from "../skills/compiler"
import type { WorkItemQuestionModelContext } from "./work-item-question"

export async function loadWorkItemQuestionModelContext(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  itemId: string
  detail: WorkItemDetail
}): Promise<WorkItemQuestionModelContext> {
  const { data: item, error: itemError } = await input.supabase
    .from("workflow_items")
    .select("workflow_id")
    .eq("company_id", input.companyId)
    .eq("id", input.itemId)
    .single()
  if (itemError) throw new Error(itemError.message)

  const { data: workflow, error: workflowError } = await input.supabase
    .from("agent_workflows")
    .select("spec")
    .eq("company_id", input.companyId)
    .eq("id", item.workflow_id)
    .single()
  if (workflowError) throw new Error(workflowError.message)

  const manifest = workflow.spec as unknown as CompiledAgentManifest
  const capabilities = await resolveCompanyCompilerCapabilities({
    supabase: input.supabase,
    companyId: input.companyId,
  })
  const bindings = currentModelBindings(manifest, capabilities)
  const facts = asRecord(input.detail.contextPacket?.facts)
  const data = asRecord(facts?.data)
  const fixtureProjection =
    bindings.length === 0
      ? projectLegacyFixtureDataForModel(input.detail)
      : null
  const projectedData =
    fixtureProjection ??
    projectCapabilityDataForModel({
      data: data ?? {},
      bindings,
    })

  return {
    projectedData,
    capabilityAliases: fixtureProjection
      ? ["synthetic-fixture"]
      : bindings
          .filter((binding) => binding.useInPrompt)
          .map((binding) => binding.alias)
          .sort(),
  }
}

// Cycle .7 fixtures predate compiled capability bindings. Their work-item
// projection is already bounded, synthetic, and visible to the reviewer, so
// preserve a narrow allowlist for explanation without opening a fallback for
// real connector data.
export function projectLegacyFixtureDataForModel(
  detail: WorkItemDetail
): Record<string, unknown> | null {
  const sources = detail.contextPacket?.sources ?? []
  if (
    sources.length === 0 ||
    !sources.every((source) => {
      const name = asRecord(source)?.source
      return (
        typeof name === "string" &&
        (name.startsWith("fixture_") || name.startsWith("synthetic_"))
      )
    })
  ) {
    return null
  }

  const facts = asRecord(detail.contextPacket?.facts) ?? {}
  const recommendationOutput = asRecord(detail.recommendation?.output) ?? {}
  return {
    "synthetic-fixture": {
      inventory: pickSafeScalars(facts, [
        "sku",
        "productTitle",
        "inventoryOnHand",
        "onHandInventory",
        "inboundUnits",
        "availableInventory",
        "reorderPoint",
        "safetyStockUnits",
        "dataFreshnessHours",
      ]),
      sales: pickSafeScalars(facts, [
        "recent30DaySales",
        "trailing90DaySales",
        "recent90DaySales",
        "seasonalIndex",
        "recentSpikeMultiplier",
      ]),
      vendorTerms: pickSafeScalars(facts, [
        "vendor",
        "leadTimeDays",
        "vendorPackSize",
        "vendorMinimumOrderQuantity",
      ]),
      openOrders: pickSafeScalars(facts, [
        "openPurchaseOrders",
        "duplicateOpenOrderUnits",
        "duplicateOpenOrderMatchCount",
        "openOrderSourceCoverageComplete",
      ]),
      recommendation: {
        rationale: detail.recommendation?.rationaleSummary ?? null,
        ...pickSafeScalars(recommendationOutput, [
          "sku",
          "reorderPoint",
          "availableInventory",
          "projectedDailySales",
          "recommendedQuantity",
          "projectedCoverageDays",
        ]),
      },
      evidence: (detail.evidence?.evidence ?? [])
        .slice(0, 20)
        .flatMap((entry) => {
          const record = asRecord(entry)
          return typeof record?.label === "string" && isSafeScalar(record.value)
            ? [{ label: record.label.slice(0, 128), value: record.value }]
            : []
        }),
      assumptions: (detail.evidence?.assumptions ?? [])
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 20)
        .map((entry) => entry.slice(0, 500)),
    },
  }
}

export function currentModelBindings(
  manifest: CompiledAgentManifest,
  capabilities: readonly ResolvedCompilerCapability[]
): CompiledCapabilityBinding[] {
  return (manifest.capabilityBindings ?? []).flatMap((binding) => {
    const current = capabilities.filter(
      (candidate) =>
        candidate.id === binding.id &&
        candidate.version === binding.version &&
        candidate.access === binding.access &&
        candidate.connectorId === binding.connectorId &&
        candidate.schemaDigest === binding.schemaDigest &&
        candidate.granted &&
        candidate.healthy &&
        candidate.schemaCompatible &&
        candidate.modelAllowedPaths?.length
    )
    if (current.length !== 1) return []
    return [
      {
        ...binding,
        granted: true,
        healthy: true,
        schemaCompatible: true,
        modelAllowedPaths: [...(current[0]!.modelAllowedPaths ?? [])],
      },
    ]
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function pickSafeScalars(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      Object.hasOwn(source, key) && isSafeScalar(source[key])
        ? [[key, source[key]]]
        : []
    )
  )
}

function isSafeScalar(
  value: unknown
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
}
