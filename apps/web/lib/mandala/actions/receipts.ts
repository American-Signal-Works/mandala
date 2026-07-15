import type { ActionExecutionResult } from "./contracts"

export type ReceiptStart =
  | { kind: "started"; executionId: string }
  | { kind: "replay"; result: ActionExecutionResult }
  | { kind: "in_progress"; executionId: string }
  | { kind: "conflict" }

export interface ExecutionReceiptStore {
  begin(input: {
    companyId: string
    idempotencyKey: string
    requestHash: string
    createExecutionId: () => string
  }): Promise<ReceiptStart>
  complete(input: {
    companyId: string
    idempotencyKey: string
    requestHash: string
    result: ActionExecutionResult
  }): Promise<void>
}

type StoredReceipt = {
  requestHash: string
  executionId: string
  result: ActionExecutionResult | null
}

export class InMemoryExecutionReceiptStore implements ExecutionReceiptStore {
  readonly #receipts = new Map<string, StoredReceipt>()

  async begin(input: {
    companyId: string
    idempotencyKey: string
    requestHash: string
    createExecutionId: () => string
  }): Promise<ReceiptStart> {
    const key = receiptKey(input.companyId, input.idempotencyKey)
    const current = this.#receipts.get(key)
    if (current) {
      if (current.requestHash !== input.requestHash) return { kind: "conflict" }
      if (current.result) {
        return {
          kind: "replay",
          result: { ...structuredClone(current.result), replayed: true },
        }
      }
      return { kind: "in_progress", executionId: current.executionId }
    }
    const executionId = input.createExecutionId()
    this.#receipts.set(key, {
      requestHash: input.requestHash,
      executionId,
      result: null,
    })
    return { kind: "started", executionId }
  }

  async complete(input: {
    companyId: string
    idempotencyKey: string
    requestHash: string
    result: ActionExecutionResult
  }): Promise<void> {
    const key = receiptKey(input.companyId, input.idempotencyKey)
    const current = this.#receipts.get(key)
    if (
      !current ||
      current.requestHash !== input.requestHash ||
      current.executionId !== input.result.executionId
    ) {
      throw new Error("Execution receipt changed before completion.")
    }
    current.result = structuredClone(input.result)
  }
}

function receiptKey(companyId: string, idempotencyKey: string): string {
  return `${companyId}::${idempotencyKey}`
}
