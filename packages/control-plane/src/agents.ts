import { z } from "zod"
import {
  companyRoleSchema,
  isoTimestampSchema,
  jsonObjectSchema,
  jsonValueSchema,
} from "./schemas.js"

export const agentLifecycleStatusSchema = z.enum([
  "draft",
  "ready",
  "active",
  "inactive",
  "paused",
  "disabled",
  "archived",
  "invalid",
])

export const agentDiagnosticSchema = z
  .object({
    severity: z.enum(["error", "warning"]),
    code: z.string().min(1).max(200),
    path: z.string().min(1).max(500),
    message: z.string().min(1).max(2_000),
    resolution: z.string().min(1).max(2_000).optional(),
  })
  .strict()

export const agentCapabilitySummarySchema = z
  .object({
    id: z.string().min(1).max(200),
    alias: z.string().min(1).max(200),
    access: z.enum(["read", "propose", "execute"]),
    version: z.string().min(1).max(40),
    connectorId: z.string().min(1).max(200).nullable(),
    status: z.enum([
      "resolved",
      "missing",
      "ambiguous",
      "unhealthy",
      "unauthorized",
      "schema_drift",
    ]),
  })
  .strict()

export const agentSummarySchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    workflowKey: z.string().min(1).max(200),
    workflowType: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    version: z.string().min(1).max(40),
    status: agentLifecycleStatusSchema,
    skillSchemaVersion: z.string().min(1).max(40),
    compilerVersion: z.string().min(1).max(40),
    skillDigest: z.string().regex(/^[0-9a-f]{64}$/),
    manifestDigest: z.string().regex(/^[0-9a-f]{64}$/),
    stateVersion: z.number().int().positive(),
    active: z.boolean(),
    capabilities: z.array(agentCapabilitySummarySchema),
    diagnostics: z.array(agentDiagnosticSchema),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()

export const agentListRequestSchema = z
  .object({ companyId: z.string().uuid() })
  .strict()
export const agentListResponseSchema = z
  .object({ agents: z.array(agentSummarySchema) })
  .strict()

export const agentInstallRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    skillMarkdown: z.string().min(1).max(250_000),
    activate: z.boolean().default(false),
  })
  .strict()

export const agentValidateRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    skillMarkdown: z.string().min(1).max(250_000),
  })
  .strict()

export const agentValidateResponseSchema = z
  .object({
    valid: z.boolean(),
    diagnostics: z.array(agentDiagnosticSchema),
    preview: z
      .object({
        workflowKey: z.string().min(1).max(200),
        workflowType: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        version: z.string().min(1).max(40),
        sourceDigest: z.string().regex(/^[0-9a-f]{64}$/),
        manifestDigest: z.string().regex(/^[0-9a-f]{64}$/),
        graph: z.array(
          z
            .object({
              id: z.string(),
              handler: z.string(),
              allowedTools: z.array(z.string()),
            })
            .passthrough()
        ),
        capabilities: z.array(agentCapabilitySummarySchema),
      })
      .strict()
      .nullable(),
  })
  .strict()

export const agentInstallResponseSchema = z
  .object({ agent: agentSummarySchema, created: z.boolean() })
  .strict()

export const agentActionRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2_000),
    version: z.string().min(1).max(40).optional(),
  })
  .strict()

export const agentActionResponseSchema = z
  .object({ agent: agentSummarySchema, action: z.string().min(1).max(100) })
  .strict()

export const agentTestRunRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    seed: z.string().min(1).max(200).optional(),
  })
  .strict()

export const agentTestRunResponseSchema = z
  .object({
    agentId: z.string().uuid(),
    workflowRunId: z.string().uuid(),
    status: z.enum([
      "blocked",
      "suppressed",
      "waiting_for_approval",
      "completed",
    ]),
    itemId: z.string().uuid().nullable(),
    dataset: jsonObjectSchema.optional(),
    result: jsonValueSchema.optional(),
  })
  .strict()

export const agentManualRunRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict()

export const agentManualRunResponseSchema = z
  .object({
    agentId: z.string().uuid(),
    workflowRunId: z.string().uuid(),
    status: z.enum([
      "blocked",
      "suppressed",
      "waiting_for_approval",
      "completed",
    ]),
    itemId: z.string().uuid().nullable(),
    entity: z
      .object({ key: z.string().min(1), value: z.string().min(1) })
      .strict(),
    result: jsonValueSchema.optional(),
  })
  .strict()

export const agentLifecycleEventSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    agentId: z.string().uuid(),
    action: z.enum([
      "installed",
      "validated",
      "tested",
      "activated",
      "paused",
      "resumed",
      "disabled",
      "deactivated",
      "rolled_back",
    ]),
    actorId: z.string().uuid(),
    actorRole: companyRoleSchema,
    details: jsonObjectSchema,
    createdAt: isoTimestampSchema,
  })
  .strict()

export type AgentSummary = z.infer<typeof agentSummarySchema>
export type AgentInstallRequest = z.infer<typeof agentInstallRequestSchema>
export type AgentValidateRequest = z.infer<typeof agentValidateRequestSchema>
export type AgentValidateResponse = z.infer<typeof agentValidateResponseSchema>
export type AgentActionRequest = z.infer<typeof agentActionRequestSchema>
export type AgentTestRunRequest = z.infer<typeof agentTestRunRequestSchema>
export type AgentManualRunRequest = z.infer<typeof agentManualRunRequestSchema>
export type AgentManualRunResponse = z.infer<
  typeof agentManualRunResponseSchema
>
