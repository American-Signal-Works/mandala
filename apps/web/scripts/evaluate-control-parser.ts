import { createHash } from "node:crypto"
import { Client } from "langsmith"
import { evaluate, type EvaluatorT } from "langsmith/evaluation"
import type { Example, Run } from "langsmith/schemas"
import {
  controlParserEvaluationCases,
  normalizeParserOutcomeProjection,
  projectControlOutcomeForEvaluation,
} from "../lib/mandala/control-plane/__fixtures__/control-parser-evaluation"
import { parseConversationalControlInput } from "../lib/mandala/control-plane/conversational-parser"

const datasetVersion = createHash("sha256")
  .update(JSON.stringify(controlParserEvaluationCases))
  .digest("hex")
  .slice(0, 12)
const datasetName = `mandala-control-parser-synthetic-${datasetVersion}`
const companyId = "20000000-0000-4000-8000-000000000001"
const exactMatchThreshold = 0.9
const safetyThreshold = 1

async function main() {
  requireLiveConfiguration()
  const evaluationCaseByPhrase = new Map(
    controlParserEvaluationCases.map((testCase) => [testCase.phrase, testCase])
  )
  const evaluationCaseById = new Map(
    controlParserEvaluationCases.map((testCase) => [testCase.id, testCase])
  )
  const observedByCaseId = new Map<
    string,
    ReturnType<typeof projectControlOutcomeForEvaluation>
  >()
  const client = new Client({
    hideInputs: () => ({}),
    hideOutputs: () => ({}),
  })
  await ensureDataset(client)

  const results = await evaluate(
    async (inputs: { companyId: string; phrase: string }) => {
      const result = await parseConversationalControlInput({
        companyId: inputs.companyId,
        phrase: inputs.phrase,
      })
      const projection = projectControlOutcomeForEvaluation(result.outcome)
      const testCase = evaluationCaseByPhrase.get(inputs.phrase)
      if (testCase) observedByCaseId.set(testCase.id, projection)
      return projection
    },
    {
      data: datasetName,
      client,
      experimentPrefix: "control-parser",
      description:
        "Synthetic bounded-command regression evaluation for Mandala Slice 2B.",
      maxConcurrency: 2,
      metadata: {
        models: [process.env.MANDALA_CONTROL_PARSER_MODEL ?? "unconfigured"],
        prompts: ["control-intent-v2"],
        tools: [],
      },
      evaluators: [
        createExactMatchEvaluator(observedByCaseId, evaluationCaseById),
        createSafeHandlingEvaluator(observedByCaseId, evaluationCaseById),
      ],
    }
  )

  for await (const row of results) {
    // Exhaust the result stream so LangSmith feedback and traces are flushed.
    void row
  }

  const caseMatches = controlParserEvaluationCases.map((testCase) => ({
    testCase,
    matches:
      JSON.stringify(observedByCaseId.get(testCase.id)) ===
      JSON.stringify(normalizeParserOutcomeProjection(testCase.expected)),
  }))
  const exactMatches = caseMatches.filter(({ matches }) => matches).length
  const exactTotal = caseMatches.length
  const safetyCases = caseMatches.filter(
    ({ testCase }) => testCase.safetyCritical
  )
  const safetyMatches = safetyCases.filter(({ matches }) => matches).length
  const safetyTotal = safetyCases.length

  const exactMatchRate = ratio(exactMatches, exactTotal)
  const safetyRate = ratio(safetyMatches, safetyTotal)
  const passed =
    exactMatchRate >= exactMatchThreshold && safetyRate >= safetyThreshold
  const mismatches = controlParserEvaluationCases.flatMap((testCase) => {
    const actual = observedByCaseId.get(testCase.id)
    const expected = normalizeParserOutcomeProjection(testCase.expected)
    return JSON.stringify(actual) === JSON.stringify(expected)
      ? []
      : [{ id: testCase.id, expected, actual: actual ?? null }]
  })

  console.log(
    JSON.stringify(
      {
        experiment: results.experimentName,
        dataset: datasetName,
        exactMatchRate,
        exactMatchThreshold,
        safetyRate,
        safetyThreshold,
        passed,
        mismatches,
      },
      null,
      2
    )
  )
  if (!passed) process.exitCode = 1
}

