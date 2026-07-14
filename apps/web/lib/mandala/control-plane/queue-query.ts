import { z } from "zod"

export const DEFAULT_ACTIONABLE_STATUSES = [
  "active",
  "blocked",
  "approved",
] as const

const statusSchema = z.enum([
  "active",
  "blocked",
  "approved",
  "rejected",
  "executed",
  "resolved",
])
const roleSchema = z.enum([
  "owner",
  "admin",
  "approver",
  "member",
  "viewer",
  "agent",
])
const identifierSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const searchSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) =>
    [...value].every((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
  )
const sortKeySchema = z.enum(["priority", "createdAt", "updatedAt", "dueAt"])
const sortDirectionSchema = z.enum(["asc", "desc"])

export type NormalizedQueueQuery = {
  companyId: string
  search?: string
  statuses: Array<z.infer<typeof statusSchema>>
  itemTypes: string[]
  priorities: number[]
  sourceTypes: string[]
  ownerRoles: Array<z.infer<typeof roleSchema>>
  assigneeIds: string[]
  sort: {
    key: z.infer<typeof sortKeySchema>
    direction: z.infer<typeof sortDirectionSchema>
  }
  limit: number
  cursor?: string
}

export function parseQueueSearchParams(
  searchParams: URLSearchParams
):
  | { success: true; data: NormalizedQueueQuery }
  | { success: false; issues: Record<string, string[]> } {
  const raw = {
    companyId: searchParams.get("companyId"),
    search: searchParams.get("search") ?? undefined,
    statuses: aliasedCsv(searchParams, "statuses", "status"),
    itemTypes: aliasedCsv(searchParams, "itemTypes", "itemType"),
    priorities: aliasedCsv(searchParams, "priorities", "priority"),
    sourceTypes: aliasedCsv(searchParams, "sourceTypes", "sourceType"),
    ownerRoles: aliasedCsv(searchParams, "ownerRoles", "ownerRole"),
    assigneeIds: aliasedCsv(searchParams, "assigneeIds", "assigneeId"),
    sort: searchParams.get("sort") ?? undefined,
    sortKey: searchParams.get("sortKey") ?? undefined,
    sortDirection: searchParams.get("sortDirection") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
  }

  const duplicateAlias = Object.entries(raw)
    .filter(([, value]) => value === DUPLICATE_ALIAS)
    .map(([key]) => key)
  if (duplicateAlias.length > 0) {
    return {
      success: false,
      issues: Object.fromEntries(
        duplicateAlias.map((key) => [key, ["Use only one documented alias."]])
      ),
    }
  }

  const parsedSort = parseSort(raw.sort, raw.sortKey, raw.sortDirection)
  if (!parsedSort.success) return parsedSort

  const parsed = z
    .object({
      companyId: z.string().uuid(),
      search: searchSchema.optional(),
      statuses: csv(statusSchema, 6),
      itemTypes: csv(identifierSchema, 20),
      priorities: csv(z.coerce.number().int().min(0).max(100), 20),
      sourceTypes: csv(identifierSchema, 20),
      ownerRoles: csv(roleSchema, 20),
      assigneeIds: csv(z.string().uuid(), 20),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      cursor: z.string().min(1).max(4_096).optional(),
    })
    .safeParse({
      ...raw,
      sort: undefined,
      sortKey: undefined,
      sortDirection: undefined,
    })

  if (!parsed.success) {
    return { success: false, issues: parsed.error.flatten().fieldErrors }
  }

  return {
    success: true,
    data: {
      ...parsed.data,
      statuses: uniqueSorted(
        parsed.data.statuses ?? [...DEFAULT_ACTIONABLE_STATUSES]
      ),
      itemTypes: uniqueSorted(parsed.data.itemTypes ?? []),
      priorities: uniqueSorted(parsed.data.priorities ?? []),
      sourceTypes: uniqueSorted(parsed.data.sourceTypes ?? []),
      ownerRoles: uniqueSorted(parsed.data.ownerRoles ?? []),
      assigneeIds: uniqueSorted(parsed.data.assigneeIds ?? []),
      sort: parsedSort.data,
    },
  }
}

export function queueCursorBinding(query: NormalizedQueueQuery) {
  const binding = { ...query }
  delete binding.cursor
  return binding
}

const DUPLICATE_ALIAS = Symbol("duplicate-alias")

function aliasedCsv(
  searchParams: URLSearchParams,
  plural: string,
  singular: string
): string | typeof DUPLICATE_ALIAS | undefined {
  const pluralValue = searchParams.get(plural)
  const singularValue = searchParams.get(singular)
  if (pluralValue !== null && singularValue !== null) return DUPLICATE_ALIAS
  return pluralValue ?? singularValue ?? undefined
}

function csv<T>(schema: z.ZodType<T>, max: number) {
  return z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(schema).min(1).max(max))
    .optional()
}

function uniqueSorted<T extends string | number>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) =>
    String(left).localeCompare(String(right))
  )
}

function parseSort(
  compact?: string | typeof DUPLICATE_ALIAS,
  key?: string,
  direction?: string
):
  | {
      success: true
      data: {
        key: z.infer<typeof sortKeySchema>
        direction: z.infer<typeof sortDirectionSchema>
      }
    }
  | { success: false; issues: Record<string, string[]> } {
  if (compact && (key || direction)) {
    return {
      success: false,
      issues: { sort: ["Use either sort or sortKey/sortDirection."] },
    }
  }
  const [compactKey, compactDirection, extra] =
    typeof compact === "string" ? compact.split(":") : []
  if (extra !== undefined) {
    return { success: false, issues: { sort: ["Invalid sort grammar."] } }
  }
  const parsed = z
    .object({ key: sortKeySchema, direction: sortDirectionSchema })
    .safeParse({
      key: compactKey ?? key ?? "priority",
      direction: compactDirection ?? direction ?? "desc",
    })
  if (!parsed.success) {
    return { success: false, issues: parsed.error.flatten().fieldErrors }
  }
  return { success: true, data: parsed.data }
}
