import { z } from "zod"
import { workItemActionSchema } from "./schemas.js"

const nullableTimestampSchema = z.string().datetime({ offset: true }).nullable()
const nonnegativeNumberSchema = z.number().finite().nonnegative()

export const sandboxSessionRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    candidateLimit: z.number().int().min(1).max(100).default(25),
  })
  .strict()

export const sandboxSourceSchema = z
  .object({
    id: z.string().uuid(),
    key: z.string().min(1).max(200),
    kind: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    syncStatus: z.enum(["idle", "syncing", "error"]),
    lastSyncedAt: nullableTimestampSchema,
    recordCount: z.number().int().nonnegative(),
    freshestRecordAt: nullableTimestampSchema,
    stale: z.boolean(),
  })
  .strict()

export const sandboxCandidateSchema = z
  .object({
    sku: z.string().min(1).max(500),
    productName: z.string().max(1_000).nullable(),
    inventory: z
      .object({
        onHand: nonnegativeNumberSchema,
        allocated: nonnegativeNumberSchema,
        available: z.number().finite(),
        backorder: nonnegativeNumberSchema,
        reorderLevel: nonnegativeNumberSchema,
        reorderAmount: nonnegativeNumberSchema,
        pulledAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    recentSalesUnits: nonnegativeNumberSchema,
    openPurchaseOrders: z
      .object({
        count: z.number().int().nonnegative(),
        units: nonnegativeNumberSchema,
      })
      .strict(),
    vendor: z
      .object({
        name: z.string().min(1).max(500),
        vendorSku: z.string().max(500).nullable(),
        unitCost: nonnegativeNumberSchema.nullable(),
        mappingConfidence: z.number().min(0).max(1).nullable(),
        mappingConfirmed: z.boolean(),
      })
      .strict()
      .nullable(),
    trello: z
      .object({
        openCardCount: z.number().int().nonnegative(),
        currentList: z.string().max(500).nullable(),
      })
      .strict(),
    recommendation: z
      .object({
        status: z.enum(["ready_for_review", "blocked", "no_action"]),
        quantity: nonnegativeNumberSchema,
        reasons: z.array(z.string().min(1).max(1_000)).max(10),
        warnings: z.array(z.string().min(1).max(1_000)).max(10),
      })
      .strict(),
    sources: z.array(z.string().min(1).max(100)).min(1).max(10),
  })
  .strict()

export const sandboxWorkspaceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("sandbox"),
    ephemeral: z.literal(true),
    companyId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    dataAnchorAt: z.string().date().nullable(),
    recordCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    sources: z.array(sandboxSourceSchema).max(100),
    candidates: z.array(sandboxCandidateSchema).max(100),
  })
  .strict()

export const sandboxReviewCandidateSchema = sandboxCandidateSchema.extend({
  availableActions: z.array(workItemActionSchema).max(6),
})

export const sandboxSessionResponseSchema =
  sandboxWorkspaceSnapshotSchema.extend({
    sessionId: z.string().uuid(),
    candidates: z.array(sandboxReviewCandidateSchema).max(100),
  })

export type SandboxSessionRequest = z.infer<typeof sandboxSessionRequestSchema>
export type SandboxSource = z.infer<typeof sandboxSourceSchema>
export type SandboxCandidate = z.infer<typeof sandboxCandidateSchema>
export type SandboxReviewCandidate = z.infer<
  typeof sandboxReviewCandidateSchema
>
export type SandboxWorkspaceSnapshot = z.infer<
  typeof sandboxWorkspaceSnapshotSchema
>
export type SandboxSessionResponse = z.infer<
  typeof sandboxSessionResponseSchema
>
