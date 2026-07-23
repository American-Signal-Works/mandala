import { describe, expect, it } from "vitest"
import { createValidationResult } from "@workspace/control-plane"
import type { SkillRule } from "../skills/schema"
import { applyDeterministicRules, readRuntimePath } from "./primitives"

describe("deterministic runtime primitives", () => {
  it("executes the approved primitive set in order and records its work", () => {
    const rules: SkillRule[] = [
      {
        id: "required_inventory",
        operation: "required_fields",
        source: "data.inventory",
        fields: ["quantity", "target", "pack", "minimum"],
      },
      {
        id: "eligible_rows",
        operation: "filter",
        source: "data.rows",
        all: [
          {
            left: { path: "context.item.active" },
            operator: "eq",
            right: { value: true },
          },
        ],
        output: "rules.eligible",
      },
      {
        id: "eligible_total",
        operation: "aggregate",
        source: "rules.eligible",
        function: "sum",
        field: "value",
        output: "rules.total",
      },
      {
        id: "fresh",
        operation: "freshness",
        age_hours: { path: "data.inventory.ageHours" },
        maximum_hours: 24,
        output: "rules.fresh",
      },
      {
        id: "not_covered",
        operation: "duplicate_check",
        quantity: { path: "data.inventory.openOrderQuantity" },
        allowed_maximum: 0,
        output: "rules.notCovered",
      },
      {
        id: "below_target",
        operation: "threshold",
        value: { path: "data.inventory.quantity" },
        operator: "lt",
        threshold: 10,
        output: "rules.belowTarget",
      },
      {
        id: "needed",
        operation: "formula",
        expression: {
          operator: "subtract",
          operands: [
            { path: "data.inventory.target" },
            { path: "data.inventory.quantity" },
          ],
        },
        output: "rules.needed",
        precision: 2,
      },
      {
        id: "order_quantity",
        operation: "round_to_pack",
        quantity: { path: "rules.needed" },
        pack_size: { path: "data.inventory.pack" },
        minimum: { path: "data.inventory.minimum" },
        output: "rules.orderQuantity",
      },
      {
        id: "priority",
        operation: "priority",
        bands: [
          {
            when: {
              left: { path: "rules.belowTarget" },
              operator: "eq",
              right: { value: true },
            },
            value: 80,
          },
        ],
        default: 50,
        output: "rules.priority",
      },
    ]

    const result = applyDeterministicRules({
      rules,
      context: {
        trigger: { id: "manual" },
        data: {
          inventory: {
            quantity: 2,
            target: 21,
            pack: 6,
            minimum: 12,
            ageHours: 3,
            openOrderQuantity: 0,
          },
          rows: [
            { active: true, value: 3 },
            { active: false, value: 100 },
            { active: true, value: 5 },
          ],
        },
        agent: {},
        rules: {},
        context: {},
      },
    })

    expect(result.ok).toBe(true)
    expect(readRuntimePath(result.context, "rules.total")).toBe(8)
    expect(readRuntimePath(result.context, "rules.fresh")).toBe(true)
    expect(readRuntimePath(result.context, "rules.notCovered")).toBe(true)
    expect(readRuntimePath(result.context, "rules.needed")).toBe(19)
    expect(readRuntimePath(result.context, "rules.orderQuantity")).toBe(24)
    expect(readRuntimePath(result.context, "rules.priority")).toBe(80)
    expect(result.traces).toHaveLength(rules.length)
    expect(result.traces.every((trace) => trace.ok)).toBe(true)
  })

  it("fails closed on unsafe math and unsafe paths", () => {
    const result = applyDeterministicRules({
      rules: [
        {
          id: "unsafe_division",
          operation: "formula",
          expression: {
            operator: "divide",
            operands: [{ value: 10 }, { value: 0 }],
          },
          output: "rules.answer",
        },
      ],
      context: {
        trigger: {},
        data: {},
        agent: {},
        rules: {},
        context: {},
      },
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(" ")).toContain("divide by zero")
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "rule:unsafe_division:division_by_zero",
        kind: "reason",
      }),
    ])
    expect(() =>
      readRuntimePath(
        { trigger: {}, data: {}, agent: {}, rules: {}, context: {} },
        "rules.__proto__.polluted"
      )
    ).toThrow("Unsafe runtime path")
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it("uses rule identity for warnings instead of deriving codes from wording", () => {
    const result = applyDeterministicRules({
      rules: [
        {
          id: "inventory_review",
          operation: "threshold",
          value: { path: "data.quantity" },
          operator: "lt",
          threshold: 10,
          output: "rules.review",
          outcome: {
            when: "true",
            effect: "warn",
            message: "Inventory needs review.",
          },
        },
      ],
      context: {
        trigger: {},
        data: { quantity: 2 },
        agent: {},
        rules: {},
        context: {},
      },
    })

    expect(result.issues).toEqual([
      {
        code: "rule:inventory_review",
        message: "Inventory needs review.",
        kind: "warning",
      },
    ])
  })

  it("keeps maximum-length rule identity inside the validation code bound", () => {
    const ruleId = `r${"a".repeat(199)}`
    const result = applyDeterministicRules({
      rules: [
        {
          id: ruleId,
          operation: "threshold",
          value: { value: 1 },
          operator: "lt",
          threshold: 2,
          output: "rules.boundary",
          outcome: {
            when: "true",
            effect: "warn",
            message: "Boundary warning.",
          },
        },
      ],
      context: {
        trigger: {},
        data: {},
        agent: {},
        rules: {},
        context: {},
      },
    })

    expect(result.issues[0]?.code).toBe(ruleId)
    expect(result.issues[0]?.code).toHaveLength(200)
    expect(() =>
      createValidationResult({
        status: "warn",
        issues: result.issues,
        suppressRecommendation: false,
      })
    ).not.toThrow()
  })
})