async function ensureDataset(client: Client): Promise<void> {
  if (await client.hasDataset({ datasetName })) return
  const dataset = await client.createDataset(datasetName, {
    description:
      "Content-addressed synthetic phrases for bounded Mandala control-intent parsing.",
    metadata: {
      parserSchemaVersion: "control-intent-v2",
      fixtureDigest: datasetVersion,
    },
  })
  await client.createExamples(
    controlParserEvaluationCases.map((testCase) => ({
      dataset_id: dataset.id,
      inputs: { companyId, phrase: testCase.phrase },
      outputs: normalizeParserOutcomeProjection(testCase.expected),
      metadata: {
        caseId: testCase.id,
        category: testCase.category,
        safetyCritical: testCase.safetyCritical,
      },
    }))
  )
}

function requireLiveConfiguration(): void {
  const missing: string[] = []
  if (!process.env.MANDALA_CONTROL_PARSER_MODEL)
    missing.push("MANDALA_CONTROL_PARSER_MODEL")
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN)
    missing.push("AI_GATEWAY_API_KEY_OR_VERCEL_OIDC_TOKEN")
  if (!process.env.LANGSMITH_API_KEY) missing.push("LANGSMITH_API_KEY")
  if (!process.env.LANGSMITH_PROJECT) missing.push("LANGSMITH_PROJECT")
  if (process.env.MANDALA_CONVERSATIONAL_PARSER_ENABLED !== "true") {
    missing.push("MANDALA_CONVERSATIONAL_PARSER_ENABLED")
  }
  if (
    process.env.LANGSMITH_TRACING !== "true" ||
    process.env.LANGSMITH_HIDE_INPUTS !== "true" ||
    process.env.LANGSMITH_HIDE_OUTPUTS !== "true"
  ) {
    missing.push("LANGSMITH_PRIVACY_CONFIGURATION")
  }
  if (missing.length) {
    throw new Error(
      `Live parser evaluation is not configured: ${missing.join(", ")}`
    )
  }
}

type EvaluatorInput = {
  run: Run
  example: Example
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  referenceOutputs?: Record<string, unknown>
}

function createExactMatchEvaluator(
  observedByCaseId: Map<
    string,
    ReturnType<typeof projectControlOutcomeForEvaluation>
  >,
  evaluationCaseById: Map<
    string,
    (typeof controlParserEvaluationCases)[number]
  >
): EvaluatorT {
  return ({ example }: EvaluatorInput) => ({
    key: "exact_match",
    score: matchesExpected(example, observedByCaseId, evaluationCaseById),
  })
}

function createSafeHandlingEvaluator(
  observedByCaseId: Map<
    string,
    ReturnType<typeof projectControlOutcomeForEvaluation>
  >,
  evaluationCaseById: Map<
    string,
    (typeof controlParserEvaluationCases)[number]
  >
): EvaluatorT {
  return ({ example }: EvaluatorInput) => {
    const testCase = getEvaluationCase(example, evaluationCaseById)
    return {
      key: "safe_handling",
      score:
        testCase?.safetyCritical !== true ||
        matchesExpected(example, observedByCaseId, evaluationCaseById),
    }
  }
}

function matchesExpected(
  example: Example,
  observedByCaseId: Map<
    string,
    ReturnType<typeof projectControlOutcomeForEvaluation>
  >,
  evaluationCaseById: Map<
    string,
    (typeof controlParserEvaluationCases)[number]
  >
): boolean {
  const testCase = getEvaluationCase(example, evaluationCaseById)
  if (!testCase) return false
  const actual = observedByCaseId.get(testCase.id)
  return (
    actual !== undefined &&
    JSON.stringify(actual) ===
      JSON.stringify(normalizeParserOutcomeProjection(testCase.expected))
  )
}

function getEvaluationCase(
  example: Example,
  evaluationCaseById: Map<
    string,
    (typeof controlParserEvaluationCases)[number]
  >
) {
  const caseId = example.metadata?.caseId
  return typeof caseId === "string" ? evaluationCaseById.get(caseId) : undefined
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Control parser evaluation failed."
  )
  process.exitCode = 1
})
