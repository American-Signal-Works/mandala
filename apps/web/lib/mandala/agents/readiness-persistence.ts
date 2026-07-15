import { randomUUID } from "node:crypto"
import type { Json } from "@/lib/supabase/types"
import type { WorkflowSupabaseClient } from "../workflows"
import {
  resolveCompanyCompilerCapabilities,
  type ResolvedCompilerCapability,
} from "../skills/capabilities"
import type { CompiledAgentManifest } from "../skills/compiler"
import { getAgentRuntimeState } from "../skills/lifecycle"
import {
  InMemoryEvaluationResultStore,
  evaluatePromotion,
  runEvaluationSuite,
} from "../runtime/evaluation"
import { evaluateAgentReadiness } from "./readiness"
import type { SyntheticAgentTestRunResult } from "./test-run"

const evaluatorVersion = "1.0.0"

export async function recordAgentTestReadiness(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
  result: SyntheticAgentTestRunResult
}): Promise<void> {
  const current = await getAgentRuntimeState(input).catch(() => null)
  if (
    current &&
    ["active", "disabled", "archived"].includes(current.lifecycleState)
  )
    return

  const [{ data: workflow, error }, capabilities] = await Promise.all([
    input.supabase
      .from("agent_workflows")
      .select("version, spec, compiled_manifest_hash, skill_source_hash")
      .eq("company_id", input.companyId)
      .eq("id", input.agentId)
      .single(),
    resolveCompanyCompilerCapabilities({
      supabase: input.supabase,
      companyId: input.companyId,
    }).catch(() => [] as ResolvedCompilerCapability[]),
  ])
  if (error) throw new Error(error.message)
  const manifest = workflow.spec as unknown as CompiledAgentManifest
  const store = new InMemoryEvaluationResultStore()
  const succeeded =
    input.result.status === "waiting_for_approval" &&
    input.result.itemId !== null
  const evidenceCount = input.result.itemId ? 1 : 0
  await runEvaluationSuite({
    id: randomUUID(),
    fixtures: [
      {
        id: "sandbox-review",
        version: 1,
        companyId: input.companyId,
        agentKey: manifest.identity.id,
        agentVersion: workflow.version,
        input: input.result.dataset,
        expected: { status: "waiting_for_approval", minimumEvidence: 1 },
        unavailableReason: null,
        sourceDigest:
          workflow.compiled_manifest_hash ?? workflow.skill_source_hash ?? "",
      },
    ],
    fixtureSetVersion: 1,
    evaluatorVersion,
    store,
    execute: async () => ({
      passed: succeeded && evidenceCount >= 1,
      metrics: [
        {
          key: "review_produced",
          value: succeeded ? 1 : 0,
          available: true,
          reason: null,
        },
        {
          key: "evidence_present",
          value: evidenceCount >= 1 ? 1 : 0,
          available: true,
          reason: null,
        },
        {
          key: "safe_mode",
          value: 1,
          available: true,
          reason: null,
        },
      ],
      safeOutput: {
        status: input.result.status,
        itemId: input.result.itemId,
      },
    }),
  })
  const promotion = await evaluatePromotion({
    store,
    companyId: input.companyId,
    agentKey: manifest.identity.id,
    agentVersion: workflow.version,
    fixtureSetVersion: 1,
    evaluatorVersion,
    thresholds: [
      { metric: "review_produced", minimum: 1, required: true },
      { metric: "evidence_present", minimum: 1, required: true },
      { metric: "safe_mode", minimum: 1, required: true },
    ],
  })
  const requestedModes = manifest.actions.map((action) => action.mode)
  const capabilityChecks = manifest.capabilityBindings.map((binding) => {
    const resolved = capabilities.find(
      (candidate) =>
        candidate.id === binding.id &&
        candidate.version === binding.version &&
        candidate.connectorId === binding.connectorId &&
        candidate.schemaDigest === binding.schemaDigest
    )
    return {
      id: binding.id,
      version: binding.version,
      granted: resolved?.granted === true,
      healthy: resolved?.healthy === true,
      schemaCompatible: resolved?.schemaCompatible === true,
    }
  })
  const warnings = Array.isArray(input.result.result.warnings)
    ? input.result.result.warnings.filter(
        (warning): warning is string => typeof warning === "string"
      )
    : []
  const report = evaluateAgentReadiness({
    companyId: input.companyId,
    agentId: input.agentId,
    agentVersion: workflow.version,
    configurationVersion: 1,
    lifecycleVersion: current?.stateVersion ?? 1,
    requestedModes,
    configurationDiagnostics: [],
    capabilities: capabilityChecks,
    policyAllowed: capabilityChecks.every((capability) => capability.granted),
    policyVersion: 1,
    bindingVersion: 1,
    bindingCurrent: capabilityChecks.every(
      (capability) => capability.granted && capability.healthy && capability.schemaCompatible
    ),
    sampleRun: {
      fixtureId: "sandbox-review",
      succeeded,
      evidenceCount,
      warnings,
      reason: succeeded
        ? null
        : "The Sandbox run did not produce a review item with evidence.",
    },
    promotion,
  })
  const issues = report.diagnostics
    .filter((diagnostic) => diagnostic.severity === "blocker")
    .map(({ code, message, path }) => ({ code, message, path }))

  const rpc = input.supabase.rpc.bind(input.supabase) as unknown as (
    name: string,
    parameters: Record<string, unknown>
  ) => PromiseLike<{ error: { message: string } | null }>
  const recorded = await rpc("record_agent_test_evaluation_v1", {
    p_company_id: input.companyId,
    p_workflow_id: input.agentId,
    p_expected_version: current?.stateVersion ?? 1,
    p_sample_run_id: input.result.workflowRunId,
    p_sample_item_id: input.result.itemId,
    p_client_issues: issues as Json,
    p_evaluator_version: evaluatorVersion,
    p_reason: report.activationEligible
      ? "Sandbox evaluation passed and promotion requirements are satisfied."
      : "Sandbox evaluation found activation blockers.",
  })
  if (recorded.error) throw new Error(recorded.error.message)

}
