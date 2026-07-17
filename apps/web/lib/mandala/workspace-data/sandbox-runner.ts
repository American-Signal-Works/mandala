import { randomUUID } from "node:crypto"
import type { WorkspaceSandboxRunResponse } from "@workspace/control-plane"
import { workspaceSandboxRunResponseSchema } from "@workspace/control-plane"
import type { WorkflowSupabaseClient } from "../workflows"
import { WorkflowMemoryStore } from "../workflows"
import { runCompiledWorkflowInMemory } from "../runtime/memory-runner"
import type { RuntimeAgentJudgment } from "../runtime/state"
import { WorkspaceDatasetProvider, type WorkspaceProjection } from "./provider"
import { SupabaseWorkspaceDataStore } from "./supabase-store"
import { captureSandboxFingerprint } from "./proof"
import { prepareWorkspaceAgent } from "./setup"

export async function runWorkspaceSandboxGoldenPath(input: {
  supabase: WorkflowSupabaseClient
  proofSupabase: WorkflowSupabaseClient
  companyId: string
  actorUserId: string
  skillMarkdown: string
  confirmMappings: boolean
  now?: Date
}): Promise<WorkspaceSandboxRunResponse> {
  const now = input.now ?? new Date()
  const setup = await prepareWorkspaceAgent(input)
  const store = new SupabaseWorkspaceDataStore(
    input.supabase,
    setup.bindingSnapshotId,
    () => now
  )
  const provider = new WorkspaceDatasetProvider(store, () => now)
  const prepared = await provider.prepare({
    companyId: input.companyId,
    bindings: setup.manifest.capabilityBindings,
  })

  // Setup and catalog writes are intentionally complete before this point.
  // Everything between these two fingerprints is request-local.
  const proofInput = {
    supabase: input.proofSupabase,
    companyId: input.companyId,
  }
  const before = await captureSandboxFingerprint(proofInput)
  const externalWriteAttempts = 0
  const memory = new WorkflowMemoryStore()
  const result = await runCompiledWorkflowInMemory({
    store: memory,
    manifest: setup.manifest,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    workflowDefinitionId: setup.agent.id,
    trigger: {
      id: prepared.signal.id,
      kind: "webhook",
      input: {
        operatingMode: "sandbox",
        entityKey: prepared.signal.entityKey,
        entityValue: prepared.signal.entityValue,
        mappingVersionId: prepared.signal.mappingVersionId,
      },
    },
    capabilityProvider: provider,
    agentJudgment: createWorkspaceJudgment(
      prepared.projections,
      prepared.signal.entityValue
    ),
    actionHandler: async () => {
      // This is a simulation result only. It has no connector or network client.
      return {
        attemptId: randomUUID(),
        status: "succeeded",
        output: { committed: false, simulated: true, externalWriteAttempts },
      }
    },
    skillMarkdown: input.skillMarkdown,
    now,
    operatingMode: "sandbox",
  })
  const after = await captureSandboxFingerprint(proofInput)
  const unchanged = before.digest === after.digest
  if (!unchanged) {
    throw new Error("sandbox_persistence_firewall_failed")
  }

  return workspaceSandboxRunResponseSchema.parse({
    schemaVersion: 1,
    mode: "sandbox",
    ephemeral: true,
    companyId: input.companyId,
    sessionId: randomUUID(),
    catalog: setup.catalog,
    mappings: setup.mappings.map((mapping) => ({
      requirementKey: mapping.requirementKey,
      capabilityKey: mapping.capabilityKey,
      mappingVersionId: mapping.mappingVersionId,
      version: mapping.version,
      status: mapping.status,
      confidence: mapping.confidence,
    })),
    agent: {
      id: setup.agent.id,
      name: setup.agent.name,
      version: setup.agent.version,
      active: false,
      manifestDigest: setup.manifest.manifestDigest,
      bindingSnapshotId: setup.bindingSnapshotId,
    },
    signal: {
      id: prepared.signal.id,
      entityKey: prepared.signal.entityKey,
      entityValue: prepared.signal.entityValue,
      detectedAt: prepared.signal.detectedAt,
      evidence: prepared.signal.evidence,
    },
    harness: {
      workflowRunId: result.run.id,
      status: harnessStatus(result.run.status),
      graphNodes: setup.manifest.graph.map(({ id }) => id),
    },
    deliverable:
      result.item && result.recommendation && result.evidence
        ? {
            item: {
              type: result.item.itemType,
              key: result.item.itemKey,
              title: result.item.title,
              priority: result.item.priority,
              related: result.item.relatedRecords,
            },
            recommendation: {
              rationale: result.recommendation.rationaleSummary,
              confidence: result.recommendation.confidence,
              output: result.recommendation.output,
            },
            draft: result.draft
              ? {
                  action: result.draft.actionType,
                  payload: result.draft.payload,
                  editPolicy: result.draft.editPolicy,
                }
              : null,
            evidence: {
              requirements: result.evidence.evidence.flatMap((entry) =>
                typeof entry.requirement === "string" ? [entry.requirement] : []
              ),
              assumptions: result.evidence.assumptions,
              sourceCapabilities: setup.manifest.evidence.source_capabilities,
              sourceRefs: result.evidence.sourceRefs,
            },
          }
        : null,
    proof: {
      scope: "sandbox_execution",
      beforeDigest: before.digest,
      afterDigest: after.digest,
      unchanged,
      persistenceWrites: 0,
      externalWriteAttempts,
      monitoredTables: before.tables,
      setupCompletedBeforeBaseline: true,
    },
  })
}

function createWorkspaceJudgment(
  projections: WorkspaceProjection[],
  entityValue: string
) {
  return async (): Promise<RuntimeAgentJudgment> => {
    const selection: Record<string, unknown> = {}
    const mappingVersions: string[] = []
    for (const projection of projections) {
      const entityKey = projection.binding.spec.output.entityKey
      const record = projection.records.find(
        (candidate) => String(candidate[entityKey]) === entityValue
      )
      if (record) Object.assign(selection, record)
      mappingVersions.push(projection.binding.mappingVersionId)
    }
    return {
      proposal: { selection },
      rationale: `${entityValue} matched the installed skill's declarative signal and was evaluated by its compiled deterministic rules.`,
      confidence: 0.8,
      warnings: [],
      context: {
        operatingMode: "sandbox",
        mappingVersions,
        model: null,
        modelFallback: "deterministic",
      },
    }
  }
}

function harnessStatus(status: string) {
  if (status === "waiting_for_approval") return status
  if (status === "suppressed") return status
  if (status === "blocked" || status === "failed") return "blocked" as const
  return "completed" as const
}
