import { randomUUID } from "node:crypto"
import type { BaseCheckpointSaver } from "@langchain/langgraph"
import type { AgentTestRunRequest } from "@workspace/control-plane"
import { deriveControlInputHash } from "../control-plane/input-hash"
import { createDisabledContextRetriever } from "../context/retrieval-service"
import { getProductionWorkflowCheckpointer } from "../runtime/checkpointer"
import { runCompiledWorkflowInMemory } from "../runtime/memory-runner"
import { applyDeterministicRules } from "../runtime/primitives"
import type {
  RuntimeAgentJudgment,
  RuntimeRuleResult,
  RuntimeTrigger,
} from "../runtime/state"
import type { RuntimeCapabilityProvider } from "../runtime/graph"
import type { CompiledAgentManifest } from "../skills/compiler"
import { UsageServiceError, type ModelUsageRecorder } from "../usage"
import { createAgentWorkflowBindingSnapshot } from "../skills/lifecycle"
import {
  generateSyntheticCommerceDataset,
  runSyntheticManifestTestAgent,
  SyntheticProcurementAgentError,
  WorkflowMemoryStore,
  type SyntheticCommerceDataset,
  type SyntheticCommerceProduct,
  type SyntheticProcurementAgentResult,
  type WorkflowClientSurface,
  type WorkflowFixtureRunResult,
  type WorkflowSupabaseClient,
} from "../workflows"
import {
  persistCompiledWorkflowReview,
  type CompiledReviewPersistenceResult,
} from "./persistence"

type StoredAgentWorkflow = {
  id: string
  companyId: string
  skillMarkdown: string
  manifest: CompiledAgentManifest
}

export type SyntheticAgentTestRunResult = {
  agentId: string
  workflowRunId: string
  status: "blocked" | "suppressed" | "waiting_for_approval" | "completed"
  itemId: string | null
  dataset: Record<string, unknown>
  result: Record<string, unknown>
}

type TestRunDependencies = {
  now?: () => Date
  createId?: () => string
  loadWorkflow?: typeof loadStoredAgentWorkflow
  createBindingSnapshot?: typeof createAgentWorkflowBindingSnapshot
  generateDataset?: typeof generateSyntheticCommerceDataset
  runModelAgent?: typeof runSyntheticManifestTestAgent
  persist?: typeof persistCompiledWorkflowReview
  modelEnabled?: boolean
  loadCheckpointer?: () => Promise<BaseCheckpointSaver>
  recordUsage?: ModelUsageRecorder
}

export async function runSyntheticAgentTest(input: {
  supabase: WorkflowSupabaseClient
  agentId: string
  request: AgentTestRunRequest
  actorUserId: string
  clientSurface: WorkflowClientSurface
  dependencies?: TestRunDependencies
}): Promise<SyntheticAgentTestRunResult> {
  const dependencies = input.dependencies ?? {}
  const now = (dependencies.now ?? (() => new Date()))()
  const createId = dependencies.createId ?? randomUUID
  const loadWorkflow = dependencies.loadWorkflow ?? loadStoredAgentWorkflow
  const createBindingSnapshot =
    dependencies.createBindingSnapshot ?? createAgentWorkflowBindingSnapshot
  const datasetFactory =
    dependencies.generateDataset ?? generateSyntheticCommerceDataset
  const persist = dependencies.persist ?? persistCompiledWorkflowReview
  const checkpointer = await (
    dependencies.loadCheckpointer ?? getProductionWorkflowCheckpointer
  )()
  const workflow = await loadWorkflow({
    supabase: input.supabase,
    companyId: input.request.companyId,
    agentId: input.agentId,
  })
  const bindingSnapshotId = await createBindingSnapshot({
    supabase: input.supabase,
    companyId: input.request.companyId,
    agentId: input.agentId,
    manifest: workflow.manifest,
  })
  const seed =
    input.request.seed ??
    `${input.request.companyId}:${input.agentId}:${createId()}`
  const dataset = datasetFactory({ seed, generatedAt: now })
  const capabilityProvider = syntheticCapabilityProvider(dataset)
  const data = await capabilityProvider.load({
    state: {} as never,
    manifest: workflow.manifest,
    bindings: workflow.manifest.capabilityBindings,
    allowedTools:
      workflow.manifest.graph.find((node) => node.handler === "load_data")
        ?.allowedTools ?? [],
  })
  const declaredTrigger =
    workflow.manifest.workflow.triggers.find(
      (candidate) => candidate.kind === "fixture"
    ) ?? workflow.manifest.workflow.triggers[0]!
  const trigger: RuntimeTrigger = {
    id: declaredTrigger.id,
    kind: declaredTrigger.kind,
    input: {
      seed,
      datasetDigest: dataset.summary.digest,
      productCount: dataset.summary.productCount,
      bindingSnapshotId,
    },
  }
  const judgment = await createSyntheticJudgment({
    manifest: workflow.manifest,
    dataset,
    data: data.data,
    trigger,
    runModelAgent: dependencies.runModelAgent ?? runSyntheticManifestTestAgent,
    modelEnabled:
      dependencies.modelEnabled ??
      process.env.MANDALA_TEST_AGENT_ENABLED === "true",
    recordUsage: dependencies.recordUsage,
  })
  const store = new WorkflowMemoryStore()
  const run = await runCompiledWorkflowInMemory({
    store,
    manifest: workflow.manifest,
    companyId: input.request.companyId,
    actorUserId: input.actorUserId,
    workflowDefinitionId: workflow.id,
    trigger,
    capabilityProvider,
    contextRetriever: createDisabledContextRetriever(),
    agentJudgment: async () => judgment.value,
    skillMarkdown: workflow.skillMarkdown,
    now,
    trace: judgment.trace,
    checkpointer,
  })
  const persistence = await persist({
    supabase: input.supabase,
    companyId: input.request.companyId,
    workflowId: workflow.id,
    bindingSnapshotId,
    result: run,
    inputHash: deriveControlInputHash("test_agent", {
      companyId: input.request.companyId,
      agentId: input.agentId,
      seed,
      manifestDigest: workflow.manifest.manifestDigest,
      bindingSnapshotId,
    }),
    clientSurface: input.clientSurface,
  })

  return projectTestRunResult({
    workflow,
    run,
    persistence,
    dataset,
    judgment,
  })
}

