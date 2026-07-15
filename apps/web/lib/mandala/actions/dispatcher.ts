import { randomUUID } from "node:crypto"
import {
  ExecutorFailure,
  executionRequestHash,
  stableHash,
  type ActionExecutionRequest,
  type ActionExecutionResult,
  type ExecutionEffect,
  type ExecutionPolicyRecheck,
  type ExecutionRetryClass,
  type ExecutorDefinition,
} from "./contracts"
import type { ExecutionReceiptStore } from "./receipts"
import type { ExecutorRegistry } from "./registry"

export type ActionDispatcherDependencies = {
  registry: ExecutorRegistry
  receipts: ExecutionReceiptStore
  recheckPolicy: ExecutionPolicyRecheck
  now?: () => Date
  createId?: () => string
  wait?: (milliseconds: number) => Promise<void>
}

export function createActionDispatcher(
  dependencies: ActionDispatcherDependencies
) {
  const now = dependencies.now ?? (() => new Date())
  const createId = dependencies.createId ?? randomUUID
  const wait = dependencies.wait ?? waitFor

  return async function dispatch(
    request: ActionExecutionRequest
  ): Promise<ActionExecutionResult> {
    const startedAt = now().toISOString()
    const requestHash = executionRequestHash(request)

    if (request.mode === "live") {
      return unrecordedResult({
        request,
        requestHash,
        executionId: createId(),
        startedAt,
        completedAt: now().toISOString(),
        status: "failed",
        retryClass: "terminal",
        code: "live_adapter_unavailable",
        message: "Live execution is disabled and no live adapter is installed.",
      })
    }

    const definition = dependencies.registry.resolve(request)
    if (!definition) {
      return unrecordedResult({
        request,
        requestHash,
        executionId: createId(),
        startedAt,
        completedAt: now().toISOString(),
        status: "failed",
        retryClass: "terminal",
        code: "executor_not_registered",
        message: "No executor matches the exact action and capability binding.",
      })
    }
    if (!definition.allowedModes.includes(request.mode)) {
      return unrecordedResult({
        request,
        requestHash,
        executionId: createId(),
        startedAt,
        completedAt: now().toISOString(),
        status: "failed",
        retryClass: "terminal",
        code: "execution_mode_not_allowed",
        message: `The registered executor does not allow ${request.mode} mode.`,
      })
    }
    if (!safelyValidates(definition.validateInput, request.input)) {
      return unrecordedResult({
        request,
        requestHash,
        executionId: createId(),
        startedAt,
        completedAt: now().toISOString(),
        status: "failed",
        retryClass: "terminal",
        code: "execution_input_invalid",
        message: "Action input does not match the registered schema.",
      })
    }

    const policy = await dependencies.recheckPolicy(request)
    const policyFailure = policyBlock(request, policy)
    if (policyFailure) {
      return unrecordedResult({
        request,
        requestHash,
        executionId: createId(),
        startedAt,
        completedAt: now().toISOString(),
        status: "failed",
        retryClass: "terminal",
        code: policyFailure.code,
        message: policyFailure.message,
      })
    }

    const receipt = await dependencies.receipts.begin({
      companyId: request.companyId,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      createExecutionId: createId,
    })
    if (receipt.kind === "replay") return receipt.result
    if (receipt.kind === "conflict") {
      return unrecordedResult({
        request,
        requestHash,
        executionId: createId(),
        startedAt,
        completedAt: now().toISOString(),
        status: "failed",
        retryClass: "terminal",
        code: "idempotency_key_reused",
        message: "The idempotency key was already used for another request.",
      })
    }
    if (receipt.kind === "in_progress") {
      return unrecordedResult({
        request,
        requestHash,
        executionId: receipt.executionId,
        startedAt,
        completedAt: null,
        status: "processing",
        retryClass: "retryable",
        code: "execution_in_progress",
        message: "An identical execution is already in progress.",
      })
    }

    const result = await executeWithRetry({
      request: {
        ...request,
        mode: request.mode as Exclude<ActionExecutionRequest["mode"], "live">,
      },
      definition,
      executionId: receipt.executionId,
      requestHash,
      startedAt,
      now,
      wait,
      recheckPolicy: dependencies.recheckPolicy,
    })
    await dependencies.receipts.complete({
      companyId: request.companyId,
      idempotencyKey: request.idempotencyKey,
      requestHash,
      result,
    })
    return result
  }
}

