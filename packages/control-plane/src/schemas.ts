import { z } from "zod"

export type JsonPrimitive = boolean | null | number | string
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ])
)

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema)
export const modelProposalJsonScalarSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
export const identifierSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
export const idempotencyKeySchema = z
  .string()
  .regex(
    /^(cli|web|api):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
export const isoTimestampSchema = z.string().datetime({ offset: true })
export const companyRoleSchema = z.enum([
  "owner",
  "admin",
  "approver",
  "member",
  "viewer",
  "agent",
])
export const workflowItemStatusSchema = z.enum([
  "active",
  "blocked",
  "approved",
  "rejected",
  "executed",
  "resolved",
])
export const workflowDraftStatusSchema = z.enum([
  "pending_review",
  "approved",
  "rejected",
  "rework_requested",
  "executed",
])
export const decisionKindSchema = z.enum([
  "approve",
  "edit",
  "reject",
  "request_rework",
])
export const controlRiskSchema = z.enum([
  "read",
  "state_change",
  "mock_execution",
])
export const parserKindSchema = z.enum([
  "explicit",
  "deterministic",
  "langchain",
])
export const controlResolutionStatusSchema = z.enum([
  "resolved",
  "clarification_required",
  "blocked",
  "executed",
  "failed",
])

export const apiMetaSchema = z
  .object({
    requestId: z.string().min(1).max(200).optional(),
    controlRequestId: z.string().uuid().optional(),
    traceId: z.string().min(1).max(200).optional(),
  })
  .strict()

export const apiErrorSchema = z
  .object({
    code: identifierSchema,
    message: z.string().min(1).max(2_000).optional(),
    details: jsonObjectSchema.optional(),
  })
  .strict()

export const apiErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error: apiErrorSchema,
    meta: apiMetaSchema.optional(),
  })
  .strict()

export function apiSuccessEnvelopeSchema<T extends z.ZodTypeAny>(
  dataSchema: T
) {
  return z
    .object({
      ok: z.literal(true),
      data: dataSchema,
      meta: apiMetaSchema.optional(),
    })
    .strict()
}

export const companySummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200),
    role: companyRoleSchema,
    slug: z.string().min(1).max(200).optional(),
    updatedAt: isoTimestampSchema,
  })
  .strict()

export const companiesDataSchema = z
  .object({ companies: z.array(companySummarySchema) })
  .strict()
export const companiesResponseSchema = companiesDataSchema
export const companiesEnvelopeSchema =
  apiSuccessEnvelopeSchema(companiesDataSchema)

