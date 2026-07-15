import { z } from "zod"
import { evaluateFollowUp } from "./detector"
import {
  MonitoringRepositoryError,
  type FollowUpSchedulerRepository,
  type MonitoringWorkerRepository,
} from "./repository"
import {
  followUpRecordSchema,
  followUpScheduleRequestSchema,
  monitoringLeaseSchema,
} from "./schema"

export async function scheduleFollowUp(input: {
  repository: FollowUpSchedulerRepository
  actorId: string
  request: unknown
}) {
  const request = followUpScheduleRequestSchema.parse(input.request)
  return followUpRecordSchema.parse(
    await input.repository.schedule({ request, actorId: input.actorId })
  )
}

export async function runMonitoringBatch(input: {
  repository: MonitoringWorkerRepository
  workerId: string
  now?: Date
  limit?: number
  leaseSeconds?: number
}) {
  const workerId = z.string().trim().min(1).max(128).parse(input.workerId)
  const limit = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(input.limit ?? 25)
  const leaseSeconds = z
    .number()
    .int()
    .min(15)
    .max(900)
    .parse(input.leaseSeconds ?? 60)
  const now = input.now ?? new Date()
  const leases = z.array(monitoringLeaseSchema).parse(
    await input.repository.claimDue({
      workerId,
      limit,
      leaseSeconds,
      now: now.toISOString(),
    })
  )

  const summary = {
    claimed: leases.length,
    evaluated: 0,
    escalated: 0,
    deduplicated: 0,
    resolved: 0,
    failed: 0,
  }

  for (const lease of leases) {
    try {
      const decision = evaluateFollowUp({
        followUp: lease.followUp,
        observation: lease.observation,
        now,
      })
      const result = await input.repository.completeClaim({
        workerId,
        lease,
        decision,
      })
      summary.evaluated += 1
      if (decision.qualifies && result.escalation) summary.escalated += 1
      if (result.duplicate) summary.deduplicated += 1
      if (!decision.qualifies && decision.reason === "source_resolved")
        summary.resolved += 1
    } catch (error) {
      summary.failed += 1
      if (error instanceof MonitoringRepositoryError) continue
      await input.repository.failClaim({
        workerId,
        lease,
        retryable: !(error instanceof z.ZodError),
        errorCode:
          error instanceof Error ? sanitizeErrorCode(error.name) : "unknown",
      })
    }
  }

  return summary
}

function sanitizeErrorCode(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .slice(0, 64)
}
