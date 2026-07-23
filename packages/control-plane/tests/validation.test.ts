import { describe, expect, it } from "vitest"
import {
  createValidationResult,
  normalizeValidationResult,
  validationResultSchema,
} from "../src/index.js"

describe("validation result contract", () => {
  it("derives legacy message arrays from bounded structured issues", () => {
    expect(
      createValidationResult({
        status: "blocked",
        issues: [
          {
            code: "source_data_stale",
            message: "Source data is stale.",
            kind: "reason",
          },
          {
            code: "sales_spike_acknowledgement_required",
            message: "Recent sales spike requires human acknowledgement.",
            kind: "warning",
          },
        ],
        suppressRecommendation: true,
      })
    ).toEqual({
      status: "blocked",
      issues: [
        {
          code: "source_data_stale",
          message: "Source data is stale.",
          kind: "reason",
        },
        {
          code: "sales_spike_acknowledgement_required",
          message: "Recent sales spike requires human acknowledgement.",
          kind: "warning",
        },
      ],
      reasons: ["Source data is stale."],
      warnings: ["Recent sales spike requires human acknowledgement."],
      suppressRecommendation: true,
    })
  })

  it("keeps a code stable when display wording changes", () => {
    const first = createValidationResult({
      status: "blocked",
      issues: [
        {
          code: "source_data_stale",
          message: "Source data is stale.",
          kind: "reason",
        },
      ],
      suppressRecommendation: true,
    })
    const changed = createValidationResult({
      status: "blocked",
      issues: [
        {
          code: "source_data_stale",
          message: "The source snapshot is too old.",
          kind: "reason",
        },
      ],
      suppressRecommendation: true,
    })

    expect(changed.issues[0]?.code).toBe(first.issues[0]?.code)
    expect(changed.reasons).not.toEqual(first.reasons)
  })

  it("normalizes historical message-only results with safe fallback codes", () => {
    expect(
      normalizeValidationResult({
        status: "warn",
        reasons: [],
        warnings: ["Historical warning."],
        suppressRecommendation: false,
      })
    ).toMatchObject({
      issues: [
        {
          code: "legacy_unclassified_warning",
          message: "Historical warning.",
          kind: "warning",
        },
      ],
      warnings: ["Historical warning."],
    })
  })

  it("keeps duplicate historical messages readable without duplicate issues", () => {
    const result = normalizeValidationResult({
      status: "warn",
      reasons: [],
      warnings: ["Repeated.", "Repeated."],
      suppressRecommendation: false,
    })

    expect(result.warnings).toEqual(["Repeated.", "Repeated."])
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "legacy_unclassified_warning",
      "legacy_unclassified_warning_2",
    ])
  })

  it("rejects independently authored legacy arrays and duplicate identities", () => {
    expect(
      validationResultSchema.safeParse({
        status: "blocked",
        issues: [
          { code: "same", message: "One.", kind: "reason" },
          { code: "same", message: "One.", kind: "reason" },
        ],
        reasons: ["One.", "One."],
        warnings: [],
        suppressRecommendation: true,
      }).success
    ).toBe(false)
    expect(
      validationResultSchema.safeParse({
        status: "blocked",
        issues: [{ code: "stable", message: "One.", kind: "reason" }],
        reasons: ["Different."],
        warnings: [],
        suppressRecommendation: true,
      }).success
    ).toBe(false)
  })

  it("does not copy duplicate issue messages into validation diagnostics", () => {
    const secret = "credential-shaped-secret-value"
    const result = validationResultSchema.safeParse({
      status: "blocked",
      issues: [
        { code: "duplicate", message: secret, kind: "reason" },
        { code: "duplicate", message: secret, kind: "reason" },
      ],
      reasons: [secret, secret],
      warnings: [],
      suppressRecommendation: true,
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected duplicate rejection")
    expect(result.error.message).not.toContain(secret)
  })
})
