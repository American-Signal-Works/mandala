import { describe, expect, it } from "vitest"
import {
  AgentLifecycleError,
  InMemoryAgentLifecycleRepository,
  createAgentLifecycleService,
} from "./lifecycle-service"
import { evaluateAgentReadiness, type AgentReadinessInput } from "./readiness"

describe("agent readiness and lifecycle", () => {
  it("returns all readiness blockers and keeps live unavailable", () => {
    const report = evaluateAgentReadiness(
      readinessInput({
        requestedModes: ["mock", "live"],
        bindingCurrent: false,
        policyAllowed: false,
        sampleRun: null,
        promotion: {
          status: "unavailable",
          evaluationResultId: null,
          blockers: [
            {
              code: "evaluation_missing",
              metric: null,
              message: "Evaluation is missing.",
            },
          ],
        },
      })
    )

    expect(report.activationEligible).toBe(false)
    expect(report.status).toBe("draft")
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "binding_stale",
        "policy_denied",
        "mode_unavailable",
        "sample_run_failed",
        "evaluation_unavailable",
      ])
    )
  })

  it("moves draft to ready to active, then requires readiness again on resume", async () => {
    const repository = new InMemoryAgentLifecycleRepository([record()])
    const service = createAgentLifecycleService({
      repository,
      checkReadiness: async (request) => {
        const current = await repository.load(request)
        return evaluateAgentReadiness(
          readinessInput({ lifecycleVersion: current!.version })
        )
      },
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    })
    const ready = await service.transition(command("mark_ready", 1))
    const active = await service.transition(command("activate", 2))
    const paused = await service.transition(command("pause", 3))
    const resumed = await service.transition(command("resume", 4))

    expect([ready.state, active.state, paused.state, resumed.state]).toEqual([
      "ready",
      "active",
      "paused",
      "active",
    ])
    expect(resumed.version).toBe(5)
    expect(resumed.readinessDigest).toBeTruthy()
  })

  it("requires a reason and rejects stale or invalid transitions", async () => {
    const repository = new InMemoryAgentLifecycleRepository([record()])
    const service = createAgentLifecycleService({
      repository,
      checkReadiness: async () => evaluateAgentReadiness(readinessInput()),
    })

    await expect(
      service.transition({ ...command("mark_ready", 1), reason: "" })
    ).rejects.toMatchObject({ code: "lifecycle_reason_required" })
    await expect(service.transition(command("pause", 1))).rejects.toMatchObject(
      { code: "lifecycle_transition_invalid" }
    )
    await expect(
      service.transition(command("mark_ready", 99))
    ).rejects.toMatchObject({ code: "lifecycle_version_stale" })
  })

  it("uses compare-and-set so concurrent lifecycle commands cannot both win", async () => {
    const repository = new InMemoryAgentLifecycleRepository([record()])
    const service = createAgentLifecycleService({
      repository,
      checkReadiness: async () => evaluateAgentReadiness(readinessInput()),
    })

    const results = await Promise.allSettled([
      service.transition(command("mark_ready", 1)),
      service.transition(command("mark_ready", 1)),
    ])

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )
    expect(rejected?.reason).toBeInstanceOf(AgentLifecycleError)
    expect(rejected?.reason).toMatchObject({ code: "lifecycle_version_stale" })
  })
})

function record() {
  return {
    companyId: "company-1",
    agentId: "agent-1",
    state: "draft" as const,
    version: 1,
    configurationVersion: 1,
    readinessDigest: null,
    reason: null,
    changedBy: "user-1",
    changedAt: "2026-07-14T10:00:00.000Z",
  }
}

function command(
  commandName: "mark_ready" | "activate" | "pause" | "resume",
  expectedVersion: number
) {
  return {
    companyId: "company-1",
    agentId: "agent-1",
    command: commandName,
    expectedVersion,
    expectedConfigurationVersion: 1,
    reason: `Test ${commandName}.`,
    actorId: "user-1",
  }
}

function readinessInput(
  overrides: Partial<AgentReadinessInput> = {}
): AgentReadinessInput {
  return {
    companyId: "company-1",
    agentId: "agent-1",
    agentVersion: "1.0.0",
    configurationVersion: 1,
    lifecycleVersion: 1,
    requestedModes: ["mock"],
    configurationDiagnostics: [],
    capabilities: [
      {
        id: "procurement.purchase-order.create",
        version: "1.0.0",
        granted: true,
        healthy: true,
        schemaCompatible: true,
      },
    ],
    policyAllowed: true,
    policyVersion: 1,
    bindingVersion: 1,
    bindingCurrent: true,
    sampleRun: {
      fixtureId: "fixture-1",
      succeeded: true,
      evidenceCount: 1,
      warnings: [],
      reason: null,
    },
    promotion: {
      status: "eligible",
      evaluationResultId: "evaluation-1",
      blockers: [],
    },
    ...overrides,
  }
}
