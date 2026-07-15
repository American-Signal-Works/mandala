import { describe, expect, it } from "vitest"
import {
  InMemoryEvaluationResultStore,
  evaluatePromotion,
  runEvaluationSuite,
  type EvaluationFixture,
} from "./evaluation"

describe("versioned agent evaluations", () => {
  it("produces reproducible, version-bound results and passes thresholds", async () => {
    const store = new InMemoryEvaluationResultStore()
    const execute = async () => ({
      passed: true,
      metrics: [
        { key: "safety", value: 1, available: true, reason: null },
        { key: "accuracy", value: 0.9, available: true, reason: null },
      ],
      safeOutput: { outcome: "review" },
      traceId: "trace-safe-1",
    })
    const first = await runEvaluationSuite({
      id: "evaluation-1",
      fixtures: [fixture()],
      fixtureSetVersion: 3,
      evaluatorVersion: "2.0.0",
      execute,
      store,
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    })
    const second = await runEvaluationSuite({
      id: "evaluation-2",
      fixtures: [fixture()],
      fixtureSetVersion: 3,
      evaluatorVersion: "2.0.0",
      execute,
      store,
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    })

    expect(first.fixtureSetDigest).toBe(second.fixtureSetDigest)
    expect(first.status).toBe("passed")
    const promotion = await evaluatePromotion({
      store,
      companyId: "company-1",
      agentKey: "procurement-agent",
      agentVersion: "1.2.0",
      fixtureSetVersion: 3,
      evaluatorVersion: "2.0.0",
      thresholds: [
        { metric: "safety", minimum: 1, required: true },
        { metric: "accuracy", minimum: 0.85, required: true },
      ],
    })
    expect(promotion).toMatchObject({
      status: "eligible",
      evaluationResultId: "evaluation-2",
      blockers: [],
    })
  })

  it("represents missing data explicitly and blocks promotion", async () => {
    const store = new InMemoryEvaluationResultStore()
    const result = await runEvaluationSuite({
      id: "evaluation-unavailable",
      fixtures: [
        fixture({
          input: null,
          expected: null,
          unavailableReason: "Source fixture was revoked.",
        }),
      ],
      fixtureSetVersion: 3,
      evaluatorVersion: "2.0.0",
      execute: async () => {
        throw new Error("should not run")
      },
      store,
    })
    expect(result).toMatchObject({
      status: "unavailable",
      cases: [{ status: "unavailable", reason: "Source fixture was revoked." }],
    })
    await expect(
      evaluatePromotion({
        store,
        companyId: "company-1",
        agentKey: "procurement-agent",
        agentVersion: "1.2.0",
        fixtureSetVersion: 3,
        evaluatorVersion: "2.0.0",
        thresholds: [{ metric: "safety", minimum: 1, required: true }],
      })
    ).resolves.toMatchObject({ status: "unavailable" })
  })

  it("does not use a result from another evaluator version", async () => {
    const store = new InMemoryEvaluationResultStore()
    const promotion = await evaluatePromotion({
      store,
      companyId: "company-1",
      agentKey: "procurement-agent",
      agentVersion: "1.2.0",
      fixtureSetVersion: 3,
      evaluatorVersion: "3.0.0",
      thresholds: [],
    })
    expect(promotion).toMatchObject({
      status: "unavailable",
      blockers: [{ code: "evaluation_missing" }],
    })
  })
})

function fixture(
  overrides: Partial<EvaluationFixture> = {}
): EvaluationFixture {
  return {
    id: "safe-reorder",
    version: 2,
    companyId: "company-1",
    agentKey: "procurement-agent",
    agentVersion: "1.2.0",
    input: { sku: "SKU-1" },
    expected: { disposition: "review" },
    unavailableReason: null,
    sourceDigest: "source-1",
    ...overrides,
  }
}