export const workflowActionDraftSchema = z
  .object({
    id: z.string().uuid(),
    workflowRunId: z.string().uuid(),
    workflowItemId: z.string().uuid(),
    actionType: identifierSchema,
    status: workflowDraftStatusSchema,
    payload: jsonObjectSchema,
    editPolicy: jsonObjectSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()

export const workflowDecisionSchema = z
  .object({
    id: z.string().uuid(),
    actionDraftId: z.string().uuid(),
    decision: decisionKindSchema,
    reason: z.string().max(2_000).nullable().optional(),
    warningsAcknowledged: z.boolean(),
    createdAt: isoTimestampSchema,
  })
  .strict()

export const workflowAttemptSchema = z
  .object({
    id: z.string().uuid(),
    actionDraftId: z.string().uuid(),
    decisionId: z.string().uuid(),
    actionType: identifierSchema,
    mode: z.literal("mock"),
    status: z.enum(["succeeded", "failed"]),
    resultPayload: jsonObjectSchema,
    mockExternalId: z.string().max(500).nullable(),
    errorMessage: z.string().max(2_000).nullable(),
    createdAt: isoTimestampSchema,
    completedAt: isoTimestampSchema.nullable(),
  })
  .strict()

export const workflowAuditEventSchema = z
  .object({
    id: z.string().uuid(),
    eventType: identifierSchema,
    summary: z.string().min(1).max(2_000),
    payload: jsonObjectSchema,
    trace: jsonObjectSchema,
    createdAt: isoTimestampSchema,
  })
  .strict()

export const workItemSummarySchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid().optional(),
    workflowRunId: z.string().uuid(),
    itemType: identifierSchema,
    title: z.string().min(1).max(500),
    status: workflowItemStatusSchema,
    priority: z.number().int(),
    resolutionState: jsonObjectSchema,
    warningCount: z.number().int().min(0).optional(),
    draft: z
      .object({
        id: z.string().uuid(),
        actionType: identifierSchema,
        status: workflowDraftStatusSchema,
        updatedAt: isoTimestampSchema,
      })
      .strict()
      .nullable(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()

const detailItemSchema = z
  .object({
    id: z.string().uuid(),
    workflowRunId: z.string().uuid(),
    itemType: identifierSchema,
    title: z.string().min(1).max(500),
    status: workflowItemStatusSchema,
    priority: z.number().int(),
    resolutionState: jsonObjectSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()

const contextPacketSchema = z
  .object({
    id: z.string().uuid(),
    sources: z.array(jsonObjectSchema),
    facts: jsonObjectSchema,
    memoryRefs: z.array(jsonObjectSchema),
    freshnessState: z.enum(["fresh", "stale", "unknown"]),
    warnings: z.array(z.string()),
    createdAt: isoTimestampSchema,
  })
  .strict()

const recommendationSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["ready_for_review", "blocked"]),
    rationaleSummary: z.string().max(5_000),
    warningState: z.enum(["pass", "warn", "blocked"]),
    warnings: z.array(z.string()),
    confidence: z.number().min(0).max(1).nullable(),
    freshnessState: z.enum(["fresh", "stale", "unknown"]),
    output: jsonObjectSchema,
    createdAt: isoTimestampSchema,
  })
  .strict()

const evidenceSchema = z
  .object({
    id: z.string().uuid(),
    sourceRefs: z.array(jsonObjectSchema),
    assumptions: z.array(z.string()),
    warnings: z.array(z.string()),
    evidence: z.array(jsonObjectSchema),
    createdAt: isoTimestampSchema,
  })
  .strict()

export const workItemDetailSchema = z
  .object({
    item: detailItemSchema,
    contextPacket: contextPacketSchema.nullable(),
    recommendation: recommendationSchema.nullable(),
    evidence: evidenceSchema.nullable(),
    draft: workflowActionDraftSchema.nullable(),
    decision: workflowDecisionSchema.nullable(),
    attempt: workflowAttemptSchema.nullable(),
    auditEvents: z.array(workflowAuditEventSchema),
  })
  .strict()

export const workItemListDataSchema = z
  .object({ items: z.array(workItemSummarySchema) })
  .strict()
export const workItemListResponseSchema = workItemListDataSchema
export const workItemListEnvelopeSchema = apiSuccessEnvelopeSchema(
  workItemListDataSchema
)
export const workItemDetailResponseSchema = workItemDetailSchema
export const workItemDetailEnvelopeSchema =
  apiSuccessEnvelopeSchema(workItemDetailSchema)

const intentBaseSchema = z.object({ companyId: z.string().uuid() })

export const runFixtureIntentSchema = intentBaseSchema
  .extend({
    kind: z.literal("run_fixture"),
    scenarioId: identifierSchema,
    risk: z.literal("state_change"),
  })
  .strict()

export const listWorkItemsIntentSchema = intentBaseSchema
  .extend({
    kind: z.literal("list_work_items"),
    status: workflowItemStatusSchema.optional(),
    risk: z.literal("read"),
  })
  .strict()

export const inspectWorkItemIntentSchema = intentBaseSchema
  .extend({
    kind: z.literal("inspect_work_item"),
    itemId: z.string().uuid(),
    risk: z.literal("read"),
  })
  .strict()

export const jsonPointerPatchSchema = z
  .object({
    pointer: z.string().min(1).max(1_000),
    value: jsonValueSchema,
  })
  .strict()

export const modelProposalJsonPointerPatchSchema = z
  .object({
    pointer: z.string().min(1).max(256).startsWith("/"),
    value: modelProposalJsonScalarSchema,
  })
  .strict()

export const controlIntentCandidateSchema = z
  .object({
    kind: z.enum([
      "run_fixture",
      "list_work_items",
      "inspect_work_item",
      "record_decision",
      "execute_mock_action",
    ]),
    scenarioId: z.string().max(200).nullable(),
    status: z.string().max(200).nullable(),
    itemId: z.string().max(200).nullable(),
    decision: decisionKindSchema.nullable(),
    patches: z.array(modelProposalJsonPointerPatchSchema).max(10),
    reason: z.string().max(2_000).nullable(),
  })
  .strict()

export const controlIntentProposalSchema = z
  .object({
    resolution: z.enum(["candidate", "clarification_required", "blocked"]),
    candidate: controlIntentCandidateSchema.nullable(),
    questions: z.array(z.string().min(1).max(500)).max(5),
    reasonCode: identifierSchema.nullable(),
    reasons: z.array(z.string().min(1).max(500)).max(5),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resolution === "candidate" && value.candidate === null) {
      context.addIssue({
        code: "custom",
        path: ["candidate"],
        message: "A candidate resolution requires a candidate.",
      })
    }
    if (
      value.resolution === "clarification_required" &&
      value.questions.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "A clarification resolution requires a question.",
      })
    }
    if (
      value.resolution === "blocked" &&
      (!value.reasonCode || value.reasons.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reasons"],
        message: "A blocked resolution requires a reason code and reason.",
      })
    }
  })

