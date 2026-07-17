import { z } from "zod"

export const skillSchemaVersion = "mandala.ai/v1" as const
export const skillCompilerVersion = "1.0.0" as const

const keySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)
const fieldKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/)
const pathSegmentSchema = z.string().regex(/^[A-Za-z0-9_-]+$/)
const pathSchema = z
  .string()
  .regex(/^(trigger|data|agent|rules|context)(\.[a-zA-Z0-9_-]+)+$/)

export const valueSourceSchema = z.union([
  z.object({ path: pathSchema }).strict(),
  z
    .object({ value: z.union([z.string(), z.number(), z.boolean(), z.null()]) })
    .strict(),
])

export const comparisonSchema = z
  .object({
    left: valueSourceSchema,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in"]),
    right: valueSourceSchema,
  })
  .strict()

const expressionSchema: z.ZodType<SkillExpression> = z.lazy(() =>
  z.union([
    valueSourceSchema,
    z
      .object({
        operator: z.enum([
          "add",
          "subtract",
          "multiply",
          "divide",
          "min",
          "max",
        ]),
        operands: z.array(expressionSchema).min(2).max(12),
      })
      .strict(),
  ])
)

export type SkillExpression =
  | z.infer<typeof valueSourceSchema>
  | {
      operator: "add" | "subtract" | "multiply" | "divide" | "min" | "max"
      operands: SkillExpression[]
    }

const ruleBase = z.object({
  id: keySchema,
  outcome: z
    .object({
      when: z.enum(["true", "false"]),
      effect: z.enum(["block", "suppress", "warn"]),
      message: z.string().min(1).max(500),
    })
    .strict()
    .optional(),
})

const triggerBase = {
  id: keySchema,
  description: z.string().min(1).max(300),
}

const workflowTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ ...triggerBase, kind: z.literal("manual") }).strict(),
  z.object({ ...triggerBase, kind: z.literal("fixture") }).strict(),
  z
    .object({
      ...triggerBase,
      kind: z.literal("schedule"),
      every_minutes: z.number().int().min(1).max(10_080),
    })
    .strict(),
  z
    .object({
      ...triggerBase,
      kind: z.literal("webhook"),
      source_kinds: z.array(keySchema).max(20).default([]),
      record_types: z.array(keySchema).min(1).max(50),
      changes: z
        .array(z.enum(["insert", "update", "delete"]))
        .min(1)
        .max(3)
        .default(["insert", "update"]),
      reconcile_every_minutes: z.number().int().min(5).max(10_080).default(60),
    })
    .strict(),
])

export const skillRuleSchema = z.discriminatedUnion("operation", [
  ruleBase
    .extend({
      operation: z.literal("required_fields"),
      source: pathSchema,
      fields: z.array(fieldKeySchema).min(1),
    })
    .strict(),
  ruleBase
    .extend({
      operation: z.literal("filter"),
      source: pathSchema,
      all: z.array(comparisonSchema).min(1),
      output: pathSchema,
    })
    .strict(),
  ruleBase
    .extend({
      operation: z.literal("compare"),
      condition: comparisonSchema,
      output: pathSchema,
    })
    .strict(),
  ruleBase
    .extend({
      operation: z.literal("aggregate"),
      source: pathSchema,
      function: z.enum(["count", "sum", "average", "min", "max"]),
      field: fieldKeySchema.optional(),
      output: pathSchema,
    })
    .strict(),
  ruleBase
    .extend({
      operation: z.literal("freshness"),
      age_hours: valueSourceSchema,
      maximum_hours: z.number().nonnegative().max(8_760),
      output: pathSchema,
    })
    .strict(),
  ruleBase
    .extend({
      operation: z.literal("duplicate_check"),
      quantity: valueSourceSchema,
      allowed_maximum: z.number().nonnegative(),
      output: pathSchema,
    })
    .strict(),
  ruleBase
    .extend({
      operation: z.literal("threshold"),
      value: valueSourceSchema,
      operator: z.enum(["gt", "gte", "lt", "lte"]),
      threshold: z.number(),
      output: pathSchema,
    })
    .strict(),
  ruleBase
    .extend({
      operation: z.literal("formula"),
      expression: expressionSchema,
      output: pathSchema,
      precision: z.number().int().min(0).max(8).optional(),
    })
    .strict(),
  ruleBase
    .extend({
      operation: z.literal("round_to_pack"),
      quantity: valueSourceSchema,
      pack_size: valueSourceSchema,
      minimum: valueSourceSchema.optional(),
      output: pathSchema,
    })
    .strict(),
  ruleBase
    .extend({
      operation: z.literal("priority"),
      bands: z
        .array(
          z
            .object({
              when: comparisonSchema,
              value: z.number().int().min(0).max(100),
            })
            .strict()
        )
        .max(20),
      default: z.number().int().min(0).max(100),
      output: pathSchema,
    })
    .strict(),
])

export type SkillProjectionValue =
  | z.infer<typeof valueSourceSchema>
  | { template: string }
  | { object: Record<string, SkillProjectionValue> }
  | { array: SkillProjectionValue[] }

const projectionValueSchema: z.ZodType<SkillProjectionValue> = z.lazy(() =>
  z.union([
    valueSourceSchema,
    z.object({ template: z.string().min(1).max(2_000) }).strict(),
    z
      .object({ object: z.record(fieldKeySchema, projectionValueSchema) })
      .strict(),
    z.object({ array: z.array(projectionValueSchema).max(200) }).strict(),
  ])
)

