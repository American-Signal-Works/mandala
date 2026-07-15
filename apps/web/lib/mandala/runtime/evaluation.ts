import { stableHash } from "../actions"

export const recommendationOutcomeLabels = [
  "accepted",
  "edited",
  "rejected",
  "rework_requested",
  "failed",
  "stale",
  "unsafe",
] as const

export type RecommendationOutcomeLabel =
  (typeof recommendationOutcomeLabels)[number]

export type EvaluationFixture = {
  id: string
  version: number
  companyId: string
  agentKey: string
  agentVersion: string
  input: Record<string, unknown> | null
  expected: Record<string, unknown> | null
  unavailableReason: string | null
  sourceDigest: string
}

export type EvaluationMetric = {
  key: string
  value: number | null
  available: boolean
  reason: string | null
}

export type EvaluationCaseResult = {
  fixtureId: string
  fixtureVersion: number
  status: "passed" | "failed" | "unavailable"
  metrics: EvaluationMetric[]
  safeOutput: Record<string, unknown> | null
  traceId: string | null
  reason: string | null
}

export type EvaluationRunResult = {
  id: string
  companyId: string
  agentKey: string
  agentVersion: string
  fixtureSetVersion: number
  evaluatorVersion: string
  fixtureSetDigest: string
  status: "passed" | "failed" | "unavailable"
  cases: EvaluationCaseResult[]
  startedAt: string
  completedAt: string
}

export type EvaluationCaseExecutor = (input: {
  fixture: Readonly<EvaluationFixture>
  evaluatorVersion: string
}) => Promise<{
  passed: boolean
  metrics: EvaluationMetric[]
  safeOutput: Record<string, unknown>
  traceId?: string | null
}>

export interface EvaluationResultStore {
  save(result: EvaluationRunResult): Promise<void>
  latest(input: {
    companyId: string
    agentKey: string
    agentVersion: string
    fixtureSetVersion: number
    evaluatorVersion: string
  }): Promise<EvaluationRunResult | null>
}

export class InMemoryEvaluationResultStore implements EvaluationResultStore {
  readonly #results: EvaluationRunResult[] = []

  async save(result: EvaluationRunResult): Promise<void> {
    this.#results.push(structuredClone(result))
  }

  async latest(input: {
    companyId: string
    agentKey: string
    agentVersion: string
    fixtureSetVersion: number
    evaluatorVersion: string
  }): Promise<EvaluationRunResult | null> {
    const result = this.#results
      .filter(
        (candidate) =>
          candidate.companyId === input.companyId &&
          candidate.agentKey === input.agentKey &&
          candidate.agentVersion === input.agentVersion &&
          candidate.fixtureSetVersion === input.fixtureSetVersion &&
          candidate.evaluatorVersion === input.evaluatorVersion
      )
      .at(-1)
    return result ? structuredClone(result) : null
  }
}