async function executeWithRetry(input: {
  request: ActionExecutionRequest & {
    mode: Exclude<ActionExecutionRequest["mode"], "live">
  }
  definition: ExecutorDefinition
  executionId: string
  requestHash: string
  startedAt: string
  now: () => Date
  wait: (milliseconds: number) => Promise<void>
  recheckPolicy: ExecutionPolicyRecheck
}): Promise<ActionExecutionResult> {
  let attempt = 0
  while (attempt < input.definition.retryPolicy.maxAttempts) {
    attempt += 1
    const policy = await input.recheckPolicy(input.request)
    const blocked = policyBlock(input.request, policy)
    if (blocked) {
      return {
        executionId: input.executionId,
        requestHash: input.requestHash,
        responseHash: null,
        mode: input.request.mode,
        status: "failed",
        effect: "none",
        retryClass: "terminal",
        attempt,
        code: blocked.code,
        message: blocked.message,
        output: null,
        providerReference: null,
        startedAt: input.startedAt,
        completedAt: input.now().toISOString(),
        replayed: false,
      }
    }
    try {
      const output = await invokeWithTimeout({
        request: input.request,
        definition: input.definition,
        executionId: input.executionId,
        attempt,
      })
      if (!safelyValidates(input.definition.validateOutput, output.output)) {
        throw new ExecutorFailure(
          "execution_output_invalid",
          "terminal",
          "Executor output does not match the registered schema."
        )
      }
      return {
        executionId: input.executionId,
        requestHash: input.requestHash,
        responseHash: stableHash(output.output),
        mode: input.request.mode,
        status: "succeeded",
        effect: output.effect,
        retryClass: "none",
        attempt,
        code: "execution_succeeded",
        message: "Execution completed.",
        output: output.output,
        providerReference: output.providerReference ?? null,
        startedAt: input.startedAt,
        completedAt: input.now().toISOString(),
        replayed: false,
      }
    } catch (error) {
      const failure = classifyFailure(error, input.definition)
      if (
        failure.retryClass === "retryable" &&
        attempt < input.definition.retryPolicy.maxAttempts
      ) {
        await input.wait(input.definition.retryPolicy.backoffMs)
        continue
      }
      const reconciliation = failure.retryClass === "unknown"
      return {
        executionId: input.executionId,
        requestHash: input.requestHash,
        responseHash: null,
        mode: input.request.mode,
        status: reconciliation ? "reconciliation_required" : "failed",
        effect: reconciliation ? "unknown" : "none",
        retryClass: failure.retryClass,
        attempt,
        code: failure.code,
        message: failure.message,
        output: null,
        providerReference: null,
        startedAt: input.startedAt,
        completedAt: input.now().toISOString(),
        replayed: false,
      }
    }
  }
  throw new Error("Executor retry loop ended unexpectedly.")
}

async function invokeWithTimeout(input: {
  request: ActionExecutionRequest & {
    mode: Exclude<ActionExecutionRequest["mode"], "live">
  }
  definition: ExecutorDefinition
  executionId: string
  attempt: number
}) {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new ExecutorTimeoutError())
      }, input.definition.timeoutMs)
    })
    return await Promise.race([
      input.definition.adapter.execute(input.request, {
        executionId: input.executionId,
        attempt: input.attempt,
        mode: input.request.mode,
        idempotencyKey: input.request.idempotencyKey,
        signal: controller.signal,
      }),
      timeoutPromise,
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function classifyFailure(
  error: unknown,
  definition: ExecutorDefinition
): {
  code: string
  retryClass: Exclude<ExecutionRetryClass, "none">
  message: string
} {
  if (error instanceof ExecutorTimeoutError) {
    return definition.retryPolicy.timeoutOutcome === "unknown"
      ? {
          code: "executor_timeout_outcome_unknown",
          retryClass: "unknown",
          message:
            "The executor timed out after dispatch; reconciliation is required.",
        }
      : {
          code: "executor_timeout",
          retryClass: "retryable",
          message: "The executor timed out before a side effect could occur.",
        }
  }
  if (error instanceof ExecutorFailure) {
    const retryClass = definition.retryPolicy.retryableCodes.includes(
      error.code
    )
      ? "retryable"
      : error.retryClass
    return { code: error.code, retryClass, message: error.message }
  }
  return {
    code: "executor_internal_error",
    retryClass: "terminal",
    message: "The executor failed safely.",
  }
}

function policyBlock(
  request: ActionExecutionRequest,
  policy: Awaited<ReturnType<ExecutionPolicyRecheck>>
): { code: string; message: string } | null {
  if (policy.lifecycleState !== "active") {
    return {
      code: "agent_not_active",
      message: `The agent is ${policy.lifecycleState}; action execution is blocked.`,
    }
  }
  const current = {
    agentConfigVersion: policy.agentConfigVersion,
    lifecycleVersion: policy.lifecycleVersion,
    policyVersion: policy.policyVersion,
    bindingVersion: policy.bindingVersion,
  }
  if (
    current.agentConfigVersion !== request.expected.agentConfigVersion ||
    current.lifecycleVersion !== request.expected.lifecycleVersion ||
    current.policyVersion !== request.expected.policyVersion ||
    current.bindingVersion !== request.expected.bindingVersion
  ) {
    return {
      code: "execution_context_stale",
      message:
        "Policy, lifecycle, configuration, or capability bindings changed.",
    }
  }
  if (!policy.capabilityGranted) {
    return {
      code: "capability_not_granted",
      message: "The capability grant is no longer active.",
    }
  }
  if (!policy.connectorHealthy) {
    return {
      code: "connector_unhealthy",
      message: "The connector is not currently healthy.",
    }
  }
  if (!policy.approvalValid) {
    return {
      code: "approval_invalid",
      message: "A current valid approval is required.",
    }
  }
  if (!policy.allowed) {
    return {
      code: "policy_denied",
      message: policy.reason ?? "Current policy blocks this action.",
    }
  }
  return null
}

function unrecordedResult(input: {
  request: ActionExecutionRequest
  requestHash: string
  executionId: string
  startedAt: string
  completedAt: string | null
  status: ActionExecutionResult["status"]
  retryClass: ExecutionRetryClass
  code: string
  message: string
  effect?: ExecutionEffect
}): ActionExecutionResult {
  return {
    executionId: input.executionId,
    requestHash: input.requestHash,
    responseHash: null,
    mode: input.request.mode,
    status: input.status,
    effect: input.effect ?? "none",
    retryClass: input.retryClass,
    attempt: 0,
    code: input.code,
    message: input.message,
    output: null,
    providerReference: null,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    replayed: false,
  }
}

class ExecutorTimeoutError extends Error {}

function safelyValidates(
  validate: (value: unknown) => boolean,
  value: unknown
): boolean {
  try {
    return validate(value)
  } catch {
    return false
  }
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
