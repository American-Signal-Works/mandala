import { createHash } from "node:crypto"
import {
  contextIndexProjectionSchema,
  contextIndexProjectionSourceSchema,
  parseJsonPointer,
  type ContextIndexOutboxEvent,
  type ContextIndexProjection,
  type ContextIndexProjectionSource,
} from "@workspace/control-plane"

const unsafeFieldToken =
  /(password|passwd|secret|token|credential|authorization|apikey|accesskey|privatekey|cookie|prompt|systeminstruction|bearer|sessionkey)/
const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"])

export type ContextProjectionErrorCode =
  | "invalid_projection_source"
  | "projection_scope_mismatch"
  | "projection_event_stale"
  | "projection_policy_stale"
  | "projection_policy_disabled"
  | "approved_field_missing"
  | "approved_field_unsafe"
  | "projected_content_too_large"
  | "projected_content_invalid"
  | "projected_content_hash_mismatch"

export class ContextProjectionError extends Error {
  constructor(
    readonly code: ContextProjectionErrorCode,
    options?: { cause?: unknown }
  ) {
    super(code, options)
    this.name = "ContextProjectionError"
  }
}

export function projectContextIndexDocument(input: {
  event: ContextIndexOutboxEvent
  source: ContextIndexProjectionSource
}): ContextIndexProjection {
  const parsed = contextIndexProjectionSourceSchema.safeParse(input.source)
  if (!parsed.success) {
    throw new ContextProjectionError("invalid_projection_source", {
      cause: parsed.error,
    })
  }
  const { event } = input
  const { record, policy } = parsed.data
  if (
    event.companyId !== record.companyId ||
    event.canonicalRecordId !== record.id
  ) {
    throw new ContextProjectionError("projection_scope_mismatch")
  }
  if (event.id !== parsed.data.eventId) {
    throw new ContextProjectionError("projection_event_stale")
  }
  if (event.canonicalRecordVersion !== record.canonicalRecordVersion) {
    throw new ContextProjectionError("projection_event_stale")
  }
  if (
    event.policyVersion !== policy.policyVersion ||
    event.policyHash !== policy.policyHash
  ) {
    throw new ContextProjectionError("projection_policy_stale")
  }

  const fields = [...policy.approvedFieldPaths]
    .sort()
    .map((path) => ({ path, value: readApprovedValue(record.payload, path) }))
  const projectedObject = Object.fromEntries(
    fields.map((field) => [field.path, field.value])
  )
  // PostgreSQL owns the exact canonical bytes used by the durable content
  // hash. This string is ephemeral: validate it against a fresh, independent
  // projection before it may become provider content. It is never included in
  // worker results, completion/failure RPCs, logs, or operational events.
  let returnedProjection: unknown
  try {
    returnedProjection = JSON.parse(parsed.data.projectedContent) as unknown
  } catch (error) {
    throw new ContextProjectionError("projected_content_invalid", {
      cause: error,
    })
  }
  if (
    stableStringify(returnedProjection) !== stableStringify(projectedObject)
  ) {
    throw new ContextProjectionError("projected_content_hash_mismatch")
  }
  const content = parsed.data.projectedContent
  const contentBytes = Buffer.byteLength(content, "utf8")
  if (contentBytes > policy.maximumContentBytes || content.length > 50_000) {
    throw new ContextProjectionError("projected_content_too_large")
  }
  const contentHash = sha256(content)
  if (
    event.expectedContentHash !== null &&
    event.expectedContentHash !== contentHash
  ) {
    throw new ContextProjectionError("projected_content_hash_mismatch")
  }

  return contextIndexProjectionSchema.parse({
    document: {
      requestId: event.id,
      provider: event.provider,
      scope: {
        companyId: event.companyId,
        workspaceScopeId: event.companyId,
      },
      stableCustomId: event.stableCustomId,
      canonicalRecordId: record.id,
      canonicalRecordVersion: record.canonicalRecordVersion,
      sourceId: record.sourceId,
      sourceKey: record.sourceKey,
      recordType: record.recordType,
      externalId: record.externalId,
      containerTag: `company:${event.companyId}`,
      policyVersion: policy.policyVersion,
      policyHash: policy.policyHash,
      contentHash,
      content,
      observedAt: record.observedAt,
    },
    projectedFieldPaths: fields.map((field) => field.path),
    contentBytes,
  })
}

export function hashContextIndexContent(content: string): string {
  return sha256(content)
}

function readApprovedValue(root: Record<string, unknown>, pointer: string) {
  let current: unknown = root
  try {
    for (const segment of parseJsonPointer(pointer)) {
      if (Array.isArray(current)) {
        if (!/^(0|[1-9]\d*)$/.test(segment)) {
          throw new ContextProjectionError("approved_field_missing")
        }
        current = current[Number(segment)]
      } else if (
        current !== null &&
        typeof current === "object" &&
        Object.hasOwn(current, segment)
      ) {
        current = (current as Record<string, unknown>)[segment]
      } else {
        throw new ContextProjectionError("approved_field_missing")
      }
      if (current === undefined) {
        throw new ContextProjectionError("approved_field_missing")
      }
    }
  } catch (error) {
    if (error instanceof ContextProjectionError) throw error
    throw new ContextProjectionError("approved_field_missing", { cause: error })
  }
  assertSafeProjectedValue(current)
  return structuredClone(current)
}

function assertSafeProjectedValue(value: unknown): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ContextProjectionError("projected_content_invalid")
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach(assertSafeProjectedValue)
    return
  }
  if (typeof value !== "object") {
    throw new ContextProjectionError("projected_content_invalid")
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (unsafeObjectKeys.has(key) || unsafeFieldToken.test(normalized)) {
      throw new ContextProjectionError("approved_field_unsafe")
    }
    assertSafeProjectedValue(child)
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`
  }
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error("Value is not JSON serializable.")
  }
  return serialized
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
