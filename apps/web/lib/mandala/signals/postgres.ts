import { z } from "zod"
import {
  SignalRepositoryError,
  type SignalDispatchRepository,
} from "./repository"
import {
  signalLeaseSchema,
  type SignalExecutionOutcome,
  type SignalLease,
} from "./schema"

export interface SignalSqlExecutor {
  query(sql: string, values: readonly unknown[]): Promise<{ rows: unknown[] }>
}

const preparationSchema = z
  .object({
    changeWindowsProcessed: z.number().int().nonnegative(),
    changeDispatchesEnqueued: z.number().int().nonnegative(),
    scheduleDispatchesEnqueued: z.number().int().nonnegative(),
    reconciliationDispatchesEnqueued: z.number().int().nonnegative(),
    preparedAt: z.string().datetime({ offset: true }),
  })
  .strict()

const resultRowSchema = z.object({ result: z.unknown() }).strict()
const failureResultSchema = z
  .object({ status: z.enum(["pending", "dead_letter"]) })
  .passthrough()

export class PostgresSignalDispatchRepository implements SignalDispatchRepository {
  constructor(private readonly sql: SignalSqlExecutor) {}

  async prepare(input: {
    now: string
    changeLimit: number
    scheduleLimit: number
  }) {
    try {
      const result = await this.sql.query(
        "select workflow_private.prepare_agent_signal_dispatches($1, $2, $3) as result",
        [input.now, input.changeLimit, input.scheduleLimit]
      )
      const row = resultRowSchema.parse(result.rows[0])
      return preparationSchema.parse(row.result)
    } catch (error) {
      throw mapPostgresError(error)
    }
  }

  async claim(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<SignalLease[]> {
    try {
      const result = await this.sql.query(
        "select * from workflow_private.claim_agent_signal_dispatches($1, $2, $3, $4)",
        [input.workerId, input.limit, input.leaseSeconds, input.now]
      )
      return signalLeaseSchema.array().parse(result.rows)
    } catch (error) {
      throw mapPostgresError(error)
    }
  }

  async complete(input: {
    workerId: string
    lease: SignalLease
    outcome: SignalExecutionOutcome
  }): Promise<void> {
    try {
      await this.sql.query(
        "select workflow_private.complete_agent_signal_dispatch($1, $2, $3, $4::jsonb)",
        [
          input.workerId,
          input.lease.leaseId,
          input.outcome.status,
          JSON.stringify(input.outcome.result),
        ]
      )
    } catch (error) {
      throw mapPostgresError(error)
    }
  }

  async fail(input: {
    workerId: string
    lease: SignalLease
    retryable: boolean
    errorCode: string
  }): Promise<"pending" | "dead_letter"> {
    try {
      const result = await this.sql.query(
        "select workflow_private.fail_agent_signal_dispatch($1, $2, $3, $4) as result",
        [input.workerId, input.lease.leaseId, input.retryable, input.errorCode]
      )
      const row = resultRowSchema.parse(result.rows[0])
      return failureResultSchema.parse(row.result).status
    } catch (error) {
      throw mapPostgresError(error)
    }
  }
}

function mapPostgresError(error: unknown): SignalRepositoryError {
  if (error instanceof z.ZodError) {
    return new SignalRepositoryError("repository_invalid_response", {
      cause: error,
    })
  }
  const message = error instanceof Error ? error.message : ""
  if (message.includes("agent_signal_lease_lost")) {
    return new SignalRepositoryError("lease_lost", { cause: error })
  }
  if (message.includes("agent_signal_dispatch_not_found")) {
    return new SignalRepositoryError("dispatch_not_found", { cause: error })
  }
  return new SignalRepositoryError("repository_unavailable", { cause: error })
}
