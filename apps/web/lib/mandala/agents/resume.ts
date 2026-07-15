import type { WorkflowClientSurface, WorkflowSupabaseClient } from "../workflows"
import {
  getAgentRuntimeState,
  transitionAgentWorkflowLifecycle,
  type AgentRuntimeState,
} from "../skills/lifecycle"
import { recordAgentTestReadiness } from "./readiness-persistence"
import { runSyntheticAgentTest } from "./test-run"

type ResumeDependencies = {
  getRuntimeState?: typeof getAgentRuntimeState
  runSandbox?: typeof runSyntheticAgentTest
  recordReadiness?: typeof recordAgentTestReadiness
  transitionLifecycle?: typeof transitionAgentWorkflowLifecycle
}

export async function refreshReadinessAndResumeAgent(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
  expectedVersion: number
  reason: string
  actorUserId: string
  clientSurface: WorkflowClientSurface
  dependencies?: ResumeDependencies
}) {
  const dependencies = input.dependencies ?? {}
  const getRuntimeState = dependencies.getRuntimeState ?? getAgentRuntimeState
  const runSandbox = dependencies.runSandbox ?? runSyntheticAgentTest
  const recordReadiness =
    dependencies.recordReadiness ?? recordAgentTestReadiness
  const transitionLifecycle =
    dependencies.transitionLifecycle ?? transitionAgentWorkflowLifecycle
  const stateInput = {
    supabase: input.supabase,
    companyId: input.companyId,
    agentId: input.agentId,
  }

  const before = await getRuntimeState(stateInput)
  assertResumeStartingState(before, input.expectedVersion)

  const result = await runSandbox({
    supabase: input.supabase,
    agentId: input.agentId,
    request: { companyId: input.companyId },
    actorUserId: input.actorUserId,
    clientSurface: input.clientSurface,
  })
  await recordReadiness({ ...stateInput, result })

  const refreshed = await getRuntimeState(stateInput)
  if (
    refreshed.lifecycleState !== "paused" ||
    refreshed.stateVersion <= before.stateVersion
  ) {
    throw new Error("stale_agent_state")
  }

  return transitionLifecycle({
    ...stateInput,
    transition: "resume",
    expectedVersion: refreshed.stateVersion,
    reason: input.reason,
  })
}

function assertResumeStartingState(
  state: AgentRuntimeState,
  expectedVersion: number
) {
  if (state.stateVersion !== expectedVersion) {
    throw new Error("stale_agent_state")
  }
  if (state.lifecycleState !== "paused") {
    throw new Error("lifecycle_transition_not_allowed")
  }
}
