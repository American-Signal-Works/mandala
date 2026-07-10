import { createHash } from "node:crypto"

type HashField = boolean | null | number | string | undefined

export function deriveControlInputHash(
  kind: string,
  fields: Record<string, HashField>
): string {
  const normalized = Object.fromEntries(
    Object.entries(fields)
      .filter(
        (entry): entry is [string, Exclude<HashField, undefined>] =>
          entry[1] !== undefined
      )
      .sort(([left], [right]) => left.localeCompare(right))
  )
  return createHash("sha256")
    .update(JSON.stringify({ kind, fields: normalized }))
    .digest("hex")
}