export async function loadStoredAgentWorkflow(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
}): Promise<StoredAgentWorkflow> {
  const { data, error } = await input.supabase
    .from("agent_workflows")
    .select("id, company_id, spec, skill_markdown, skill_source_hash")
    .eq("company_id", input.companyId)
    .eq("id", input.agentId)
    .not("skill_source_hash", "is", null)
    .single()
  if (error) throw new Error(error.message)
  const manifest = data.spec as unknown as CompiledAgentManifest
  if (
    data.id !== input.agentId ||
    data.company_id !== input.companyId ||
    typeof data.skill_markdown !== "string" ||
    !manifest ||
    typeof manifest.manifestDigest !== "string" ||
    !Array.isArray(manifest.graph) ||
    !Array.isArray(manifest.capabilityBindings)
  ) {
    throw new Error("Stored agent manifest is invalid.")
  }
  return {
    id: data.id,
    companyId: data.company_id,
    skillMarkdown: data.skill_markdown,
    manifest,
  }
}

function syntheticCapabilityProvider(
  dataset: SyntheticCommerceDataset
): RuntimeCapabilityProvider {
  return {
    load: async ({ bindings }) => ({
      data: Object.fromEntries(
        bindings
          .filter((binding) => binding.access === "read")
          .map((binding) => [
            binding.alias,
            syntheticCapabilityValue(binding.id, dataset),
          ])
      ),
      sourceRefs: bindings
        .filter((binding) => binding.access === "read")
        .map((binding) => ({
          capabilityAlias: binding.alias,
          connectorId: binding.connectorId,
          observedAt: dataset.summary.generatedAt,
          reference: {
            datasetDigest: dataset.summary.digest,
            capability: binding.id,
            synthetic: true,
          },
        })),
    }),
  }
}

function syntheticCapabilityValue(
  capabilityId: string,
  dataset: SyntheticCommerceDataset
): Record<string, unknown> {
  if (capabilityId === "commerce.catalog.read") {
    return { products: dataset.products.slice(0, 100) }
  }
  if (capabilityId === "commerce.inventory.read") {
    return { inventory: dataset.products.slice(0, 100) }
  }
  if (capabilityId === "commerce.sales.read") {
    return { sales: dataset.sales.slice(0, 500) }
  }
  if (capabilityId === "commerce.events.read") {
    return { events: dataset.events }
  }
  if (capabilityId === "procurement.open-orders.read") {
    return {
      purchaseOrders: dataset.products
        .filter((product) => product.duplicateOpenOrderUnits > 0)
        .map((product) => ({
          sku: product.sku,
          quantity: product.duplicateOpenOrderUnits,
          status: "open",
        })),
    }
  }
  if (capabilityId === "procurement.vendor-terms.read") {
    return {
      vendorTerms: dataset.products.slice(0, 100).map((product) => ({
        sku: product.sku,
        vendor: product.vendor,
        leadTimeDays: product.leadTimeDays,
        packSize: product.vendorPackSize,
        minimumOrderQuantity: product.vendorMinimumOrderQuantity,
      })),
    }
  }
  return { dataset: dataset.summary }
}