export async function runEvaluationSuite(input: {
  id: string
  fixtures: readonly EvaluationFixture[]
  fixtureSetVersion: number
  evaluatorVersion: string
  execute: EvaluationCaseExecutor
  store: EvaluationResultStore
  now?: () => Date
}): Promise<EvaluationRunResult> {
  if (input.fixtures.length === 0) {
    throw new Error("An evaluation suite requires at least one fixture.")
  }
  const [first] = input.fixtures
  if (
    input.fixtures.some(
      (fixture) =>
        fixture.companyId !== first!.companyId ||
        fixture.agentKey !== first!.agentKey ||
        fixture.agentVersion !== first!.agentVersion
    )
  ) {
    throw new Error("Evaluation fixtures must target one exact agent version.")
  }
  const duplicate = input.fixtures.find(
    (fixture, index) =>
      input.fixtures.findIndex(
        (candidate) =>
          candidate.id === fixture.id && candidate.version === fixture.version
      ) !== index
  )
  if (duplicate) throw new Error("Evaluation fixture versions must be unique.")

  const now = input.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const cases: EvaluationCaseResult[] = []
  for (const fixture of [...input.fixtures].sort((left, right) =>
    `${left.id}:${left.version}`.localeCompare(`${right.id}:${right.version}`)
  )) {
    if (fixture.input === null || fixture.expected === null) {
      cases.push({
        fixtureId: fixture.id,
        fixtureVersion: fixture.version,
        status: "unavailable",
        metrics: [],
        safeOutput: null,
        traceId: null,
        reason: fixture.unavailableReason ?? "Evaluation data is unavailable.",
      })
      continue
    }
    const evaluated = await input.execute({
      fixture,
      evaluatorVersion: input.evaluatorVersion,
    })
    const metrics = evaluated.metrics.map(validateMetric)
    const unavailable = metrics.some((metric) => !metric.available)
    cases.push({
      fixtureId: fixture.id,
      fixtureVersion: fixture.version,
      status: unavailable
        ? "unavailable"
        : evaluated.passed
          ? "passed"
          : "failed",
      metrics,
      safeOutput: structuredClone(evaluated.safeOutput),
      traceId: evaluated.traceId ?? null,
      reason: unavailable
        ? (metrics.find((metric) => !metric.available)?.reason ??
          "A required metric is unavailable.")
        : null,
    })
  }

  const result: EvaluationRunResult = {
    id: input.id,
    companyId: first!.companyId,
    agentKey: first!.agentKey,
    agentVersion: first!.agentVersion,
    fixtureSetVersion: input.fixtureSetVersion,
    evaluatorVersion: input.evaluatorVersion,
    fixtureSetDigest: stableHash(
      [...input.fixtures]
        .sort((left, right) =>
          `${left.id}:${left.version}`.localeCompare(
            `${right.id}:${right.version}`
          )
        )
        .map(({ input: fixtureInput, expected, ...metadata }) => ({
          ...metadata,
          inputDigest: stableHash(fixtureInput),
          expectedDigest: stableHash(expected),
        }))
    ),
    status: cases.some((resultCase) => resultCase.status === "unavailable")
      ? "unavailable"
      : cases.every((resultCase) => resultCase.status === "passed")
        ? "passed"
        : "failed",
    cases,
    startedAt,
    completedAt: now().toISOString(),
  }
  await input.store.save(result)
  return result
}

export type PromotionThreshold = {
  metric: string
  minimum: number
  required: boolean
}

export type PromotionDecision = {
  status: "eligible" | "blocked" | "unavailable"
  evaluationResultId: string | null
  blockers: Array<{
    code: "evaluation_missing" | "evaluation_unavailable" | "threshold_failed"
    metric: string | null
    message: string
  }>
}

export async function evaluatePromotion(input: {
  store: EvaluationResultStore
  companyId: string
  agentKey: string
  agentVersion: string
  fixtureSetVersion: number
  evaluatorVersion: string
  thresholds: readonly PromotionThreshold[]
}): Promise<PromotionDecision> {
  const result = await input.store.latest(input)
  if (!result) {
    return {
      status: "unavailable",
      evaluationResultId: null,
      blockers: [
        {
          code: "evaluation_missing",
          metric: null,
          message: "No evaluation exists for the required versions.",
        },
      ],
    }
  }
  if (result.status === "unavailable") {
    return {
      status: "unavailable",
      evaluationResultId: result.id,
      blockers: [
        {
          code: "evaluation_unavailable",
          metric: null,
          message: "Required evaluation evidence is unavailable.",
        },
      ],
    }
  }
  const blockers = input.thresholds.flatMap((threshold) => {
    const values = result.cases
      .flatMap((resultCase) => resultCase.metrics)
      .filter(
        (metric) =>
          metric.key === threshold.metric &&
          metric.available &&
          metric.value !== null
      )
      .map((metric) => metric.value!)
    if (!threshold.required && values.length === 0) return []
    const value = values.length
      ? values.reduce((sum, entry) => sum + entry, 0) / values.length
      : null
    return value !== null && value >= threshold.minimum
      ? []
      : [
          {
            code: "threshold_failed" as const,
            metric: threshold.metric,
            message: `Metric ${threshold.metric} did not meet ${threshold.minimum}.`,
          },
        ]
  })
  return {
    status: blockers.length === 0 ? "eligible" : "blocked",
    evaluationResultId: result.id,
    blockers,
  }
}

function validateMetric(metric: EvaluationMetric): EvaluationMetric {
  if (
    metric.available &&
    (metric.value === null ||
      !Number.isFinite(metric.value) ||
      metric.value < 0 ||
      metric.value > 1)
  ) {
    throw new Error(`Evaluation metric ${metric.key} must be between 0 and 1.`)
  }
  if (!metric.available && !metric.reason) {
    throw new Error(`Unavailable metric ${metric.key} requires a reason.`)
  }
  return structuredClone(metric)
}
