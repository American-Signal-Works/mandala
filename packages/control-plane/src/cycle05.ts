import { z } from "zod"
import {
  companyRoleSchema,
  identifierSchema,
  idempotencyKeySchema,
  isoTimestampSchema,
  jsonObjectSchema,
  jsonValueSchema,
  reviewVersionSchema,
} from "./schemas.js"

export const executionModeSchema = z.enum([
  "fixture",
  "mock",
  "dry_run",
  "shadow",
  "live",
])

export const executionAttemptStatusSchema = z.enum([
  "pending",
  "processing",
  "succeeded",
  "failed",
  "unknown",
  "reconciliation_required",
])

export const executionRetryClassSchema = z.enum([
  "never",
  "safe",
  "provider_idempotent",
  "reconcile_first",
])

export const actionContractSchema = z
  .object({
    id: identifierSchema,
    version: z.string().min(1).max(40),
    capabilityId: identifierSchema,
    capabilityVersion: z.string().min(1).max(40),
    connectorId: identifierSchema.nullable(),
    inputSchemaDigest: z.string().regex(/^[0-9a-f]{64}$/),
    outputSchemaDigest: z.string().regex(/^[0-9a-f]{64}$/),
    allowedModes: z.array(executionModeSchema).min(1).max(5),
    requiresApproval: z.boolean(),
    timeoutMs: z.number().int().min(100).max(120_000),
    retryClass: executionRetryClassSchema,
  })
  .strict()

export const toolContractSchema = actionContractSchema.extend({
  access: z.enum(["read", "propose", "execute"]),
})

export const controlledExecutionRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    agentId: z.string().uuid(),
    workflowRunId: z.string().uuid(),
    workItemId: z.string().uuid(),
    actionDraftId: z.string().uuid(),
    decisionId: z.string().uuid(),
    actionId: identifierSchema,
    actionVersion: z.string().min(1).max(40),
    bindingSnapshotId: z.string().uuid(),
    mode: executionModeSchema,
    expectedVersion: reviewVersionSchema,
    idempotencyKey: idempotencyKeySchema,
    input: jsonObjectSchema,
  })
  .strict()

export const controlledExecutionResultSchema = z
  .object({
    attemptId: z.string().uuid(),
    mode: executionModeSchema,
    status: executionAttemptStatusSchema,
    effect: z.enum(["simulated", "observed", "committed", "none", "unknown"]),
    retryClass: executionRetryClassSchema,
    attemptNumber: z.number().int().min(1),
    output: jsonObjectSchema.nullable(),
    errorCode: identifierSchema.nullable(),
    providerReference: z.string().max(500).nullable(),
    reconciliationRequired: z.boolean(),
    createdAt: isoTimestampSchema,
    completedAt: isoTimestampSchema.nullable(),
  })
  .strict()

export const agentLifecycleStateV2Schema = z.enum([
  "draft",
  "ready",
  "active",
  "paused",
  "disabled",
  "invalid",
  "archived",
])

export const agentLifecycleActionV2Schema = z.enum([
  "validate",
  "test",
  "activate",
  "pause",
  "resume",
  "disable",
  "rollback",
])

export const readinessCheckSchema = z
  .object({
    code: identifierSchema,
    status: z.enum(["pass", "warning", "blocked"]),
    message: z.string().min(1).max(2_000),
    sourceVersion: z.string().min(1).max(200).nullable(),
  })
  .strict()

export const agentReadinessSchema = z
  .object({
    agentId: z.string().uuid(),
    companyId: z.string().uuid(),
    configurationVersion: z.number().int().min(1),
    state: agentLifecycleStateV2Schema,
    eligibleForActivation: z.boolean(),
    checks: z.array(readinessCheckSchema).max(100),
    sampleRunId: z.string().uuid().nullable(),
    bindingSnapshotId: z.string().uuid().nullable(),
    evaluationCheckpointId: z.string().uuid().nullable(),
    evaluatedAt: isoTimestampSchema,
  })
  .strict()

export const agentLifecycleTransitionRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    action: agentLifecycleActionV2Schema,
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().min(1).max(2_000),
    targetVersion: z.string().min(1).max(40).optional(),
  })
  .strict()

export const feedbackOutcomeSchema = z.enum([
  "accepted",
  "edited",
  "rejected",
  "rework_requested",
  "failed",
  "stale",
  "unsafe",
])

export const feedbackRecordSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    workItemId: z.string().uuid(),
    recommendationId: z.string().uuid(),
    recommendationVersion: reviewVersionSchema,
    actorId: z.string().uuid(),
    actorRole: companyRoleSchema,
    outcome: feedbackOutcomeSchema,
    correction: jsonObjectSchema,
    reason: z.string().max(2_000).nullable(),
    createdAt: isoTimestampSchema,
  })
  .strict()

