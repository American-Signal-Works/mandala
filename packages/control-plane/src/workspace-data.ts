import { z } from "zod"

const identifier = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const fieldIdentifier = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
  .refine(
    (value) => !new Set(["__proto__", "constructor", "prototype"]).has(value),
    "Unsafe field name."
  )
const jsonPointer = z
  .string()
  .refine(
    (value) =>
      value === "" || /^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/.test(value),
    "Expected an RFC 6901 JSON pointer."
  )

export const workspaceDatasetSpecSchema = z
  .object({
    alias: identifier,
    recordType: z.string().min(1).max(150),
    sourceKey: z.string().min(1).max(150).optional(),
    rowsPath: jsonPointer.optional(),
    entityPath: jsonPointer,
    maximumFreshnessHours: z.number().int().min(1).max(8_760).default(72),
    required: z.boolean().default(true),
  })
  .strict()

export const workspaceMappingFilterSchema = z
  .object({
    path: jsonPointer,
    operator: z.enum([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "within_days",
      "not_within_days",
      "non_empty",
    ]),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  })
  .strict()

type WorkspaceMappingExpressionInput =
  | {
      op: "literal"
      value: string | number | boolean | null
      confirmed: true
    }
  | {
      op: "first" | "sum" | "min" | "max" | "count" | "age_hours"
      dataset: string
      path?: string
      where?: Array<z.infer<typeof workspaceMappingFilterSchema>>
    }
  | {
      op:
        | "add"
        | "subtract"
        | "multiply"
        | "divide"
        | "max_of"
        | "min_of"
        | "coalesce"
      operands: WorkspaceMappingExpressionInput[]
    }

export const workspaceMappingExpressionSchema: z.ZodType<WorkspaceMappingExpressionInput> =
  z.lazy(() =>
    z.union([
      z
        .object({
          op: z.literal("literal"),
          value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
          confirmed: z.literal(true),
        })
        .strict(),
      z
        .object({
          op: z.enum(["first", "sum", "min", "max", "count", "age_hours"]),
          dataset: identifier,
          path: jsonPointer.optional(),
          where: z.array(workspaceMappingFilterSchema).max(12).optional(),
        })
        .strict(),
      z
        .object({
          op: z.enum([
            "add",
            "subtract",
            "multiply",
            "divide",
            "max_of",
            "min_of",
            "coalesce",
          ]),
          operands: z.array(workspaceMappingExpressionSchema).min(1).max(12),
        })
        .strict(),
    ])
  )

export const workspaceOutputFieldSchema = z
  .object({
    name: fieldIdentifier,
    expression: workspaceMappingExpressionSchema,
    required: z.boolean().default(true),
    modelAllowed: z.boolean().default(false),
    classification: z.enum([
      "public",
      "internal",
      "confidential",
      "restricted",
    ]),
  })
  .strict()

export const workspaceSignalConditionSchema = z
  .object({
    left: fieldIdentifier,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    right: z.union([
      z.object({ field: fieldIdentifier }).strict(),
      z
        .object({ value: z.union([z.string(), z.number(), z.boolean()]) })
        .strict(),
    ]),
  })
  .strict()

export const workspaceCapabilityMappingSpecSchema = z
  .object({
    schemaVersion: z.literal("mandala.workspace-data/v1"),
    capabilityKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,149}$/),
    capabilityVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    datasets: z.array(workspaceDatasetSpecSchema).min(1).max(20),
    output: z
      .object({
        collection: fieldIdentifier,
        entityKey: fieldIdentifier,
        fields: z.array(workspaceOutputFieldSchema).min(1).max(100),
      })
      .strict(),
    signal: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,149}$/),
        all: z.array(workspaceSignalConditionSchema).min(1).max(20),
      })
      .strict()
      .optional(),
    bounds: z
      .object({
        maximumInputRows: z.number().int().min(1).max(10_000),
        maximumOutputRows: z.number().int().min(1).max(1_000),
        maximumOutputBytes: z.number().int().min(1_024).max(10_485_760),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const aliases = value.datasets.map(({ alias }) => alias)
    if (new Set(aliases).size !== aliases.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["datasets"],
        message: "Dataset aliases must be unique.",
      })
    }
    const fields = value.output.fields.map(({ name }) => name)
    if (new Set(fields).size !== fields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["output", "fields"],
        message: "Output field names must be unique.",
      })
    }
    if (!fields.includes(value.output.entityKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["output", "entityKey"],
        message: "The entity key must be a declared output field.",
      })
    }
    for (const field of value.output.fields) {
      for (const alias of expressionDatasets(field.expression)) {
        if (!aliases.includes(alias)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["output", "fields", field.name],
            message: `Expression references undeclared dataset ${alias}.`,
          })
        }
      }
    }
  })

export const workspaceCatalogEntrySchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    sourceId: z.string().uuid(),
    sourceKey: z.string(),
    recordType: z.string(),
    recordCount: z.number().int().nonnegative(),
    freshestObservedAt: z.string().datetime().nullable(),
    fieldProfile: z.array(z.unknown()),
    relationshipProfile: z.array(z.unknown()),
    schemaHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    catalogVersion: z.number().int().positive(),
    profileStatus: z.enum(["pending", "ready", "drifted", "detached"]),
  })
  .strict()

export const workspaceMappingVersionSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    mappingKey: z.string(),
    version: z.number().int().positive(),
    capabilityVersionId: z.string().uuid(),
    status: z.enum([
      "proposed",
      "needs_confirmation",
      "validated",
      "invalidated",
    ]),
    confidence: z.number().min(0).max(1),
    spec: workspaceCapabilityMappingSpecSchema,
    specHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

const sandboxDeliverableSchema = z
  .object({
    item: z
      .object({
        type: z.string(),
        key: z.string(),
        title: z.string(),
        priority: z.number().int().min(0).max(100),
        related: z.record(z.string(), z.unknown()),
      })
      .strict(),
    recommendation: z
      .object({
        rationale: z.string(),
        confidence: z.number().min(0).max(1),
        output: z.record(z.string(), z.unknown()),
      })
      .strict(),
    draft: z
      .object({
        action: z.string(),
        payload: z.record(z.string(), z.unknown()),
        editPolicy: z.record(z.string(), z.unknown()),
      })
      .strict()
      .nullable(),
    evidence: z
      .object({
        requirements: z.array(z.string()),
        assumptions: z.array(z.string()),
        sourceCapabilities: z.array(z.string()),
        sourceRefs: z.array(z.unknown()),
      })
      .strict(),
  })
  .strict()

export const workspaceSandboxRunRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    skillMarkdown: z.string().min(1).max(250_000),
    confirmMappings: z.boolean().default(false),
  })
  .strict()

export const workspaceSandboxRunResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("sandbox"),
    ephemeral: z.literal(true),
    companyId: z.string().uuid(),
    sessionId: z.string().uuid(),
    catalog: z
      .object({
        datasets: z.number().int().nonnegative(),
        records: z.number().int().nonnegative(),
        freshestObservedAt: z.string().datetime().nullable(),
      })
      .strict(),
    mappings: z.array(
      z
        .object({
          requirementKey: z.string(),
          capabilityKey: z.string(),
          mappingVersionId: z.string().uuid(),
          version: z.number().int().positive(),
          status: z.literal("validated"),
          confidence: z.number().min(0).max(1),
        })
        .strict()
    ),
    agent: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        version: z.string(),
        active: z.literal(false),
        manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
        bindingSnapshotId: z.string().uuid(),
      })
      .strict(),
    signal: z
      .object({
        id: z.string(),
        entityKey: z.string(),
        entityValue: z.string(),
        detectedAt: z.string().datetime(),
        evidence: z.record(z.string(), z.unknown()),
      })
      .strict(),
    harness: z
      .object({
        workflowRunId: z.string().uuid(),
        status: z.enum([
          "blocked",
          "suppressed",
          "waiting_for_approval",
          "completed",
        ]),
        graphNodes: z.array(z.string()),
      })
      .strict(),
    deliverable: sandboxDeliverableSchema.nullable(),
    proof: z
      .object({
        scope: z.literal("sandbox_execution"),
        beforeDigest: z.string().regex(/^[a-f0-9]{64}$/),
        afterDigest: z.string().regex(/^[a-f0-9]{64}$/),
        unchanged: z.boolean(),
        persistenceWrites: z.literal(0),
        externalWriteAttempts: z.literal(0),
        monitoredTables: z.array(z.string()),
        setupCompletedBeforeBaseline: z.literal(true),
      })
      .strict(),
  })
  .strict()

export type WorkspaceCapabilityMappingSpec = z.infer<
  typeof workspaceCapabilityMappingSpecSchema
>
export type WorkspaceMappingExpression = z.infer<
  typeof workspaceMappingExpressionSchema
>
export type WorkspaceMappingFilter = z.infer<
  typeof workspaceMappingFilterSchema
>
export type WorkspaceCatalogEntry = z.infer<typeof workspaceCatalogEntrySchema>
export type WorkspaceMappingVersion = z.infer<
  typeof workspaceMappingVersionSchema
>
export type WorkspaceSandboxRunRequest = z.infer<
  typeof workspaceSandboxRunRequestSchema
>
export type WorkspaceSandboxRunResponse = z.infer<
  typeof workspaceSandboxRunResponseSchema
>

function expressionDatasets(expression: WorkspaceMappingExpression): string[] {
  if (expression.op === "literal") return []
  if ("dataset" in expression) return [expression.dataset]
  return expression.operands.flatMap(expressionDatasets)
}
