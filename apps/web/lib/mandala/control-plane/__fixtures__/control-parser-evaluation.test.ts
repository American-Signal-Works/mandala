import { describe, expect, it } from "vitest"
import {
  controlParserEvaluationCases,
  normalizeParserOutcomeProjection,
  projectControlOutcomeForEvaluation,
} from "./control-parser-evaluation"

const companyId = "20000000-0000-4000-8000-000000000001"

describe("control parser evaluation dataset", () => {
  it("has unique bounded synthetic cases", () => {
    const ids = controlParserEvaluationCases.map((testCase) => testCase.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(
      controlParserEvaluationCases.every(
        (testCase) =>
          testCase.phrase.length > 0 && testCase.phrase.length <= 2_000
      )
    ).toBe(true)
  })

  it("covers every intent and required safety category", () => {
    const resolvedKinds = new Set(
      controlParserEvaluationCases
        .filter((testCase) => testCase.expected.status === "resolved")
        .map((testCase) => testCase.expected.kind)
    )
    expect(resolvedKinds).toEqual(
      new Set([
        "run_fixture",
        "list_work_items",
        "inspect_work_item",
        "record_decision",
        "execute_mock_action",
      ])
    )

    const categories = new Set(
      controlParserEvaluationCases.map((testCase) => testCase.category)
    )
    expect(categories).toEqual(
      new Set([
        "intent",
        "ambiguity",
        "unsupported",
        "injection",
        "multi_action",
        "cross_company",
        "procurement_fixture",
      ])
    )
  })

  it("marks every mutating and unsafe case as safety critical", () => {
    const unsafeCategories = new Set([
      "ambiguity",
      "unsupported",
      "injection",
      "multi_action",
      "cross_company",
    ])
    expect(
      controlParserEvaluationCases.every(
        (testCase) =>
          !unsafeCategories.has(testCase.category) || testCase.safetyCritical
      )
    ).toBe(true)
    expect(
      controlParserEvaluationCases
        .filter((testCase) =>
          ["record_decision", "execute_mock_action"].includes(
            testCase.expected.kind ?? ""
          )
        )
        .every((testCase) => testCase.safetyCritical)
    ).toBe(true)
  })

  it("scores invented filters and edit values as mismatches", () => {
    const listCase = controlParserEvaluationCases.find(
      (testCase) => testCase.id === "list_work"
    )
    const editCase = controlParserEvaluationCases.find(
      (testCase) => testCase.id === "edit_work"
    )
    expect(listCase).toBeDefined()
    expect(editCase).toBeDefined()

    const filteredList = projectControlOutcomeForEvaluation({
      status: "resolved",
      intent: {
        kind: "list_work_items",
        companyId,
        status: "blocked",
        risk: "read",
      },
      confirmationRequired: false,
    })
    const inventedEdit = projectControlOutcomeForEvaluation({
      status: "resolved",
      intent: {
        kind: "record_decision",
        companyId,
        itemId: "30000000-0000-4000-8000-000000000001",
        decision: "edit",
        patches: [{ pointer: "/lines/0/quantity", value: 999 }],
        reason: "the case pack changed",
        warningsAcknowledged: false,
        risk: "state_change",
      },
      confirmationRequired: true,
    })

    expect(filteredList).not.toEqual(
      normalizeParserOutcomeProjection(listCase!.expected)
    )
    expect(inventedEdit).not.toEqual(
      normalizeParserOutcomeProjection(editCase!.expected)
    )
  })
})
