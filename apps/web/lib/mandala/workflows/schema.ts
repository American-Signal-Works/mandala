import { z } from "zod"

const workflowKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/)
const workflowModeSchema = z.enum(["mock", "dry_run", "shadow"])
const workflowStatusSchema = z.enum(["draft", "active", "archived"])
const nodeKindSchema = z.enum([
  "source_sync",
  "validation",
  "routing",
  "context_assembly",
  "recommendation",
  "draft_action",
  "human_approval",
  "mock_execution",
  "audit",
])

const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5),
  backoffMs: z.number().int().min(0),
})

const traceSettingsSchema = z.object({
  langsmith: z.boolean(),
  langgraph: z.object({
    threadCorrelation: z.boolean(),
    checkpointCorrelation: z.boolean(),
  }),
  eventName: workflowKeySchema,
})

const nodeValueTypeSchema = z.enum([
  "boolean",
  "integer",
  "json",
  "number",
  "string",
  "timestamp",
  "uuid",
])
const nodeDataContractSchema = z.object({
  schemaVersion: z.literal("1"),
  type: z.literal("object"),
  fields: z.record(workflowKeySchema, nodeValueTypeSchema),
})
const nodeErrorClassificationSchema = z.enum([
  "authorization",
  "permanent",
  "transient",
  "validation",
])

export const workflowNodeSchema = z.object({
  id: workflowKeySchema,
  kind: nodeKindSchema,
  title: z.string().min(1),
  allowedTools: z.array(workflowKeySchema),
  timeoutMs: z.number().int().min(1_000),
  retry: retryPolicySchema,
  idempotencyRequired: z.boolean(),
  inputContract: nodeDataContractSchema,
  outputContract: nodeDataContractSchema,
  errorPolicy: z.object({
    classifications: z.array(nodeErrorClassificationSchema).min(1),
    retryable: z.array(nodeErrorClassificationSchema),
    onExhausted: z.enum(["block", "fail", "request_rework"]),
  }),
  audit: z.object({
    startedEvent: workflowKeySchema,
    completedEvent: workflowKeySchema,
    failedEvent: workflowKeySchema,
  }),
  trace: traceSettingsSchema,
})

export const workflowSpecSchema = z.object({
  workflowKey: workflowKeySchema,
  workflowType: workflowKeySchema,
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: workflowStatusSchema,
  defaultMode: workflowModeSchema,
  triggers: z.array(
    z.object({
      id: workflowKeySchema,
      kind: z.enum(["manual", "fixture", "schedule", "webhook"]),
      description: z.string().min(1),
    })
  ),
  dataSources: z.array(
    z.object({
      id: workflowKeySchema,
      description: z.string().min(1),
      required: z.boolean(),
    })
  ),
  nodes: z.array(workflowNodeSchema).min(1),
  evidenceRequirements: z.array(z.string().min(1)),
  approvalRules: z.array(
    z.object({
      actionType: workflowKeySchema,
      minimumRole: z.enum(["owner", "admin", "approver"]),
      requireHumanApproval: z.boolean(),
      requireWarningAcknowledgement: z.boolean(),
    })
  ),
  allowedActions: z.array(
    z.object({
      actionType: workflowKeySchema,
      mode: workflowModeSchema,
      requiresApproval: z.boolean(),
    })
  ),
})

export type WorkflowSpec = z.infer<typeof workflowSpecSchema>
export type WorkflowNode = z.infer<typeof workflowNodeSchema>
export type WorkflowMode = z.infer<typeof workflowModeSchema>

export type WorkflowSkillCompileResult =
  | {
      ok: true
      spec: WorkflowSpec
      warnings: string[]
    }
  | {
      ok: false
      errors: string[]
      warnings: string[]
    }

export type WorkflowSkillAdapter = {
  workflowType: string
  requiredSections: readonly string[]
  compile: (
    frontmatter: Readonly<Record<string, string>>,
    markdown: string
  ) => WorkflowSpec
}

export function compileWorkflowSkillMarkdown(
  markdown: string,
  adapters: readonly WorkflowSkillAdapter[]
): WorkflowSkillCompileResult {
  const warnings: string[] = []
  const errors: string[] = []
  const frontmatter = parseFrontmatter(markdown)

  if (!frontmatter) {
    errors.push("Skill file is missing YAML-style frontmatter.")
  }

  const unsafeInstruction = findUnsafeInstruction(markdown)
  if (unsafeInstruction) {
    errors.push(`Unsafe instruction rejected: ${unsafeInstruction}`)
  }

  const adapter = adapters.find(
    (candidate) => candidate.workflowType === frontmatter?.workflow_type
  )
  for (const heading of adapter?.requiredSections ?? []) {
    if (!extractHeadingBody(markdown, heading)) {
      errors.push(`Missing required section: ${heading}.`)
    }
  }

  if (frontmatter && frontmatter.kind !== "agent_workflow") {
    errors.push("Only kind: agent_workflow skill files are supported.")
  }

  if (frontmatter?.default_mode && frontmatter.default_mode !== "mock") {
    errors.push(
      "Only default_mode: mock is allowed in the Slice 1 skill compiler."
    )
  }

  if (!frontmatter?.workflow_type || !adapter) {
    errors.push(
      `No approved workflow adapter exists for workflow_type: ${frontmatter?.workflow_type ?? "missing"}.`
    )
  }

  if (errors.length > 0) return { ok: false, errors, warnings }

  const spec = workflowSpecSchema.parse(
    adapter!.compile(frontmatter!, markdown)
  )

  return { ok: true, spec, warnings }
}

function parseFrontmatter(markdown: string): Record<string, string> | null {
  const normalized = markdown.replace(/\r\n/g, "\n")
  if (!normalized.startsWith("---\n")) return null

  const end = normalized.indexOf("\n---", 4)
  if (end === -1) return null

  const frontmatter = normalized.slice(4, end).trim()
  const values: Record<string, string> = {}
  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/)
    if (!match) continue
    values[match[1]!.trim()] = match[2]!.trim().replace(/^["']|["']$/g, "")
  }
  return values
}

function extractHeadingBody(markdown: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = markdown.match(
    new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\s*$)`, "im")
  )
  const body = match?.[1]?.trim()
  return body ? body : null
}

function findUnsafeInstruction(markdown: string): string | null {
  const unsafePatterns: Array<[RegExp, string]> = [
    [/\blive\b/i, "live execution"],
    [/\bservice[_ -]?role\b/i, "service-role escalation"],
    [/\bbypass\s+approval\b/i, "approval bypass"],
    [/\bexternal\s+write\b/i, "external writes"],
    [/\bsend\s+(email|vendor\s+email)\b/i, "sending external email"],
    [/\bshiphero\b/i, "live ShipHero action"],
    [/\bshopify\b.*\bwrite\b/i, "live Shopify write"],
  ]

  for (const [pattern, label] of unsafePatterns) {
    if (pattern.test(markdown)) return label
  }
  return null
}
