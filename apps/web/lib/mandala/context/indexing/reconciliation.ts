import { z } from "zod"
import type { ContextTenantScope } from "@workspace/control-plane"
import type {
  ContextIndexReconciliationClaim,
  ContextIndexRepository,
} from "./repository"

const UUID = z.string().uuid()
const STABLE_CUSTOM_ID = z.string().regex(/^ctx_[0-9a-f]{64}$/)
const INVENTORY_DOCUMENT = z
  .object({
    stableCustomId: STABLE_CUSTOM_ID,
    providerDocumentId: z.string().trim().min(1).max(500),
    status: z.enum(["pending", "processing", "complete", "failed"]),
  })
  .strict()

export type ContextIndexInventoryDocument = {
  readonly stableCustomId: string
  readonly providerDocumentId: string
  readonly status: "pending" | "processing" | "complete" | "failed"
}

export interface ContextIndexInventoryProvider {
  reconciliationStatusBatch(input: {
    readonly requestId: string
    readonly scope: ContextTenantScope
    readonly stableCustomIds: readonly string[]
  }): Promise<readonly ContextIndexInventoryDocument[]>
}

export type ContextIndexReconciliationRunSummary = {
  readonly claimedCount: number
  readonly providerMatchedCount: number
  readonly settledCount: number
  readonly unmatchedCount: number
  readonly providerStatus: "not_called" | "complete" | "failed"
}

export async function runContextIndexReconciliation(input: {
  readonly repository: ContextIndexRepository
  readonly provider: ContextIndexInventoryProvider
  readonly workerId: string
  readonly limit: number
  readonly now: Date
}): Promise<ContextIndexReconciliationRunSummary> {
  const now = input.now.toISOString()
  const claims = await input.repository.claimReconciliation({
    workerId: input.workerId,
    limit: z.number().int().min(1).max(100).parse(input.limit),
    now,
  })
  if (claims.length === 0) {
    return summary(0, 0, 0, 0, "not_called")
  }

  const companyId = UUID.parse(claims[0]!.companyId)
  assertSingleTenantBatch(claims, companyId)

  let providerDocuments: readonly ContextIndexInventoryDocument[]
  try {
    const claimedStableIds = new Set(
      claims.map((claim) => STABLE_CUSTOM_ID.parse(claim.stableCustomId))
    )
    providerDocuments = z
      .array(INVENTORY_DOCUMENT)
      .max(claims.length)
      .parse(
        await input.provider.reconciliationStatusBatch({
          requestId: UUID.parse(claims[0]!.outboxId),
          scope: { companyId, workspaceScopeId: companyId },
          stableCustomIds: [...claimedStableIds],
        })
      )
    if (
      new Set(providerDocuments.map((document) => document.stableCustomId))
        .size !== providerDocuments.length ||
      providerDocuments.some(
        (document) => !claimedStableIds.has(document.stableCustomId)
      )
    ) {
      throw new Error("context_index_reconciliation_inventory_invalid")
    }
  } catch {
    return summary(claims.length, 0, 0, claims.length, "failed")
  }

  const completed = providerDocuments
    .filter((document) => document.status === "complete")
    .map((document) => ({
      stableCustomId: document.stableCustomId,
      providerDocumentId: document.providerDocumentId,
      status: "complete" as const,
    }))
  if (completed.length === 0) {
    return summary(
      claims.length,
      providerDocuments.length,
      0,
      claims.length,
      "complete"
    )
  }

  const confirmation = await input.repository.confirmReconciliation({
    companyId,
    documents: completed,
    now,
  })
  return summary(
    claims.length,
    providerDocuments.length,
    confirmation.settledCount,
    claims.length - confirmation.settledCount,
    "complete"
  )
}

function assertSingleTenantBatch(
  claims: readonly ContextIndexReconciliationClaim[],
  companyId: string
) {
  if (
    claims.length > 100 ||
    new Set(claims.map((claim) => claim.stableCustomId)).size !==
      claims.length ||
    claims.some(
      (claim) =>
        claim.companyId !== companyId || claim.provider !== "supermemory"
    )
  ) {
    throw new Error("context_index_reconciliation_batch_invalid")
  }
}

function summary(
  claimedCount: number,
  providerMatchedCount: number,
  settledCount: number,
  unmatchedCount: number,
  providerStatus: ContextIndexReconciliationRunSummary["providerStatus"]
): ContextIndexReconciliationRunSummary {
  return Object.freeze({
    claimedCount,
    providerMatchedCount,
    settledCount,
    unmatchedCount,
    providerStatus,
  })
}