async function createSyntheticJudgment(input: {
  manifest: CompiledAgentManifest
  dataset: SyntheticCommerceDataset
  data: Record<string, unknown>
  trigger: RuntimeTrigger
  runModelAgent: typeof runSyntheticManifestTestAgent
  modelEnabled: boolean
  recordUsage?: ModelUsageRecorder
}): Promise<{
  value: RuntimeAgentJudgment
  trace?: { langSmithTraceId?: string | null; langSmithRunId?: string | null }
  mode: "model" | "deterministic"
  model: string | null
  selected: SyntheticCommerceProduct
  modelFallback: SyntheticProcurementAgentError["errorClass"] | null
}> {
  let modelRun: SyntheticProcurementAgentResult | null = null
  let modelFallback: SyntheticProcurementAgentError["errorClass"] | null = null
  if (input.modelEnabled && hasModelReadableCapabilities(input.manifest)) {
    try {
      modelRun = await input.runModelAgent({
        dataset: input.dataset,
        manifest: input.manifest,
        ...(input.recordUsage
          ? { dependencies: { recordUsage: input.recordUsage } }
          : {}),
      })
      if (
        evaluateCandidate(
          input.manifest,
          input.trigger,
          input.data,
          modelRun.selectedProduct
        ).disposition !== "continue"
      ) {
        modelRun = null
        modelFallback = "invalid_selection"
      }
    } catch (error) {
      if (error instanceof UsageServiceError) throw error
      modelFallback =
        error instanceof SyntheticProcurementAgentError
          ? error.errorClass
          : "model_error"
    }
  }
  const selected =
    modelRun?.selectedProduct ??
    selectCandidateFromCompiledRules({
      manifest: input.manifest,
      trigger: input.trigger,
      data: input.data,
      products: input.dataset.products,
    })
  const value: RuntimeAgentJudgment = {
    proposal: { selection: selected },
    rationale:
      modelRun?.selection.rationale ??
      `${selected.title} (${selected.sku}) matched the compiled skill rules after evaluating ${input.dataset.summary.productCount} synthetic records.`,
    confidence: modelRun ? 0.82 : 0.75,
    warnings: modelRun?.selection.riskFlags ?? [],
    context: {
      datasetDigest: input.dataset.summary.digest,
      model: modelRun?.model ?? null,
      toolCalls: modelRun?.toolCalls.length ?? 0,
      modelFallback,
    },
  }
  return {
    value,
    mode: modelRun ? "model" : "deterministic",
    model: modelRun?.model ?? null,
    selected,
    modelFallback,
    ...(modelRun?.trace
      ? {
          trace: {
            langSmithTraceId: modelRun.trace.traceId,
            langSmithRunId: modelRun.trace.runId,
          },
        }
      : {}),
  }
}

function hasModelReadableCapabilities(
  manifest: CompiledAgentManifest
): boolean {
  return manifest.capabilityBindings.some(
    (binding) =>
      binding.access === "read" &&
      binding.useInPrompt &&
      (binding.modelAllowedPaths?.length ?? 0) > 0
  )
}

function selectCandidateFromCompiledRules(input: {
  manifest: CompiledAgentManifest
  trigger: RuntimeTrigger
  data: Record<string, unknown>
  products: SyntheticCommerceProduct[]
}): SyntheticCommerceProduct {
  let nonBlocking: SyntheticCommerceProduct | null = null
  for (const product of input.products) {
    const result = evaluateCandidate(
      input.manifest,
      input.trigger,
      input.data,
      product
    )
    if (result.ok && result.disposition === "continue") return product
    if (result.ok && !nonBlocking) nonBlocking = product
  }
  return nonBlocking ?? input.products[0]!
}

function evaluateCandidate(
  manifest: CompiledAgentManifest,
  trigger: RuntimeTrigger,
  data: Record<string, unknown>,
  product: SyntheticCommerceProduct
): RuntimeRuleResult {
  return applyDeterministicRules({
    rules: manifest.rules,
    context: {
      trigger,
      data,
      agent: {
        selection: product,
        rationale: "Synthetic candidate evaluation.",
        confidence: 0.75,
        warnings: [],
        context: {},
      },
      rules: {},
      context: {},
    },
  })
}

function projectTestRunResult(input: {
  workflow: StoredAgentWorkflow
  run: WorkflowFixtureRunResult
  persistence: CompiledReviewPersistenceResult
  dataset: SyntheticCommerceDataset
  judgment: Awaited<ReturnType<typeof createSyntheticJudgment>>
}): SyntheticAgentTestRunResult {
  const status =
    input.run.run.status === "blocked"
      ? "blocked"
      : input.run.run.status === "suppressed"
        ? "suppressed"
        : input.run.run.status === "waiting_for_approval"
          ? "waiting_for_approval"
          : "completed"
  return {
    agentId: input.workflow.id,
    workflowRunId: input.persistence.workflowRunId,
    status,
    itemId: input.persistence.itemId,
    dataset: input.dataset.summary,
    result: {
      execution: input.judgment.mode,
      model: input.judgment.model,
      modelFallback: input.judgment.modelFallback,
      selectedSku: input.judgment.selected.sku,
      duplicate: input.persistence.duplicate,
      draftId: input.persistence.draftId,
      recommendation: input.run.recommendation?.output ?? null,
      warnings: input.run.recommendation?.warnings ?? [],
    },
  }
}
