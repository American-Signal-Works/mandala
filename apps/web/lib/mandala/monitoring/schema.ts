import { z } from "zod"

const ruleVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

export const escalationSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
])

export const followUpConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("failure") }).strict(),
  z.object({ type: z.literal("overdue") }).strict(),
  z
    .object({
      type: z.literal("stale"),
      staleAfterMinutes: z.number().int().min(1).max(43_200),
    })
    .strict(),
  z.object({ type: z.literal("unresolved") }).strict(),
])

export const followUpScheduleRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    workflowId: z.string().uuid().nullable().default(null),
    workflowRunId: z.string().uuid().nullable().default(null),
    sourceItemId: z.string().uuid(),
    actionAttemptId: z.string().uuid().nullable().default(null),
    condition: followUpConditionSchema,
    dueAt: z.string().datetime(),
    severity: escalationSeveritySchema,
    ruleVersion: ruleVersionSchema,
    recurrencePolicy: z.enum(["reopen", "new_occurrence"]).default("reopen"),
    maxAttempts: z.number().int().min(1).max(20).default(5),
  })
  .strict()

export const followUpRecordSchema = followUpScheduleRequestSchema.extend({
  id: z.string().uuid(),
  status: z.enum([
    "scheduled",
    "active",
    "leased",
    "resolved",
    "suppressed",
    "dead_letter",
  ]),
  occurrence: z.number().int().min(1),
  attempts: z.number().int().min(0),
  leaseOwner: z.string().max(128).nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  lastEvaluatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const followUpObservationSchema = z
  .object({
    sourceStatus: z.enum([
      "pending",
      "processing",
      "succeeded",
      "failed",
      "unknown",
      "reconciliation_required",
      "resolved",
      "suppressed",
    ]),
    lastActivityAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable().default(null),
  })
  .strict()

export const monitoringDecisionSchema = z
  .object({
    qualifies: z.boolean(),
    activeKey: z.string().min(1).max(512),
    reason: z.enum([
      "failure_detected",
      "overdue_detected",
      "stale_detected",
      "unresolved_detected",
      "not_due",
      "condition_clear",
      "source_resolved",
    ]),
    evaluatedAt: z.string().datetime(),
  })
  .strict()

export const escalationRecordSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    followUpId: z.string().uuid(),
    sourceItemId: z.string().uuid(),
    activeKey: z.string().min(1).max(512),
    reason: z.string().min(1).max(500),
    severity: escalationSeveritySchema,
    status: z.enum(["open", "resolved", "suppressed"]),
    occurrence: z.number().int().min(1),
    openedAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict()

export const monitoringLeaseSchema = z
  .object({
    leaseId: z.string().uuid(),
    followUp: followUpRecordSchema,
    observation: followUpObservationSchema,
  })
  .strict()

export const monitoringActivityEventSchema = z
  .object({
    id: z.string().uuid(),
    eventSequence: z.number().int().positive(),
    companyId: z.string().uuid(),
    followUpId: z.string().uuid(),
    escalationId: z.string().uuid().nullable(),
    eventType: z.enum([
      "scheduled",
      "deduplicated",
      "claimed",
      "retry_scheduled",
      "escalated",
      "resolved",
      "suppressed",
      "dead_letter",
      "reopened",
      "new_occurrence",
    ]),
    occurrence: z.number().int().positive(),
    actorType: z.enum(["user", "worker", "system"]),
    actorId: z.string().uuid().nullable(),
    workerId: z.string().min(1).max(128).nullable(),
    reason: z.string().min(1).max(2000).nullable(),
    details: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime(),
  })
  .strict()

export type FollowUpScheduleRequest = z.infer<
  typeof followUpScheduleRequestSchema
>
export type FollowUpRecord = z.infer<typeof followUpRecordSchema>
export type FollowUpObservation = z.infer<typeof followUpObservationSchema>
export type MonitoringDecision = z.infer<typeof monitoringDecisionSchema>
export type MonitoringLease = z.infer<typeof monitoringLeaseSchema>
export type EscalationRecord = z.infer<typeof escalationRecordSchema>
export type MonitoringActivityEvent = z.infer<
  typeof monitoringActivityEventSchema
>
