import {
  executionModes,
  executorBindingKey,
  type ExecutorBinding,
  type ExecutorDefinition,
} from "./contracts"

export class ExecutorRegistry {
  readonly #definitions: ReadonlyMap<string, ExecutorDefinition>

  constructor(definitions: readonly ExecutorDefinition[]) {
    const registered = new Map<string, ExecutorDefinition>()
    for (const definition of definitions) {
      validateDefinition(definition)
      const key = executorBindingKey(definition)
      if (registered.has(key)) {
        throw new Error(`Executor ${key} is registered more than once.`)
      }
      registered.set(key, freezeDefinition(definition))
    }
    this.#definitions = registered
  }

  resolve(binding: ExecutorBinding): ExecutorDefinition | null {
    return this.#definitions.get(executorBindingKey(binding)) ?? null
  }

  list(): readonly Omit<
    ExecutorDefinition,
    "adapter" | "validateInput" | "validateOutput"
  >[] {
    return [...this.#definitions.values()].map((definition) => ({
      actionId: definition.actionId,
      actionVersion: definition.actionVersion,
      capabilityId: definition.capabilityId,
      capabilityVersion: definition.capabilityVersion,
      connectorId: definition.connectorId,
      schemaDigest: definition.schemaDigest,
      allowedModes: [...definition.allowedModes],
      timeoutMs: definition.timeoutMs,
      retryPolicy: structuredClone(definition.retryPolicy),
    }))
  }
}

function validateDefinition(definition: ExecutorDefinition): void {
  const values = [
    definition.actionId,
    definition.actionVersion,
    definition.capabilityId,
    definition.capabilityVersion,
    definition.connectorId,
    definition.schemaDigest,
  ]
  if (values.some((value) => !value.trim())) {
    throw new Error("Executor bindings must be complete.")
  }
  if (definition.allowedModes.length === 0) {
    throw new Error("An executor must allow at least one non-live mode.")
  }
  if (
    definition.allowedModes.some(
      (mode) => !executionModes.includes(mode) || (mode as string) === "live"
    )
  ) {
    throw new Error("Live executor adapters are disabled in Cycle 0.0.5.")
  }
  if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 1) {
    throw new Error("Executor timeout must be a positive integer.")
  }
  if (
    !Number.isInteger(definition.retryPolicy.maxAttempts) ||
    definition.retryPolicy.maxAttempts < 1 ||
    definition.retryPolicy.maxAttempts > 5
  ) {
    throw new Error("Executor attempts must be between one and five.")
  }
  if (definition.retryPolicy.backoffMs < 0) {
    throw new Error("Executor retry delay cannot be negative.")
  }
}

function freezeDefinition(definition: ExecutorDefinition): ExecutorDefinition {
  return Object.freeze({
    ...definition,
    allowedModes: Object.freeze([...definition.allowedModes]),
    retryPolicy: Object.freeze({
      ...definition.retryPolicy,
      retryableCodes: Object.freeze([...definition.retryPolicy.retryableCodes]),
    }),
  })
}
