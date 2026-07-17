import { z } from "zod"
import {
  contextIndexCompletionOutcomeSchema,
  contextIndexFailureStateSchema,
  contextIndexLeaseSchema,
  contextIndexPreparationSummarySchema,
  contextIndexProjectionSourceSchema,
  contextIndexReconciliationSummarySchema,
  contextIndexReconciliationRequestSchema,
  type ContextIndexCompletionOutcome,
  type ContextIndexFailureDisposition,
  type ContextIndexLease,
  type ContextIndexReconciliationMode,
} from "@workspace/control-plane"
import {
  ContextIndexRepositoryError,
  type ContextIndexRepository,
} from "./repository"

export const contextIndexRpcNames = {
  prepare: "prepare_context_index_work_v1",
  claim: "claim_context_index_work_v1",
  complete: "complete_context_index_work_v1",
  fail: "fail_context_index_work_v1",
  reconcile: "reconcile_context_index_work_v1",
} as const

export interface ContextIndexRpcExecutor {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>
  ): PromiseLike<{
    data: unknown
    error: { message?: string; code?: string } | null
  }>
}

const safeHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const prepareRequestSchema = z
  .object({
    now: z.string().datetime({ offset: true }),
    limit: z.number().int().min(1).max(1_000),
  })
  .strict()
const claimRequestSchema = z
  .object({
    workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/),
    limit: z.number().int().min(1).max(100),
    leaseSeconds: z.number().int().min(15).max(900),
    now: z.string().datetime({ offset: true }),
  })
  .strict()
const failureRequestSchema = z
  .object({
    workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/),
    leaseId: z.string().uuid(),
    disposition: z.enum(["retry", "terminal", "reconciliation_required"]),
    errorCode: z.string().regex(/^[a-z0-9_]{1,64}$/),
    now: z.string().datetime({ offset: true }),
  })
  .strict()
const claimSchema = z
  .object({
    outboxId: z.string().uuid(),
    leaseId: z.string().uuid(),
    leaseExpiresAt: z.string().datetime({ offset: true }),
    companyId: z.string().uuid(),
    provider: z.literal("supermemory"),
    operation: z.enum(["add", "replace", "delete"]),
    canonicalRecordId: z.string().uuid(),
    canonicalVersion: z.string().trim().min(1).max(200),
    policyId: z.string().uuid(),
    policyVersion: z.number().int().positive(),
    policyHash: safeHashSchema,
    contentHash: safeHashSchema,
    stableCustomId: z.string().trim().min(1).max(500),
    providerDocumentId: z.string().trim().min(1).max(500).nullable(),
    sourceKey: z.string().trim().min(1).max(150),
    recordType: z.string().trim().min(1).max(150),
    sourceId: z.string().uuid().nullable(),
    externalId: z.string().trim().min(1).max(500).nullable(),
    observedAt: z.string().datetime({ offset: true }).nullable(),
    approvedFieldPaths: z.array(z.string()).min(1).max(100),
    maximumContentBytes: z.number().int().min(1).max(1_048_576),
    classification: z.enum(["internal", "confidential"]),
    retentionDays: z.number().int().min(1).max(3_650),
    projectionVersion: z.number().int().positive(),
    canonicalPayload: z.record(z.string(), z.unknown()).nullable(),
    projectedContent: z.string().min(2).max(1_048_576).nullable(),
    attempt: z.number().int().positive().max(20),
    maxAttempts: z.number().int().positive().max(20),
  })
  .strict()
  .superRefine((claim, context) => {
    const isDelete = claim.operation === "delete"
    const projectionValues = [
      claim.sourceId,
      claim.externalId,
      claim.observedAt,
      claim.canonicalPayload,
      claim.projectedContent,
    ]
    if (isDelete && projectionValues.some((value) => value !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canonicalPayload"],
        message: "Delete claims cannot contain canonical projection data.",
      })
    }
    if (!isDelete && projectionValues.some((value) => value === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canonicalPayload"],
        message: "Add and replace claims require canonical projection data.",
      })
    }
  })