export const recordDecisionIntentSchema = intentBaseSchema
  .extend({
    kind: z.literal("record_decision"),
    itemId: z.string().uuid(),
    decision: decisionKindSchema,
    patches: z.array(jsonPointerPatchSchema).max(100).optional(),
    reason: z.string().min(1).max(2_000).optional(),
    warningsAcknowledged: z.boolean().default(false),
    risk: z.literal("state_change"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "edit" && !value.patches?.length) {
      context.addIssue({
        code: "custom",
        path: ["patches"],
        message: "An edit decision requires at least one patch.",
      })
    }
    if (value.decision !== "edit" && value.patches?.length) {
      context.addIssue({
        code: "custom",
        path: ["patches"],
        message: "Only edit decisions accept patches.",
      })
    }
    if (
      ["edit", "reject", "request_rework"].includes(value.decision) &&
      !value.reason?.trim()
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "This decision requires a reason.",
      })
    }
  })

export const executeMockActionIntentSchema = intentBaseSchema
  .extend({
    kind: z.literal("execute_mock_action"),
    itemId: z.string().uuid(),
    risk: z.literal("mock_execution"),
  })
  .strict()

export const controlIntentSchema = z.union([
  runFixtureIntentSchema,
  listWorkItemsIntentSchema,
  inspectWorkItemIntentSchema,
  recordDecisionIntentSchema,
  executeMockActionIntentSchema,
])

export const resolvedControlOutcomeSchema = z
  .object({
    status: z.literal("resolved"),
    intent: controlIntentSchema,
    confirmationRequired: z.boolean(),
  })
  .strict()

export const clarificationControlOutcomeSchema = z
  .object({
    status: z.literal("clarification_required"),
    questions: z.array(z.string().min(1).max(500)).min(1).max(5),
    confirmationRequired: z.literal(false),
  })
  .strict()

export const blockedControlOutcomeSchema = z
  .object({
    status: z.literal("blocked"),
    reasonCode: identifierSchema,
    reasons: z.array(z.string().min(1).max(500)).min(1).max(5),
    confirmationRequired: z.literal(false),
  })
  .strict()

export const controlOutcomeSchema = z.discriminatedUnion("status", [
  resolvedControlOutcomeSchema,
  clarificationControlOutcomeSchema,
  blockedControlOutcomeSchema,
])

export const controlParseRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    input: z.string().min(1).max(2_000),
  })
  .strict()

export const controlParseTraceSchema = z
  .object({
    traceId: z.string().uuid(),
    runId: z.string().uuid(),
  })
  .strict()

export const controlParseDataSchema = z
  .object({
    outcome: controlOutcomeSchema,
    parserKind: z.enum(["deterministic", "langchain"]),
    model: z.string().min(1).max(200).nullable(),
    durationMs: z.number().int().min(0),
    trace: controlParseTraceSchema.nullable(),
    controlRequestId: z.string().uuid(),
  })
  .strict()

export const controlParseResponseSchema = controlParseDataSchema
export const controlParseEnvelopeSchema = apiSuccessEnvelopeSchema(
  controlParseDataSchema
)

export const unresolvedControlIntentSchema = z
  .object({
    kind: z.literal("unresolved"),
    outcome: z.enum(["clarification_required", "blocked", "failed"]),
  })
  .strict()
export const auditDecisionIntentSchema = z
  .object({
    kind: z.literal("record_decision"),
    companyId: z.string().uuid(),
    itemId: z.string().uuid(),
    decision: decisionKindSchema,
    patchPointers: z.array(z.string().min(1).max(1_000)).max(100),
    patchCount: z.number().int().min(0).max(100),
    warningsAcknowledged: z.boolean(),
    risk: z.literal("state_change"),
  })
  .strict()

