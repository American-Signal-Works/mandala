import { stableHash, type ExecutionMode } from "../actions"
import type { PromotionDecision } from "../runtime/evaluation"

export type AgentLifecycleState =
  | "draft"
  | "ready"
  | "active"
  | "paused"
  | "disabled"

export type ReadinessDiagnostic = {
  severity: "blocker" | "warning"
  code:
    | "configuration_invalid"
    | "capability_unavailable"
    | "binding_stale"
    | "policy_denied"
    | "mode_unavailable"
    | "sample_run_failed"
    | "evaluation_blocked"
    | "evaluation_unavailable"
  path: string
  message: string
}

export type AgentReadinessInput = {
  companyId: string
  agentId: string
  agentVersion: string
  configurationVersion: number
  lifecycleVersion: number
  requestedModes: readonly ExecutionMode[]
  configurationDiagnostics: readonly Omit<ReadinessDiagnostic, "severity">[]
  capabilities: readonly {
    id: string
    version: string
    granted: boolean
    healthy: boolean
    schemaCompatible: boolean
  }[]
  policyAllowed: boolean
  policyVersion: number
  bindingVersion: number
  bindingCurrent: boolean
  sampleRun: {
    fixtureId: string
    succeeded: boolean
    evidenceCount: number
    warnings: string[]
    reason: string | null
  } | null
  promotion: PromotionDecision
}

export type AgentReadinessReport = {
  companyId: string
  agentId: string
  agentVersion: string
  configurationVersion: number
  lifecycleVersion: number
  policyVersion: number
  bindingVersion: number
  status: "draft" | "ready"
  activationEligible: boolean
  diagnostics: ReadinessDiagnostic[]
  sampleRun: AgentReadinessInput["sampleRun"]
  checkedAt: string
  digest: string
}

export interface AgentReadinessSource {
  load(input: {
    companyId: string
    agentId: string
  }): Promise<AgentReadinessInput>
}

export function createAgentReadinessService(input: {
  source: AgentReadinessSource
  now?: () => Date
}) {
  return {
    async check(request: { companyId: string; agentId: string }) {
      return evaluateAgentReadiness(
        await input.source.load(request),
        input.now?.() ?? new Date()
      )
    },
  }
}

export function evaluateAgentReadiness(
  input: AgentReadinessInput,
  checkedAt = new Date()
): AgentReadinessReport {
  const diagnostics: ReadinessDiagnostic[] = input.configurationDiagnostics.map(
    (diagnostic) => ({ ...diagnostic, severity: "blocker" })
  )
  for (const capability of input.capabilities) {
    if (!capability.granted || !capability.healthy) {
      diagnostics.push({
        severity: "blocker",
        code: "capability_unavailable",
        path: `capabilities.${capability.id}`,
        message: `${capability.id} v${capability.version} is not currently granted and healthy.`,
      })
    } else if (!capability.schemaCompatible) {
      diagnostics.push({
        severity: "blocker",
        code: "binding_stale",
        path: `capabilities.${capability.id}`,
        message: `${capability.id} no longer matches its bound schema.`,
      })
    }
  }
  if (!input.bindingCurrent) {
    diagnostics.push({
      severity: "blocker",
      code: "binding_stale",
      path: "bindings",
      message:
        "Capability bindings changed after this configuration was prepared.",
    })
  }
  if (!input.policyAllowed) {
    diagnostics.push({
      severity: "blocker",
      code: "policy_denied",
      path: "policy",
      message: "Current company policy does not allow this configuration.",
    })
  }
  if (input.requestedModes.includes("live")) {
    diagnostics.push({
      severity: "blocker",
      code: "mode_unavailable",
      path: "modes.live",
      message: "Live mode is not available in Cycle 0.0.5.",
    })
  }
  if (!input.sampleRun?.succeeded || input.sampleRun.evidenceCount < 1) {
    diagnostics.push({
      severity: "blocker",
      code: "sample_run_failed",
      path: "sampleRun",
      message:
        input.sampleRun?.reason ??
        "A successful fixture-backed sample run with evidence is required.",
    })
  }
  for (const warning of input.sampleRun?.warnings ?? []) {
    diagnostics.push({
      severity: "warning",
      code: "sample_run_failed",
      path: "sampleRun.warnings",
      message: warning,
    })
  }
  if (input.promotion.status !== "eligible") {
    diagnostics.push({
      severity: "blocker",
      code:
        input.promotion.status === "unavailable"
          ? "evaluation_unavailable"
          : "evaluation_blocked",
      path: "evaluation",
      message:
        input.promotion.blockers.map((blocker) => blocker.message).join(" ") ||
        "Evaluation requirements are not satisfied.",
    })
  }

  const activationEligible = !diagnostics.some(
    (diagnostic) => diagnostic.severity === "blocker"
  )
  const withoutDigest = {
    companyId: input.companyId,
    agentId: input.agentId,
    agentVersion: input.agentVersion,
    configurationVersion: input.configurationVersion,
    lifecycleVersion: input.lifecycleVersion,
    policyVersion: input.policyVersion,
    bindingVersion: input.bindingVersion,
    status: activationEligible ? ("ready" as const) : ("draft" as const),
    activationEligible,
    diagnostics,
    sampleRun: input.sampleRun,
    checkedAt: checkedAt.toISOString(),
  }
  return { ...withoutDigest, digest: stableHash(withoutDigest) }
}