const editPolicySchema = z
  .object({
    editable: z.boolean(),
    require_reason: z.boolean(),
    immutable_paths: z.array(z.array(pathSegmentSchema).min(1)).default([]),
    array_length_paths: z.array(z.array(pathSegmentSchema).min(1)).default([]),
    positive_integer_paths: z
      .array(z.array(pathSegmentSchema).min(1))
      .default([]),
    non_empty_string_paths: z
      .array(z.array(pathSegmentSchema).min(1))
      .default([]),
  })
  .strict()

export const agentSkillSchema = z
  .object({
    api_version: z.literal(skillSchemaVersion),
    kind: z.literal("agent_workflow"),
    metadata: z
      .object({
        id: keySchema,
        name: z.string().min(1).max(120),
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        description: z.string().min(1).max(500),
      })
      .strict(),
    workflow: z
      .object({
        type: keySchema,
        status: z.enum(["draft", "active", "archived"]).default("draft"),
        default_mode: z.enum(["mock", "dry_run", "shadow"]).default("mock"),
        triggers: z.array(workflowTriggerSchema).min(1).max(50),
      })
      .strict(),
    capabilities: z
      .array(
        z
          .object({
            id: keySchema,
            as: keySchema,
            access: z.enum(["read", "propose", "execute"]),
            version: z.string().regex(/^\d+\.\d+\.\d+$/),
            required: z.boolean().default(true),
            use_in_prompt: z.boolean().default(false),
            description: z.string().min(1).max(300),
          })
          .strict()
      )
      .min(1),
    rules: z.array(skillRuleSchema).max(100),
    records: z
      .object({
        item: z
          .object({
            type: keySchema,
            key: projectionValueSchema,
            title: projectionValueSchema,
            priority: projectionValueSchema,
            related: z
              .record(fieldKeySchema, projectionValueSchema)
              .default({}),
          })
          .strict(),
        recommendation: z
          .object({
            rationale: projectionValueSchema,
            confidence: projectionValueSchema,
            output: z.record(fieldKeySchema, projectionValueSchema),
          })
          .strict(),
        draft: z
          .object({
            action: keySchema,
            payload: z.record(fieldKeySchema, projectionValueSchema),
            edit_policy: editPolicySchema,
          })
          .strict()
          .optional(),
      })
      .strict(),
    evidence: z
      .object({
        requirements: z.array(z.string().min(1).max(300)).min(1),
        assumptions: z.array(z.string().min(1).max(500)).max(30).default([]),
        source_capabilities: z.array(keySchema).min(1),
      })
      .strict(),
    approvals: z
      .array(
        z
          .object({
            action: keySchema,
            minimum_role: z.enum(["owner", "admin", "approver"]),
            human_required: z.literal(true),
            warning_acknowledgement: z.boolean(),
          })
          .strict()
      )
      .max(20),
    actions: z
      .array(
        z
          .object({
            id: keySchema,
            capability: keySchema,
            mode: z.enum(["mock", "dry_run", "shadow"]),
            requires_approval: z.literal(true),
          })
          .strict()
      )
      .max(20),
    tests: z
      .array(
        z
          .object({
            id: keySchema,
            description: z.string().min(1).max(300),
            expect: z.enum(["review", "blocked", "suppressed"]),
          })
          .strict()
      )
      .max(30)
      .default([]),
  })
  .strict()
  .superRefine((skill, context) => {
    const triggerIds = new Set<string>()
    for (const [index, trigger] of skill.workflow.triggers.entries()) {
      if (triggerIds.has(trigger.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "triggers", index, "id"],
          message: `Trigger ${trigger.id} is duplicated.`,
        })
      }
      triggerIds.add(trigger.id)
    }

    const aliases = new Set<string>()
    const capabilityIds = new Set<string>()
    for (const [index, capability] of skill.capabilities.entries()) {
      if (aliases.has(capability.as)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capabilities", index, "as"],
          message: `Capability alias ${capability.as} is duplicated.`,
        })
      }
      aliases.add(capability.as)
      if (capabilityIds.has(capability.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capabilities", index, "id"],
          message: `Capability ${capability.id} is declared more than once.`,
        })
      }
      capabilityIds.add(capability.id)
    }

    const actionIds = new Set(skill.actions.map((action) => action.id))
    if (skill.records.draft && !actionIds.has(skill.records.draft.action)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["records", "draft", "action"],
        message: `Draft references unknown action ${skill.records.draft.action}.`,
      })
    }
    for (const [
      index,
      capabilityId,
    ] of skill.evidence.source_capabilities.entries()) {
      if (!capabilityIds.has(capabilityId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", "source_capabilities", index],
          message: `Evidence references undeclared capability ${capabilityId}.`,
        })
      }
    }
    for (const [index, approval] of skill.approvals.entries()) {
      if (!actionIds.has(approval.action)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["approvals", index, "action"],
          message: `Approval references unknown action ${approval.action}.`,
        })
      }
    }

    for (const [index, action] of skill.actions.entries()) {
      const requirement = skill.capabilities.find(
        (candidate) => candidate.id === action.capability
      )
      if (!requirement || requirement.access === "read") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", index, "capability"],
          message: `Action ${action.id} requires a declared propose or execute capability.`,
        })
      }
      if (
        action.requires_approval &&
        !skill.approvals.some((approval) => approval.action === action.id)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actions", index, "requires_approval"],
          message: `Action ${action.id} requires an approval rule.`,
        })
      }
    }

    for (const [index, rule] of skill.rules.entries()) {
      if (
        rule.operation === "aggregate" &&
        rule.function !== "count" &&
        !rule.field
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index, "field"],
          message: `${rule.function} requires a field.`,
        })
      }
    }
  })

export type AgentSkill = z.infer<typeof agentSkillSchema>
export type SkillRule = z.infer<typeof skillRuleSchema>
export type SkillValueSource = z.infer<typeof valueSourceSchema>
export type SkillComparison = z.infer<typeof comparisonSchema>