export const memoryCandidateStatusSchema = z.enum([
  "pending_review",
  "approved",
  "rejected",
  "superseded",
  "expired",
  "revoked",
  "forgotten",
])

export const memoryScopeSchema = z
  .object({
    companyId: z.string().uuid(),
    agentId: z.string().uuid().nullable(),
    subjectType: identifierSchema.nullable(),
    subjectId: z.string().max(500).nullable(),
  })
  .strict()

export const memoryProvenanceSchema = z
  .object({
    feedbackId: z.string().uuid().nullable(),
    workItemId: z.string().uuid().nullable(),
    recommendationId: z.string().uuid().nullable(),
    sourceVersion: z.string().min(1).max(200),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export const memoryCandidateSchema = z
  .object({
    id: z.string().uuid(),
    scope: memoryScopeSchema,
    status: memoryCandidateStatusSchema,
    content: jsonObjectSchema,
    provenance: memoryProvenanceSchema,
    confidence: z.number().min(0).max(1).nullable(),
    classification: z.enum(["internal", "confidential", "restricted"]),
    reviewerId: z.string().uuid().nullable(),
    expiresAt: isoTimestampSchema.nullable(),
    supersedesId: z.string().uuid().nullable(),
    providerReference: z.string().max(500).nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()

export const memoryRetrievalRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    agentId: z.string().uuid().optional(),
    subjectType: identifierSchema.optional(),
    subjectId: z.string().min(1).max(500).optional(),
    query: z.string().trim().min(1).max(2_000),
    limit: z.number().int().min(1).max(20).default(5),
  })
  .strict()

export const memoryRetrievalResultSchema = z
  .object({
    candidateId: z.string().uuid(),
    content: jsonObjectSchema,
    provenance: memoryProvenanceSchema,
    applicability: z.string().min(1).max(1_000),
    confidence: z.number().min(0).max(1).nullable(),
  })
  .strict()

export const followUpConditionSchema = z.enum([
  "failed",
  "overdue",
  "stale",
  "unresolved",
])

export const followUpStatusSchema = z.enum([
  "scheduled",
  "active",
  "resolved",
  "suppressed",
  "dead_letter",
])

export const escalationSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    workItemId: z.string().uuid(),
    followUpId: z.string().uuid(),
    ruleVersion: z.string().min(1).max(100),
    condition: followUpConditionSchema,
    status: z.enum(["active", "resolved", "suppressed"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    reason: z.string().min(1).max(2_000),
    detectedAt: isoTimestampSchema,
    resolvedAt: isoTimestampSchema.nullable(),
  })
  .strict()

export const evaluationOutcomeSchema = feedbackOutcomeSchema

export const evaluationResultSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    agentId: z.string().uuid(),
    manifestDigest: z.string().regex(/^[0-9a-f]{64}$/),
    evaluatorVersion: z.string().min(1).max(100),
    confidenceDefinitionVersion: z.string().min(1).max(100),
    datasetDigest: z.string().regex(/^[0-9a-f]{64}$/),
    outcome: evaluationOutcomeSchema.nullable(),
    metrics: jsonObjectSchema,
    missingData: z.array(identifierSchema).max(100),
    thresholdStatus: z.enum(["pass", "blocked"]),
    traceIds: z.array(z.string().min(1).max(200)).max(20),
    createdAt: isoTimestampSchema,
  })
  .strict()

export const contextualChatRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    input: z.string().trim().min(1).max(2_000),
    selectedItemId: z.string().uuid().nullable(),
    expectedReviewVersion: reviewVersionSchema.nullable(),
    conversationId: z.string().uuid(),
  })
  .strict()

export const contextualChatRouteSchema = z.enum([
  "question",
  "command",
  "clarification",
  "blocked",
])

export const contextualChatResponseSchema = z
  .object({
    route: contextualChatRouteSchema,
    message: z.string().min(1).max(5_000),
    companyId: z.string().uuid(),
    selectedItemId: z.string().uuid().nullable(),
    reviewVersion: reviewVersionSchema.nullable(),
    command: jsonValueSchema.nullable(),
    confirmationRequired: z.boolean(),
    mutated: z.boolean(),
  })
  .strict()

export type ExecutionMode = z.infer<typeof executionModeSchema>
export type ControlledExecutionRequest = z.infer<
  typeof controlledExecutionRequestSchema
>
export type ControlledExecutionResult = z.infer<
  typeof controlledExecutionResultSchema
>
export type AgentLifecycleStateV2 = z.infer<typeof agentLifecycleStateV2Schema>
export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>
export type ContextualChatRequest = z.infer<typeof contextualChatRequestSchema>
export type ContextualChatResponse = z.infer<
  typeof contextualChatResponseSchema
>