export const normalizedControlIntentSchema = z.union([
  runFixtureIntentSchema,
  listWorkItemsIntentSchema,
  inspectWorkItemIntentSchema,
  auditDecisionIntentSchema,
  executeMockActionIntentSchema,
  unresolvedControlIntentSchema,
])

export const controlRequestMetadataSchema = z
  .object({
    id: z.string().uuid().optional(),
    actorId: z.string().uuid().optional(),
    companyId: z.string().uuid(),
    clientSurface: z.enum(["cli", "web", "api"]),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    normalizedIntent: normalizedControlIntentSchema,
    parserKind: parserKindSchema,
    resolutionStatus: controlResolutionStatusSchema,
    risk: controlRiskSchema,
    workflowRunId: z.string().uuid().nullable().optional(),
    workflowItemId: z.string().uuid().nullable().optional(),
    langSmithTraceId: z.string().max(200).nullable().optional(),
    langSmithRunId: z.string().max(200).nullable().optional(),
    createdAt: isoTimestampSchema.optional(),
  })
  .strict()

export const controlRequestCreateRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    normalizedIntent: normalizedControlIntentSchema,
    parserKind: parserKindSchema,
    resolutionStatus: controlResolutionStatusSchema,
    riskClass: controlRiskSchema,
    workflowRunId: z.string().uuid().optional(),
    workflowItemId: z.string().uuid().optional(),
  })
  .strict()

export const controlMutationMetadataSchema = z
  .object({
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    controlRequestId: z.string().uuid().optional(),
  })
  .strict()
export const controlRequestCreateDataSchema = z
  .object({ request: z.object({ id: z.string().uuid() }).passthrough() })
  .strict()
export const controlRequestCreateResponseSchema = controlRequestCreateDataSchema
export const controlRequestCreateEnvelopeSchema = apiSuccessEnvelopeSchema(
  controlRequestCreateDataSchema
)

export const controlRequestTerminalStatusSchema = z.enum([
  "executed",
  "blocked",
  "failed",
])
export const controlRequestTransitionRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    controlRequestId: z.string().uuid(),
    resolutionStatus: controlRequestTerminalStatusSchema,
    workflowRunId: z.string().uuid().optional(),
    workflowItemId: z.string().uuid().optional(),
  })
  .strict()
export const controlRequestTransitionDataSchema = z
  .object({ request: z.object({ id: z.string().uuid() }).passthrough() })
  .strict()
export const controlRequestTransitionResponseSchema =
  controlRequestTransitionDataSchema
export const controlRequestTransitionEnvelopeSchema = apiSuccessEnvelopeSchema(
  controlRequestTransitionDataSchema
)

export const fixtureRunRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    scenarioId: identifierSchema,
    control: controlMutationMetadataSchema.optional(),
  })
  .strict()

export const fixtureRunDataSchema = z
  .object({
    duplicate: z.boolean(),
    workflowRun: jsonObjectSchema,
    event: jsonObjectSchema.optional(),
    eventId: z.string().uuid().optional(),
    item: jsonObjectSchema.nullable().optional(),
    itemId: z.string().uuid().nullable().optional(),
    recommendation: jsonObjectSchema.nullable().optional(),
    draft: jsonObjectSchema.nullable().optional(),
    auditEvents: z.array(jsonObjectSchema).optional(),
  })
  .strict()
export const fixtureRunResponseSchema = fixtureRunDataSchema
export const fixtureRunEnvelopeSchema =
  apiSuccessEnvelopeSchema(fixtureRunDataSchema)

export const decisionRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    actionDraftId: z.string().uuid(),
    decision: decisionKindSchema,
    reason: z.string().min(1).max(2_000).optional(),
    warningsAcknowledged: z.boolean().optional(),
    editedPayload: jsonObjectSchema.optional(),
    control: controlMutationMetadataSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "edit" && !value.editedPayload) {
      context.addIssue({
        code: "custom",
        path: ["editedPayload"],
        message: "An edit decision requires an edited payload.",
      })
    }
    if (value.decision !== "edit" && value.editedPayload) {
      context.addIssue({
        code: "custom",
        path: ["editedPayload"],
        message: "Only edit decisions accept edited payloads.",
      })
    }
    if (
      ["edit", "reject", "request_rework"].includes(value.decision) &&
      !value.reason?.trim()
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "This decision requires a reason.",
      })
    }
  })