const claimEnvelopeSchema = z
  .object({ claims: z.array(claimSchema).max(100) })
  .strict()
const preparationResultSchema = z
  .object({
    recoveredCount: z.number().int().nonnegative(),
    deadLetteredCount: z.number().int().nonnegative(),
  })
  .strict()
const completeResultSchema = z
  .object({
    outboxId: z.string().uuid(),
    status: z.literal("completed"),
    operation: z.enum(["add", "replace", "delete"]),
    deletionConfirmed: z.boolean(),
  })
  .strict()
const failureResultSchema = z
  .object({
    outboxId: z.string().uuid(),
    status: z.enum(["retry", "dead_letter", "needs_reconciliation"]),
    availableAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()

export class SupabaseContextIndexRepository implements ContextIndexRepository {
  constructor(private readonly executor: ContextIndexRpcExecutor) {}

  async prepare(input: { now: string; limit: number }) {
    const request = prepareRequestSchema.parse(input)
    const data = await this.call(contextIndexRpcNames.prepare, {
      p_now: request.now,
      p_limit: request.limit,
    })
    try {
      const result = preparationResultSchema.parse(data)
      return contextIndexPreparationSummarySchema.parse({
        ...result,
        preparedAt: request.now,
      })
    } catch (error) {
      throw invalidResponse(error)
    }
  }

  async claim(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<ContextIndexLease[]> {
    const request = claimRequestSchema.parse(input)
    const data = await this.call(contextIndexRpcNames.claim, {
      p_worker_id: request.workerId,
      p_limit: request.limit,
      p_lease_seconds: request.leaseSeconds,
      p_now: request.now,
    })
    try {
      return claimEnvelopeSchema.parse(data).claims.map(toLease)
    } catch (error) {
      if (error instanceof ContextIndexRepositoryError) throw error
      throw invalidResponse(error)
    }
  }

  async reconcile(input: {
    companyId: string
    mode: ContextIndexReconciliationMode
    requestedLimit: number
    now: string
  }) {
    const request = contextIndexReconciliationRequestSchema.parse(input)
    const data = await this.call(contextIndexRpcNames.reconcile, {
      p_company_id: request.companyId,
      p_mode: request.mode,
      p_requested_limit: request.requestedLimit,
      p_now: request.now,
    })
    try {
      return contextIndexReconciliationSummarySchema.parse(data)
    } catch (error) {
      throw invalidResponse(error)
    }
  }

  async loadProjection(input: { workerId: string; lease: ContextIndexLease }) {
    const source = input.lease.projectionSource
    if (!source) {
      throw new ContextIndexRepositoryError("projection_not_found")
    }
    try {
      return contextIndexProjectionSourceSchema.parse(source)
    } catch (error) {
      throw invalidResponse(error)
    }
  }

  async complete(input: {
    workerId: string
    lease: ContextIndexLease
    outcome: ContextIndexCompletionOutcome
  }): Promise<void> {
    const outcome = contextIndexCompletionOutcomeSchema.parse(input.outcome)
    const data = await this.call(contextIndexRpcNames.complete, {
      p_worker_id: input.workerId,
      p_lease_id: input.lease.leaseId,
      p_result: {
        providerDocumentId: outcome.providerDocumentId,
        estimatedCostMicrounits: outcome.estimatedCostMicrounits,
      },
      p_now: outcome.completedAt,
    })
    try {
      const result = completeResultSchema.parse(data)
      if (
        result.outboxId !== input.lease.event.id ||
        result.operation !== input.lease.event.operation
      ) {
        throw new Error("Completion identity did not match the lease.")
      }
    } catch (error) {
      throw invalidResponse(error)
    }
  }

  async fail(input: {
    workerId: string
    lease: ContextIndexLease
    disposition: ContextIndexFailureDisposition
    errorCode: string
    now: string
  }) {
    const request = failureRequestSchema.parse({
      workerId: input.workerId,
      leaseId: input.lease.leaseId,
      disposition: input.disposition,
      errorCode: input.errorCode,
      now: input.now,
    })
    const data = await this.call(contextIndexRpcNames.fail, {
      p_worker_id: request.workerId,
      p_lease_id: request.leaseId,
      p_disposition:
        request.disposition === "retry"
          ? "transient"
          : request.disposition === "terminal"
            ? "permanent"
            : "unknown",
      p_error_code: request.errorCode,
      p_now: request.now,
    })
    try {
      const result = failureResultSchema.parse(data)
      if (result.outboxId !== input.lease.event.id) {
        throw new Error("Failure identity did not match the lease.")
      }
      return contextIndexFailureStateSchema.parse(
        result.status === "retry"
          ? "pending"
          : result.status === "dead_letter"
            ? "dead_letter"
            : "reconciliation_required"
      )
    } catch (error) {
      throw invalidResponse(error)
    }
  }

  private async call(
    name: string,
    args: Readonly<Record<string, unknown>>
  ): Promise<unknown> {
    let response
    try {
      response = await this.executor.rpc(name, args)
    } catch (error) {
      throw new ContextIndexRepositoryError("repository_unavailable", {
        cause: error,
      })
    }
    if (response.error) {
      throw mapRpcError(response.error)
    }
    return response.data
  }
}

function toLease(claim: z.output<typeof claimSchema>): ContextIndexLease {
  const projectionSource =
    claim.operation === "delete"
      ? null
      : {
          eventId: claim.outboxId,
          record: {
            id: claim.canonicalRecordId,
            companyId: claim.companyId,
            sourceId: claim.sourceId!,
            sourceKey: claim.sourceKey,
            recordType: claim.recordType,
            externalId: claim.externalId!,
            canonicalRecordVersion: claim.canonicalVersion,
            payload: claim.canonicalPayload!,
            observedAt: claim.observedAt!,
          },
          policy: {
            id: claim.policyId,
            companyId: claim.companyId,
            sourceKey: claim.sourceKey,
            recordType: claim.recordType,
            policyVersion: claim.policyVersion,
            policyHash: claim.policyHash,
            approvedFieldPaths: claim.approvedFieldPaths,
            maximumContentBytes: claim.maximumContentBytes,
            classification: claim.classification,
            retentionDays: claim.retentionDays,
            projectionVersion: claim.projectionVersion,
          },
          projectedContent: claim.projectedContent!,
        }
  return contextIndexLeaseSchema.parse({
    leaseId: claim.leaseId,
    leasedUntil: claim.leaseExpiresAt,
    event: {
      id: claim.outboxId,
      companyId: claim.companyId,
      provider: claim.provider,
      operation: claim.operation,
      canonicalRecordId: claim.canonicalRecordId,
      canonicalRecordVersion: claim.canonicalVersion,
      stableCustomId: claim.stableCustomId,
      providerDocumentId: claim.providerDocumentId,
      policyVersion: claim.policyVersion,
      policyHash: claim.policyHash,
      expectedContentHash: claim.contentHash,
      attempt: claim.attempt,
      maxAttempts: claim.maxAttempts,
    },
    projectionSource,
  })
}

function invalidResponse(error: unknown) {
  return new ContextIndexRepositoryError("repository_invalid_response", {
    cause: error,
  })
}

function mapRpcError(error: { message?: string; code?: string }) {
  const message = error.message ?? ""
  if (
    message.includes("context_index_lease_lost") ||
    message.includes("context_index_lease_not_owned_or_expired")
  ) {
    return new ContextIndexRepositoryError("lease_lost", { cause: error })
  }
  if (message.includes("context_index_event_not_found")) {
    return new ContextIndexRepositoryError("event_not_found", { cause: error })
  }
  return new ContextIndexRepositoryError("repository_unavailable", {
    cause: error,
  })
}
