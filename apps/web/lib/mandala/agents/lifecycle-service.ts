import type { AgentLifecycleState, AgentReadinessReport } from "./readiness"

export type AgentLifecycleRecord = {
  companyId: string
  agentId: string
  state: AgentLifecycleState
  version: number
  configurationVersion: number
  readinessDigest: string | null
  reason: string | null
  changedBy: string
  changedAt: string
}

export type AgentLifecycleCommand =
  | "mark_ready"
  | "activate"
  | "pause"
  | "resume"
  | "disable"
  | "return_to_draft"

export interface AgentLifecycleRepository {
  load(input: {
    companyId: string
    agentId: string
  }): Promise<AgentLifecycleRecord | null>
  compareAndSet(input: {
    expectedVersion: number
    next: AgentLifecycleRecord
  }): Promise<boolean>
}

export class AgentLifecycleError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "AgentLifecycleError"
  }
}

export function createAgentLifecycleService(input: {
  repository: AgentLifecycleRepository
  checkReadiness: (request: {
    companyId: string
    agentId: string
  }) => Promise<AgentReadinessReport>
  now?: () => Date
}) {
  return {
    async transition(request: {
      companyId: string
      agentId: string
      command: AgentLifecycleCommand
      expectedVersion: number
      expectedConfigurationVersion: number
      reason: string
      actorId: string
    }): Promise<AgentLifecycleRecord> {
      const current = await input.repository.load(request)
      if (!current) {
        throw new AgentLifecycleError("agent_not_found", "Agent was not found.")
      }
      if (current.version !== request.expectedVersion) {
        throw new AgentLifecycleError(
          "lifecycle_version_stale",
          "Agent lifecycle changed; refresh before trying again."
        )
      }
      if (
        current.configurationVersion !== request.expectedConfigurationVersion
      ) {
        throw new AgentLifecycleError(
          "configuration_version_stale",
          "Agent configuration changed; refresh before trying again."
        )
      }
      if (!request.reason.trim()) {
        throw new AgentLifecycleError(
          "lifecycle_reason_required",
          "A reason is required for every lifecycle change."
        )
      }

      const target = targetState(current.state, request.command)
      const readiness = requiresReadiness(request.command)
        ? await input.checkReadiness(request)
        : null
      if (readiness && !readiness.activationEligible) {
        throw new AgentLifecycleError(
          "agent_not_ready",
          readiness.diagnostics
            .filter((diagnostic) => diagnostic.severity === "blocker")
            .map((diagnostic) => diagnostic.message)
            .join(" ") || "Agent is not ready."
        )
      }
      if (
        readiness &&
        (readiness.configurationVersion !== current.configurationVersion ||
          readiness.lifecycleVersion !== current.version)
      ) {
        throw new AgentLifecycleError(
          "readiness_stale",
          "Readiness was calculated from stale agent state."
        )
      }

      const next: AgentLifecycleRecord = {
        ...current,
        state: target,
        version: current.version + 1,
        readinessDigest:
          target === "ready" || target === "active"
            ? (readiness?.digest ?? current.readinessDigest)
            : null,
        reason: request.reason.trim(),
        changedBy: request.actorId,
        changedAt: (input.now?.() ?? new Date()).toISOString(),
      }
      if (
        !(await input.repository.compareAndSet({
          expectedVersion: request.expectedVersion,
          next,
        }))
      ) {
        throw new AgentLifecycleError(
          "lifecycle_version_stale",
          "Agent lifecycle changed; refresh before trying again."
        )
      }
      return next
    },
  }
}

export class InMemoryAgentLifecycleRepository implements AgentLifecycleRepository {
  readonly #records = new Map<string, AgentLifecycleRecord>()

  constructor(records: readonly AgentLifecycleRecord[]) {
    for (const record of records) {
      this.#records.set(keyFor(record), structuredClone(record))
    }
  }

  async load(input: {
    companyId: string
    agentId: string
  }): Promise<AgentLifecycleRecord | null> {
    const record = this.#records.get(keyFor(input))
    return record ? structuredClone(record) : null
  }

  async compareAndSet(input: {
    expectedVersion: number
    next: AgentLifecycleRecord
  }): Promise<boolean> {
    const key = keyFor(input.next)
    const current = this.#records.get(key)
    if (!current || current.version !== input.expectedVersion) return false
    this.#records.set(key, structuredClone(input.next))
    return true
  }
}

function targetState(
  current: AgentLifecycleState,
  command: AgentLifecycleCommand
): AgentLifecycleState {
  const transitions: Partial<
    Record<
      AgentLifecycleState,
      Partial<Record<AgentLifecycleCommand, AgentLifecycleState>>
    >
  > = {
    draft: { mark_ready: "ready", disable: "disabled" },
    ready: {
      activate: "active",
      return_to_draft: "draft",
      disable: "disabled",
    },
    active: { pause: "paused", disable: "disabled" },
    paused: {
      resume: "active",
      return_to_draft: "draft",
      disable: "disabled",
    },
    disabled: {},
  }
  const target = transitions[current]?.[command]
  if (!target) {
    throw new AgentLifecycleError(
      "lifecycle_transition_invalid",
      `Cannot ${command.replaceAll("_", " ")} an agent in ${current}.`
    )
  }
  return target
}

function requiresReadiness(command: AgentLifecycleCommand): boolean {
  return (
    command === "mark_ready" || command === "activate" || command === "resume"
  )
}

function keyFor(input: { companyId: string; agentId: string }): string {
  return `${input.companyId}::${input.agentId}`
}
