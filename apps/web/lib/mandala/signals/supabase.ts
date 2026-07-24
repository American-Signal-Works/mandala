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

type RpcResult = Promise<{ data: unknown; error: { message: string } | null }>

export interface SignalRpcExecutor {
  rpc(name: string, args: Record<string, unknown>): RpcResult
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

const failureResultSchema = z
  .object({ status: z.enum(["pending", "dead_letter"]) })
  .passthrough()

export class SupabaseSignalDispatchRepository implements SignalDispatchRepository {
  constructor(private readonly client: SignalRpcExecutor) {}

  async prepare(input: {
    now: string
    changeLimit: number
    scheduleLimit: number
  }) {
    const data = await this.call("prepare_agent_signal_dispatches_v1", {
      p_now: input.now,
      p_change_limit: input.changeLimit,
      p_schedule_limit: input.scheduleLimit,
    })
    return this.parse(preparationSchema, data)
  }

  async claim(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<SignalLease[]> {
    const data = await this.call("claim_agent_signal_dispatches_v1", {
      p_worker_id: input.workerId,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
      p_now: input.now,
    })
    return this.parse(signalLeaseSchema.array(), data)
  }

  async complete(input: {
    workerId: string
    lease: SignalLease
    outcome: SignalExecutionOutcome
  }): Promise<void> {
    await this.call("complete_agent_signal_dispatch_v1", {
      p_worker_id: input.workerId,
      p_lease_id: input.lease.leaseId,
      p_outcome: input.outcome.status,
      p_result: input.outcome.result,
    })
  }

  async fail(input: {
    workerId: string
    lease: SignalLease
    retryable: boolean
    errorCode: string
  }): Promise<"pending" | "dead_letter"> {
    const data = await this.call("fail_agent_signal_dispatch_v1", {
      p_worker_id: input.workerId,
      p_lease_id: input.lease.leaseId,
      p_retryable: input.retryable,
      p_error_code: input.errorCode,
    })
    return this.parse(failureResultSchema, data).status
  }

  private async call(name: string, args: Record<string, unknown>) {
    try {
      const { data, error } = await this.client.rpc(name, args)
      if (error) throw new Error(error.message)
      return data
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new SignalRepositoryError("repository_invalid_response", {
          cause: error,
        })
      }
      const message = error instanceof Error ? error.message : ""
      if (message.includes("agent_signal_lease_lost")) {
        throw new SignalRepositoryError("lease_lost", { cause: error })
      }
      if (message.includes("agent_signal_dispatch_not_found")) {
        throw new SignalRepositoryError("dispatch_not_found", {
          cause: error,
        })
      }
      throw new SignalRepositoryError("repository_unavailable", {
        cause: error,
      })
    }
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown): T {
    try {
      return schema.parse(data)
    } catch (error) {
      throw new SignalRepositoryError("repository_invalid_response", {
        cause: error,
      })
    }
  }
}
