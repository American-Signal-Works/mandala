import { z } from "zod"
import type { SignalDispatchRepository } from "./repository"
import {
  signalExecutionOutcomeSchema,
  type SignalDispatch,
  type SignalLease,
} from "./schema"

const workerOptionsSchema = z
  .object({
    workerId: z.string().trim().min(1).max(128),
    limit: z.number().int().min(1).max(100).default(25),
    leaseSeconds: z.number().int().min(15).max(900).default(120),
    concurrency: z.number().int().min(1).max(20).default(4),
    now: z.string().datetime({ offset: true }),
  })
  .strict()

export interface SignalDispatchExecutor {
  execute(dispatch: SignalDispatch): Promise<{
    status: "completed" | "suppressed"
    result: Record<string, unknown>
  }>
}

export class SignalExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(code, options)
    this.name = "SignalExecutionError"
    if (!/^[a-z0-9_]{1,64}$/.test(code)) {
      throw new Error("Signal execution error codes must be safe identifiers.")
    }
  }
}

export type SignalDispatchResult = {
  dispatchId: string
  status:
    | "completed"
    | "suppressed"
    | "retry_scheduled"
    | "dead_letter"
    | "lease_unresolved"
  errorCode?: string
}

export type SignalWorkerSummary = {
  claimed: number
  completed: number
  suppressed: number
  retryScheduled: number
  deadLettered: number
  leaseUnresolved: number
  results: SignalDispatchResult[]
}

export async function runSignalDispatchBatch(input: {
  repository: SignalDispatchRepository
  executor: SignalDispatchExecutor
  workerId: string
  limit?: number
  leaseSeconds?: number
  concurrency?: number
  now?: Date
}): Promise<SignalWorkerSummary> {
  const options = workerOptionsSchema.parse({
    workerId: input.workerId,
    limit: input.limit ?? 25,
    leaseSeconds: input.leaseSeconds ?? 120,
    concurrency: input.concurrency ?? 4,
    now: (input.now ?? new Date()).toISOString(),
  })
  const leases = await input.repository.claim(options)
  const results = await mapWithConcurrency(
    leases,
    options.concurrency,
    (lease) => executeLease({ ...input, workerId: options.workerId, lease })
  )
  return summarize(results)
}

async function executeLease(input: {
  repository: SignalDispatchRepository
  executor: SignalDispatchExecutor
  workerId: string
  lease: SignalLease
}): Promise<SignalDispatchResult> {
  let outcome: Awaited<ReturnType<SignalDispatchExecutor["execute"]>>
  try {
    const executionResult = await input.executor.execute(input.lease.dispatch)
    const parsed = signalExecutionOutcomeSchema.safeParse(executionResult)
    if (!parsed.success) {
      throw new SignalExecutionError("invalid_signal_execution_result", false, {
        cause: parsed.error,
      })
    }
    outcome = parsed.data
  } catch (error) {
    const failure = classifyExecutionError(error)
    try {
      const status = await input.repository.fail({
        workerId: input.workerId,
        lease: input.lease,
        retryable: failure.retryable,
        errorCode: failure.code,
      })
      return {
        dispatchId: input.lease.dispatch.id,
        status: status === "pending" ? "retry_scheduled" : "dead_letter",
        errorCode: failure.code,
      }
    } catch {
      return {
        dispatchId: input.lease.dispatch.id,
        status: "lease_unresolved",
        errorCode: failure.code,
      }
    }
  }

  try {
    await input.repository.complete({
      workerId: input.workerId,
      lease: input.lease,
      outcome,
    })
  } catch {
    // Do not issue a contradictory failure after execution succeeded. The
    // durable lease expires and makes this dispatch recoverable instead.
    return {
      dispatchId: input.lease.dispatch.id,
      status: "lease_unresolved",
    }
  }
  return {
    dispatchId: input.lease.dispatch.id,
    status: outcome.status,
  }
}

function classifyExecutionError(error: unknown): {
  code: string
  retryable: boolean
} {
  if (error instanceof SignalExecutionError) {
    return { code: error.code, retryable: error.retryable }
  }
  return { code: "signal_execution_failed", retryable: true }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(values[index]!)
      }
    })
  )
  return results
}

function summarize(results: SignalDispatchResult[]): SignalWorkerSummary {
  return {
    claimed: results.length,
    completed: count(results, "completed"),
    suppressed: count(results, "suppressed"),
    retryScheduled: count(results, "retry_scheduled"),
    deadLettered: count(results, "dead_letter"),
    leaseUnresolved: count(results, "lease_unresolved"),
    results,
  }
}

function count(
  results: readonly SignalDispatchResult[],
  status: SignalDispatchResult["status"]
) {
  return results.filter((result) => result.status === status).length
}
