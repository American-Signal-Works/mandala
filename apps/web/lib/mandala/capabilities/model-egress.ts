import type { CompiledCapabilityBinding } from "../skills/compiler"

const unsafeSegments = new Set(["__proto__", "constructor", "prototype"])

export function projectCapabilityDataForModel(input: {
  data: Record<string, unknown>
  bindings: readonly CompiledCapabilityBinding[]
}): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  for (const binding of input.bindings) {
    if (binding.access !== "read" || !binding.useInPrompt) continue
    const source = input.data[binding.alias]
    if (!source || typeof source !== "object") continue
    const target: Record<string, unknown> = {}
    for (const path of binding.modelAllowedPaths ?? []) {
      copyAllowedPath(source, target, parsePath(path), 0)
    }
    projected[binding.alias] = target
  }
  return projected
}

type PathPart = { key: string; array: boolean }

function parsePath(path: string): PathPart[] {
  const parts = path.split(".").map((part) => ({
    key: part.endsWith("[]") ? part.slice(0, -2) : part,
    array: part.endsWith("[]"),
  }))
  if (
    parts.length === 0 ||
    parts.length > 12 ||
    parts.some(
      (part) =>
        !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(part.key) ||
        unsafeSegments.has(part.key)
    )
  ) {
    throw new Error("Capability model-egress path is invalid.")
  }
  return parts
}

function copyAllowedPath(
  source: unknown,
  target: Record<string, unknown>,
  parts: PathPart[],
  index: number
): void {
  if (!isRecord(source)) return
  const part = parts[index]
  if (!part || !Object.hasOwn(source, part.key)) return
  const value = source[part.key]
  const terminal = index === parts.length - 1

  if (part.array) {
    if (!Array.isArray(value)) return
    if (value.length > 5_000) throw new Error("Capability model-egress row limit exceeded.")
    const rows = Array.isArray(target[part.key])
      ? (target[part.key] as unknown[])
      : value.map(() => ({}))
    target[part.key] = rows
    if (terminal) return
    for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
      const existingRow = rows[rowIndex]
      const rowTarget: Record<string, unknown> = isRecord(existingRow)
        ? existingRow
        : {}
      rows[rowIndex] = rowTarget
      copyAllowedPath(value[rowIndex], rowTarget, parts, index + 1)
    }
    return
  }

  if (terminal) {
    if (isSafeScalar(value)) target[part.key] = value
    return
  }
  const existingChild = target[part.key]
  const childTarget: Record<string, unknown> = isRecord(existingChild)
    ? existingChild
    : {}
  target[part.key] = childTarget
  copyAllowedPath(value, childTarget, parts, index + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isSafeScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
}
