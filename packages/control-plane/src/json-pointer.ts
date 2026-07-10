import {
  jsonPointerPatchSchema,
  jsonValueSchema,
  type JsonPointerPatch,
  type JsonValue,
} from "./schemas.js"

const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"])

export class JsonPointerError extends Error {
  constructor(
    readonly code:
      | "invalid_assignment"
      | "invalid_pointer"
      | "unsafe_pointer"
      | "target_not_found",
    message: string
  ) {
    super(message)
    this.name = "JsonPointerError"
  }
}

export function parseJsonPointer(pointer: string): string[] {
  if (pointer === "") return []
  if (!pointer.startsWith("/")) {
    throw new JsonPointerError(
      "invalid_pointer",
      "A JSON Pointer must be empty or begin with '/'."
    )
  }

  const segments = pointer
    .slice(1)
    .split("/")
    .map((segment) => decodeSegment(segment))

  for (const segment of segments) {
    if (forbiddenSegments.has(segment)) {
      throw new JsonPointerError(
        "unsafe_pointer",
        `The JSON Pointer segment '${segment}' is not allowed.`
      )
    }
  }

  return segments
}

export function parseJsonPointerAssignment(
  assignment: string
): JsonPointerPatch {
  const separator = assignment.indexOf("=")
  if (separator < 1) {
    throw new JsonPointerError(
      "invalid_assignment",
      "Assignments must use /json/pointer=<json-value>."
    )
  }

  const pointer = assignment.slice(0, separator)
  const sourceValue = assignment.slice(separator + 1)
  parseJsonPointer(pointer)

  let value: unknown
  try {
    value = JSON.parse(sourceValue) as unknown
  } catch {
    value = sourceValue
  }

  const parsedValue = jsonValueSchema.safeParse(value)
  if (!parsedValue.success) {
    throw new JsonPointerError(
      "invalid_assignment",
      "Assignment values must be JSON-serializable."
    )
  }

  return jsonPointerPatchSchema.parse({ pointer, value: parsedValue.data })
}

export function applyJsonPointerAssignments<T extends JsonValue>(
  value: T,
  patches: readonly JsonPointerPatch[]
): T {
  let result = cloneJson(value)
  for (const candidate of patches) {
    const patch = jsonPointerPatchSchema.parse(candidate)
    result = applyOne(result, patch) as T
  }
  return result
}

function applyOne(root: JsonValue, patch: JsonPointerPatch): JsonValue {
  const segments = parseJsonPointer(patch.pointer)
  if (segments.length === 0) return cloneJson(patch.value)

  const output = cloneJson(root)
  let target: JsonValue = output

  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(target)) {
      const index = parseArrayIndex(segment, target.length, false)
      const next = target[index]
      if (next === undefined || next === null || typeof next !== "object") {
        throw new JsonPointerError(
          "target_not_found",
          `JSON Pointer parent '${segment}' does not exist.`
        )
      }
      target = next
      continue
    }

    if (
      target === null ||
      typeof target !== "object" ||
      !Object.hasOwn(target, segment)
    ) {
      throw new JsonPointerError(
        "target_not_found",
        `JSON Pointer parent '${segment}' does not exist.`
      )
    }

    const next = target[segment]
    if (next === null || typeof next !== "object") {
      throw new JsonPointerError(
        "target_not_found",
        `JSON Pointer parent '${segment}' is not a container.`
      )
    }
    target = next
  }

  const finalSegment = segments.at(-1)
  if (finalSegment === undefined) return output

  if (Array.isArray(target)) {
    const index = parseArrayIndex(finalSegment, target.length, false)
    if (index >= target.length) {
      throw new JsonPointerError(
        "target_not_found",
        "JSON Pointer cannot extend an array."
      )
    }
    target[index] = cloneJson(patch.value)
    return output
  }

  if (
    target === null ||
    typeof target !== "object" ||
    !Object.hasOwn(target, finalSegment)
  ) {
    throw new JsonPointerError(
      "target_not_found",
      `JSON Pointer target '${finalSegment}' does not exist.`
    )
  }

  target[finalSegment] = cloneJson(patch.value)
  return output
}

function decodeSegment(segment: string): string {
  if (/~(?:[^01]|$)/.test(segment)) {
    throw new JsonPointerError(
      "invalid_pointer",
      "JSON Pointer contains an invalid escape sequence."
    )
  }
  return segment.replaceAll("~1", "/").replaceAll("~0", "~")
}

function parseArrayIndex(
  segment: string,
  length: number,
  allowAppend: boolean
): number {
  if (allowAppend && segment === "-") return length
  if (!/^(0|[1-9]\d*)$/.test(segment)) {
    throw new JsonPointerError(
      "invalid_pointer",
      `Array segment '${segment}' is not a valid index.`
    )
  }
  const index = Number(segment)
  if (!Number.isSafeInteger(index)) {
    throw new JsonPointerError(
      "invalid_pointer",
      "Array index exceeds the safe integer range."
    )
  }
  return index
}

function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value)
}
