import { describe, expect, it } from "vitest"
import {
  companyPolicyDecisionSchema,
  companyPolicyEvaluationRequestSchema,
  companyPrincipalSchema,
  evaluateCompanyPolicy,
  type CompanyPolicyEvaluationRequest,
  type CompanyPrincipal,
} from "../src/index.js"

const companyId = "20000000-0000-4000-8000-000000000001"
const principalId = "10000000-0000-4000-8000-000000000001"

describe("company policy evaluation", () => {
  it("allows an active human with permission in mock mode", () => {
    expect(evaluateCompanyPolicy(request())).toMatchObject({
      effect: "allow",
      reason: "policy_satisfied",
      policyVersion: "fixed-mvp-v1",
      companyId,
      principalId,
      principalType: "user",
      permission: "workflow.decision.approve",
      mode: "mock",
    })
  })

  it("denies inactive principals before evaluating capabilities", () => {
    expect(
      evaluateCompanyPolicy(
        request({ principal: userPrincipal({ state: "disabled" }) })
      )
    ).toMatchObject({ effect: "deny", reason: "principal_inactive" })
  })

  it("denies roles and non-human principals without the named permission", () => {
    expect(
      evaluateCompanyPolicy(
        request({ principal: userPrincipal({ role: "viewer" }) })
      )
    ).toMatchObject({ effect: "deny", reason: "permission_missing" })

    expect(
      evaluateCompanyPolicy(
        request({ principal: agentPrincipal(), permission: "workflow.run" })
      )
    ).toMatchObject({ effect: "deny", reason: "permission_missing" })
  })

  it("requires human principals for decisions and token issuance", () => {
    for (const permission of [
      "workflow.decision.approve",
      "workflow.decision.edit",
      "workflow.decision.reject",
      "workflow.decision.request_rework",
      "workflow.execution_token.issue",
    ] as const) {
      expect(
        evaluateCompanyPolicy(
          request({
            principal: agentPrincipal({ capabilities: [permission] }),
            permission,
          })
        )
      ).toMatchObject({
        effect: "deny",
        reason: "human_principal_required",
      })
    }
  })

  it("keeps dry-run, shadow, and live modes disabled", () => {
    for (const mode of ["dry_run", "shadow", "live"] as const) {
      expect(evaluateCompanyPolicy(request({ mode }))).toMatchObject({
        effect: "deny",
        reason: "execution_mode_disabled",
      })
    }
  })

  it("returns approval and warning gates as structured decisions", () => {
    expect(
      evaluateCompanyPolicy(
        request({
          approval: approval({ required: true, status: "pending" }),
        })
      )
    ).toMatchObject({
      effect: "requires_approval",
      reason: "human_approval_required",
    })

    expect(
      evaluateCompanyPolicy(
        request({
          approval: approval({
            required: true,
            status: "approved",
          }),
        })
      )
    ).toMatchObject({
      effect: "requires_approval",
      reason: "human_approval_required",
    })

    expect(
      evaluateCompanyPolicy(
        request({
          approval: approval({ required: true, status: "rejected" }),
        })
      )
    ).toMatchObject({ effect: "deny", reason: "approval_rejected" })

    expect(
      evaluateCompanyPolicy(
        request({
          approval: approval({
            warningsPresent: true,
            warningsAcknowledged: false,
          }),
        })
      )
    ).toMatchObject({
      effect: "requires_approval",
      reason: "warning_acknowledgement_required",
    })
  })

  it("does not treat an unverified approved label as authorization", () => {
    const decision = evaluateCompanyPolicy(
      request({
        principal: agentPrincipal({
          capabilities: ["workflow.execution.mock"],
        }),
        permission: "workflow.execution.mock",
        approval: approval({ required: true, status: "approved" }),
      })
    )

    expect(decision).toMatchObject({
      effect: "requires_approval",
      reason: "human_approval_required",
      principalType: "agent",
    })
    expect(companyPolicyDecisionSchema.safeParse(decision).success).toBe(true)
  })

  it("keeps user roles and non-human capabilities mutually exclusive", () => {
    expect(
      companyPrincipalSchema.safeParse(userPrincipal({ role: null })).success
    ).toBe(false)
    expect(
      companyPrincipalSchema.safeParse(agentPrincipal({ role: "approver" }))
        .success
    ).toBe(false)
    expect(
      companyPrincipalSchema.safeParse(
        userPrincipal({ capabilities: ["workflow.read"] })
      ).success
    ).toBe(false)
    expect(
      companyPrincipalSchema.safeParse(
        agentPrincipal({
          capabilities: ["workflow.read", "workflow.read"],
        })
      ).success
    ).toBe(false)
    expect(
      companyPolicyEvaluationRequestSchema.safeParse(request()).success
    ).toBe(true)
  })
})

function request(
  overrides: Partial<CompanyPolicyEvaluationRequest> = {}
): CompanyPolicyEvaluationRequest {
  return {
    policyVersion: "fixed-mvp-v1",
    principal: userPrincipal(),
    permission: "workflow.decision.approve",
    mode: "mock",
    approval: approval(),
    ...overrides,
  }
}

function userPrincipal(
  overrides: Partial<CompanyPrincipal> = {}
): CompanyPrincipal {
  return {
    id: principalId,
    companyId,
    type: "user",
    state: "active",
    role: "approver",
    capabilities: [],
    delegatedByUserId: null,
    ...overrides,
  }
}

function agentPrincipal(
  overrides: Partial<CompanyPrincipal> = {}
): CompanyPrincipal {
  return {
    id: "10000000-0000-4000-8000-000000000002",
    companyId,
    type: "agent",
    state: "active",
    role: null,
    capabilities: [],
    delegatedByUserId: principalId,
    ...overrides,
  }
}

function approval(
  overrides: Partial<CompanyPolicyEvaluationRequest["approval"]> = {}
): CompanyPolicyEvaluationRequest["approval"] {
  return {
    required: false,
    status: "not_required",
    warningsPresent: false,
    warningsAcknowledged: false,
    ...overrides,
  }
}
