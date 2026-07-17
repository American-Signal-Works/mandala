import { describe, expect, it } from "vitest"
import type {
  ContextIndexOutboxEvent,
  ContextIndexProjectionSource,
} from "@workspace/control-plane"
import {
  ContextProjectionError,
  hashContextIndexContent,
  projectContextIndexDocument,
} from "./projector"

const companyId = "20000000-0000-4000-8000-000000000001"
const eventId = "30000000-0000-4000-8000-000000000001"
const policyId = "40000000-0000-4000-8000-000000000001"
const recordId = "50000000-0000-4000-8000-000000000001"
const sourceId = "60000000-0000-4000-8000-000000000001"
const timestamp = "2026-07-17T02:30:00.000Z"
const policyHash = "a".repeat(64)

describe("Context safe-field projector", () => {
  it("projects only approved pointers and validates the persisted content hash", () => {
    const projectedContent = '{"/name": "Acme", "/quantity": 12}'
    const result = projectContextIndexDocument({
      event: event({
        expectedContentHash: hashContextIndexContent(projectedContent),
      }),
      source: source({ projectedContent }),
    })

    expect(result.document.content).toBe(projectedContent)
    expect(result.document.contentHash).toBe(
      hashContextIndexContent(projectedContent)
    )
    expect(result.projectedFieldPaths).toEqual(["/name", "/quantity"])
    expect(result.document.content).not.toContain("ignored")
  })

  it("is deterministic when approved paths arrive in a different order", () => {
    const projectedContent = '{"/name": "Acme", "/quantity": 12}'
    const first = projectContextIndexDocument({
      event: event({
        expectedContentHash: hashContextIndexContent(projectedContent),
      }),
      source: source({ projectedContent }),
    })
    const baseSecondSource = source({ projectedContent })
    const secondSource = {
      ...baseSecondSource,
      policy: {
        ...baseSecondSource.policy,
        approvedFieldPaths: ["/quantity", "/name"],
      },
    }
    const second = projectContextIndexDocument({
      event: event({
        expectedContentHash: hashContextIndexContent(projectedContent),
      }),
      source: secondSource,
    })
    expect(second.document.contentHash).toBe(first.document.contentHash)
    expect(second.projectedFieldPaths).toEqual(first.projectedFieldPaths)
  })

  it("rejects missing approved fields and nested sensitive aliases", () => {
    const missingBase = source({ projectedContent: '{"/name": "Acme"}' })
    const missing = {
      ...missingBase,
      record: { ...missingBase.record, payload: { name: "Acme" } },
    }
    expect(() =>
      projectContextIndexDocument({ event: event(), source: missing })
    ).toThrowError(
      expect.objectContaining<Partial<ContextProjectionError>>({
        code: "approved_field_missing",
      })
    )

    const unsafeBase = source({
      projectedContent: '{"/vendor": {"name": "Acme"}}',
    })
    const unsafe = {
      ...unsafeBase,
      policy: { ...unsafeBase.policy, approvedFieldPaths: ["/vendor"] },
      record: {
        ...unsafeBase.record,
        payload: {
          vendor: { name: "Acme", api_token: "must-not-leak" },
        },
      },
    }
    expect(() =>
      projectContextIndexDocument({ event: event(), source: unsafe })
    ).toThrowError(
      expect.objectContaining<Partial<ContextProjectionError>>({
        code: "approved_field_unsafe",
      })
    )
  })

  it("rejects semantic, hash, stale-policy, and byte-bound mismatches", () => {
    const projectedContent = '{"/name": "Wrong", "/quantity": 12}'
    expect(() =>
      projectContextIndexDocument({
        event: event({
          expectedContentHash: hashContextIndexContent(projectedContent),
        }),
        source: source({ projectedContent }),
      })
    ).toThrowError(
      expect.objectContaining<Partial<ContextProjectionError>>({
        code: "projected_content_hash_mismatch",
      })
    )

    const validContent = '{"/name": "Acme", "/quantity": 12}'
    expect(() =>
      projectContextIndexDocument({
        event: event({ expectedContentHash: "b".repeat(64) }),
        source: source({ projectedContent: validContent }),
      })
    ).toThrowError(
      expect.objectContaining<Partial<ContextProjectionError>>({
        code: "projected_content_hash_mismatch",
      })
    )

    const staleBase = source({ projectedContent: validContent })
    const stale = {
      ...staleBase,
      policy: { ...staleBase.policy, policyVersion: 2 },
    }
    expect(() =>
      projectContextIndexDocument({ event: event(), source: stale })
    ).toThrowError(
      expect.objectContaining<Partial<ContextProjectionError>>({
        code: "projection_policy_stale",
      })
    )

    const oversizedBase = source({ projectedContent: validContent })
    const oversized = {
      ...oversizedBase,
      policy: { ...oversizedBase.policy, maximumContentBytes: 5 },
    }
    expect(() =>
      projectContextIndexDocument({ event: event(), source: oversized })
    ).toThrowError(
      expect.objectContaining<Partial<ContextProjectionError>>({
        code: "projected_content_too_large",
      })
    )
  })
})

function event(
  overrides: Partial<ContextIndexOutboxEvent> = {}
): ContextIndexOutboxEvent {
  return {
    id: eventId,
    companyId,
    provider: "supermemory",
    operation: "add",
    canonicalRecordId: recordId,
    canonicalRecordVersion: "version-1",
    stableCustomId: `ctx_${"c".repeat(64)}`,
    providerDocumentId: null,
    policyVersion: 1,
    policyHash,
    expectedContentHash: hashContextIndexContent(
      '{"/name": "Acme", "/quantity": 12}'
    ),
    attempt: 1,
    maxAttempts: 5,
    ...overrides,
  }
}

function source(
  overrides: Partial<ContextIndexProjectionSource> = {}
): ContextIndexProjectionSource {
  return {
    eventId,
    record: {
      id: recordId,
      companyId,
      sourceId,
      sourceKey: "erpnext",
      recordType: "inventory_item",
      externalId: "ITEM-1",
      canonicalRecordVersion: "version-1",
      payload: { name: "Acme", quantity: 12, ignored: "private" },
      observedAt: timestamp,
    },
    policy: {
      id: policyId,
      companyId,
      sourceKey: "erpnext",
      recordType: "inventory_item",
      policyVersion: 1,
      policyHash,
      approvedFieldPaths: ["/name", "/quantity"],
      maximumContentBytes: 65_536,
      classification: "internal",
      retentionDays: 365,
      projectionVersion: 1,
    },
    projectedContent: '{"/name": "Acme", "/quantity": 12}',
    ...overrides,
  }
}
