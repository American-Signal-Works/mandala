import { z } from "zod"
import {
  MonitoringRepositoryError,
  type MonitoringWorkerRepository,
} from "./repository"
import {
  escalationRecordSchema,
  monitoringLeaseSchema,
  type MonitoringDecision,
  type MonitoringLease,
} from "./schema"

export interface MonitoringSqlExecutor {
  query(sql: string, values: readonly unknown[]): Promise<{ rows: unknown[] }>
}

const completionSchema = z
  .object({
    escalation: escalationRecordSchema.nullable(),
    duplicate: z.boolean(),
  })
  .strict()

export class PostgresMonitoringWorkerRepository implements MonitoringWorkerRepository {
  constructor(private readonly sql: MonitoringSqlExecutor) {}

  async claimDue(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<MonitoringLease[]> {
    try {
      const result = await this.sql.query(
        "select * from workflow_private.claim_due_agent_follow_ups($1, $2, $3, $4)",
        [input.workerId, input.limit, input.leaseSeconds, input.now]
      )
      return monitoringLeaseSchema.array().parse(result.rows)
    } catch (error) {
      throw mapPostgresError(error)
    }
  }

  async completeClaim(input: {
    workerId: string
    lease: MonitoringLease
    decision: MonitoringDecision
  }) {
    try {
      const result = await this.sql.query(
        "select workflow_private.complete_agent_follow_up_claim($1, $2, $3::jsonb) as result",
        [input.workerId, input.lease.leaseId, JSON.stringify(input.decision)]
      )
      const row = z.object({ result: z.unknown() }).parse(result.rows[0])
      return completionSchema.parse(row.result)
    } catch (error) {
      throw mapPostgresError(error)
    }
  }

  async failClaim(input: {
    workerId: string
    lease: MonitoringLease
    retryable: boolean
    errorCode: string
  }): Promise<void> {
    try {
      await this.sql.query(
        "select workflow_private.fail_agent_follow_up_claim($1, $2, $3, $4)",
        [input.workerId, input.lease.leaseId, input.retryable, input.errorCode]
      )
    } catch (error) {
      throw mapPostgresError(error)
    }
  }
}

function mapPostgresError(error: unknown): MonitoringRepositoryError {
  if (error instanceof z.ZodError)
    return new MonitoringRepositoryError("repository_invalid_response", {
      cause: error,
    })
  const message = error instanceof Error ? error.message : ""
  if (message.includes("lease_lost"))
    return new MonitoringRepositoryError("lease_lost", { cause: error })
  if (message.includes("follow_up_not_found"))
    return new MonitoringRepositoryError("follow_up_not_found", {
      cause: error,
    })
  return new MonitoringRepositoryError("repository_unavailable", {
    cause: error,
  })
}