export const sensitiveExecutionTokenSchema = z
  .object({
    id: z.string().uuid().optional(),
    rawToken: z.string().min(32).max(512),
    expiresAt: isoTimestampSchema.optional(),
  })
  .strict()

export const decisionDataSchema = z
  .object({
    decision: z
      .object({ id: z.string().uuid(), decision: decisionKindSchema })
      .passthrough(),
    draft: z
      .object({ id: z.string().uuid(), status: workflowDraftStatusSchema })
      .passthrough(),
    item: z
      .object({ id: z.string().uuid(), status: workflowItemStatusSchema })
      .passthrough(),
    executionToken: sensitiveExecutionTokenSchema.nullable().optional(),
  })
  .strict()
export const decisionResponseSchema = decisionDataSchema
export const decisionEnvelopeSchema =
  apiSuccessEnvelopeSchema(decisionDataSchema)

export const executionTokenRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    actionDraftId: z.string().uuid(),
  })
  .strict()
export const executionTokenDataSchema = z
  .object({
    executionToken: sensitiveExecutionTokenSchema,
    decisionId: z.string().uuid(),
    payload: jsonObjectSchema.optional(),
  })
  .strict()
export const executionTokenResponseSchema = executionTokenDataSchema
export const executionTokenEnvelopeSchema = apiSuccessEnvelopeSchema(
  executionTokenDataSchema
)

export const executionRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    actionDraftId: z.string().uuid(),
    decisionId: z.string().uuid(),
    rawToken: z.string().min(32).max(512),
    idempotencyKey: idempotencyKeySchema,
    payload: jsonObjectSchema,
    control: controlMutationMetadataSchema.optional(),
  })
  .strict()
export const executionDataSchema = z
  .object({
    attempt: z
      .object({
        id: z.string().uuid(),
        status: z.enum(["succeeded", "failed"]),
      })
      .passthrough(),
    draft: z
      .object({ id: z.string().uuid(), status: workflowDraftStatusSchema })
      .passthrough(),
    item: z
      .object({ id: z.string().uuid(), status: workflowItemStatusSchema })
      .passthrough(),
    duplicate: z.boolean(),
  })
  .strict()
export const executionResponseSchema = executionDataSchema
export const executionEnvelopeSchema =
  apiSuccessEnvelopeSchema(executionDataSchema)

export type ApiMeta = z.infer<typeof apiMetaSchema>
export type ApiError = z.infer<typeof apiErrorSchema>
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>
export type CompanyRole = z.infer<typeof companyRoleSchema>
export type CompanySummary = z.infer<typeof companySummarySchema>
export type WorkItemSummary = z.infer<typeof workItemSummarySchema>
export type WorkItemDetail = z.infer<typeof workItemDetailSchema>
export type JsonPointerPatch = z.infer<typeof jsonPointerPatchSchema>
export type DecisionKind = z.infer<typeof decisionKindSchema>
export type ControlIntent = z.infer<typeof controlIntentSchema>
export type ControlIntentCandidate = z.infer<
  typeof controlIntentCandidateSchema
>
export type ControlIntentProposal = z.infer<typeof controlIntentProposalSchema>
export type ControlOutcome = z.infer<typeof controlOutcomeSchema>
export type ControlRisk = z.infer<typeof controlRiskSchema>
export type ControlParseRequest = z.infer<typeof controlParseRequestSchema>
export type ControlParseData = z.infer<typeof controlParseDataSchema>
export type ControlRequestMetadata = z.infer<
  typeof controlRequestMetadataSchema
>
export type NormalizedControlIntent = z.infer<
  typeof normalizedControlIntentSchema
>
export type ControlRequestCreateRequest = z.infer<
  typeof controlRequestCreateRequestSchema
>
export type ControlRequestTransitionRequest = z.infer<
  typeof controlRequestTransitionRequestSchema
>
export type FixtureRunRequest = z.infer<typeof fixtureRunRequestSchema>
export type FixtureRunData = z.infer<typeof fixtureRunDataSchema>
export type DecisionRequest = z.infer<typeof decisionRequestSchema>
export type DecisionData = z.infer<typeof decisionDataSchema>
export type ExecutionTokenRequest = z.infer<typeof executionTokenRequestSchema>
export type ExecutionTokenData = z.infer<typeof executionTokenDataSchema>
export type ExecutionRequest = z.infer<typeof executionRequestSchema>
export type ExecutionData = z.infer<typeof executionDataSchema>
