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

  return {
    projectedData: projectCapabilityDataForModel({
      data: data ?? {},
      bindings,
    }),
    capabilityAliases: bindings
      .filter((binding) => binding.useInPrompt)
      .map((binding) => binding.alias)
      .sort(),
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
