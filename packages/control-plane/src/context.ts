import { z } from "zod"

export const CONTEXT_MAX_RESULTS = 20
export const CONTEXT_MAX_CHARACTERS = 50_000
export const CONTEXT_MAX_TOKENS = 16_000
export const CONTEXT_MAX_TIMEOUT_MS = 10_000
export const CONTEXT_MAX_APPROVED_FIELDS = 100
export const CONTEXT_INDEX_MAX_BATCH_SIZE = 100
export const CONTEXT_INDEX_MAX_CONCURRENCY = 20
export const CONTEXT_INDEX_MAX_ATTEMPTS = 20
export const CONTEXT_INDEX_MAX_CANONICAL_PAYLOAD_BYTES = 4_194_304

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const timestampSchema = z.string().datetime({ offset: true })
const boundedKeySchema = z.string().trim().min(1).max(150)
const providerReferenceSchema = z.string().trim().min(1).max(500)
const jsonPointerSchema = z
  .string()
  .min(2)
  .max(300)
  .refine(
    (value) => /^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/.test(value),
    "Expected an RFC 6901 JSON pointer."
  )
  .refine(
    (value) =>
      !/(?:^|\/)(?:__proto__|constructor|prototype)(?:\/|$)/.test(value),
    "Unsafe field path."
  )

export const contextProviderSchema = z.enum(["off", "supermemory"])

export const contextTenantScopeSchema = z
  .object({
    companyId: z.string().uuid(),
    workspaceScopeId: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.companyId !== value.workspaceScopeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspaceScopeId"],
        message: "Workspace scope must equal the canonical company scope.",
      })
    }
  })

export const contextRetrievalBoundsSchema = z
  .object({
    maximumResults: z.number().int().min(1).max(CONTEXT_MAX_RESULTS).default(5),
    maximumCharacters: z
      .number()
      .int()
      .min(1)
      .max(CONTEXT_MAX_CHARACTERS)
      .default(12_000),
    maximumTokens: z
      .number()
      .int()
      .min(1)
      .max(CONTEXT_MAX_TOKENS)
      .default(4_000),
    maximumAgeHours: z.number().int().min(1).max(87_600).default(8_760),
    minimumConfidence: z.number().min(0).max(1).default(0),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(CONTEXT_MAX_TIMEOUT_MS)
      .default(2_000),
  })
  .strict()

export const contextRetrievalFiltersSchema = z
  .object({
    sourceKeys: z.array(boundedKeySchema).min(1).max(20),
    recordTypes: z.array(boundedKeySchema).min(1).max(50),
    canonicalRecordIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict()

export const contextRetrievalRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    provider: contextProviderSchema,
    scope: contextTenantScopeSchema,
    query: z.string().trim().min(1).max(2_000),
    queryHash: sha256Schema,
    filterHash: sha256Schema,
    policyVersion: z.number().int().positive(),
    filters: contextRetrievalFiltersSchema,
    bounds: contextRetrievalBoundsSchema,
  })
  .strict()

export const contextRetrievalStatusSchema = z.enum([
  "disabled",
  "complete",
  "empty",
  "partial",
  "timeout",
  "unavailable",
  "failed",
])

export const contextFallbackReasonSchema = z.enum([
  "context_off",
  "timeout",
  "provider_unavailable",
  "provider_error",
  "policy_rejected",
  "bounds_exceeded",
])

export const contextCitationSchema = z
  .object({
    providerReference: providerReferenceSchema,
    providerDocumentId: providerReferenceSchema.nullable(),
    stableCustomId: providerReferenceSchema,
    canonicalRecordId: z.string().uuid(),
    canonicalRecordVersion: z.string().trim().min(1).max(200),
    sourceId: z.string().uuid(),
    sourceKey: boundedKeySchema,
    recordType: boundedKeySchema,
    rank: z.number().int().min(1).max(CONTEXT_MAX_RESULTS),
    score: z.number().min(0).max(1).nullable(),
    providerUpdatedAt: timestampSchema.nullable(),
    sourceObservedAt: timestampSchema,
    freshness: z.enum(["fresh", "stale", "unknown"]),
    contentHash: sha256Schema,
    policyHash: sha256Schema,
  })
  .strict()

export const contextRetrievalItemSchema = z
  .object({
    citation: contextCitationSchema,
    excerpt: z.string().min(1).max(CONTEXT_MAX_CHARACTERS),
    untrustedEvidence: z.literal(true),
  })
  .strict()

export const contextPacketProvenanceSchema = z
  .object({
    provider: contextProviderSchema,
    status: contextRetrievalStatusSchema,
    requestId: z.string().uuid(),
    scope: contextTenantScopeSchema,
    queryHash: sha256Schema,
    filterHash: sha256Schema,
    policyVersion: z.number().int().positive(),
    bounds: contextRetrievalBoundsSchema,
    resultCount: z.number().int().min(0).max(CONTEXT_MAX_RESULTS),
    characterCount: z.number().int().min(0).max(CONTEXT_MAX_CHARACTERS),
    tokenEstimate: z.number().int().min(0).max(CONTEXT_MAX_TOKENS),
    latencyMs: z.number().int().min(0).max(120_000),
    fallbackReason: contextFallbackReasonSchema.nullable(),
    indexSnapshotMarker: z.string().min(1).max(500).nullable(),
    citations: z.array(contextCitationSchema).max(CONTEXT_MAX_RESULTS),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resultCount !== value.citations.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultCount"],
        message: "Result count must match the bounded citation set.",
      })
    }
    if (value.resultCount > value.bounds.maximumResults) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultCount"],
        message: "Result count exceeds the configured bound.",
      })
    }
    if (value.characterCount > value.bounds.maximumCharacters) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["characterCount"],
        message: "Character count exceeds the configured bound.",
      })
    }
    if (value.tokenEstimate > value.bounds.maximumTokens) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokenEstimate"],
        message: "Token estimate exceeds the configured bound.",
      })
    }
    if (value.status === "disabled" && value.fallbackReason !== "context_off") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fallbackReason"],
        message: "Disabled Context must record the context_off reason.",
      })
    }
    if (value.provider === "off" && value.status !== "disabled") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "The Off provider can only return disabled Context.",
      })
    }
    if (
      ["disabled", "empty", "timeout", "unavailable", "failed"].includes(
        value.status
      ) &&
      (value.resultCount !== 0 ||
        value.characterCount !== 0 ||
        value.tokenEstimate !== 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultCount"],
        message: `${value.status} Context cannot contain retrieved evidence.`,
      })
    }
    if (value.status === "complete" && value.resultCount === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "A zero-result retrieval must use the empty status.",
      })
    }
  })

export const contextRetrievalResultSchema = z
  .object({
    provenance: contextPacketProvenanceSchema,
    items: z.array(contextRetrievalItemSchema).max(CONTEXT_MAX_RESULTS),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.items.length !== value.provenance.resultCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Items must match the provenance result count.",
      })
    }
    const characterCount = value.items.reduce(
      (total, item) => total + item.excerpt.length,
      0
    )
    if (characterCount !== value.provenance.characterCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenance", "characterCount"],
        message: "Character count must match the retrieved evidence exactly.",
      })
    }
    if (characterCount > value.provenance.bounds.maximumCharacters) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Retrieved evidence exceeds the configured character bound.",
      })
    }
    value.items.forEach((item, index) => {
      if (
        JSON.stringify(item.citation) !==
        JSON.stringify(value.provenance.citations[index])
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "citation"],
          message: "Item citation must match immutable packet provenance.",
        })
      }
    })
  })

export const contextReadinessSchema = z.enum([
  "disabled",
  "not_ready",
  "ready",
  "error",
])

export const contextWorkspaceSettingsSchema = z
  .object({
    companyId: z.string().uuid(),
    workspaceScopeId: z.string().uuid(),
    provider: contextProviderSchema.default("off"),
    sandboxEnabled: z.boolean().default(true),
    readiness: contextReadinessSchema.default("disabled"),
    configurationVersion: z.number().int().positive().default(1),
    updatedBy: z.string().uuid(),
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.companyId !== value.workspaceScopeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspaceScopeId"],
        message: "Workspace scope must equal the canonical company scope.",
      })
    }
    if (value.provider === "off" && value.readiness !== "disabled") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["readiness"],
        message: "Context Off must have disabled readiness.",
      })
    }
    if (value.provider === "supermemory" && value.readiness === "disabled") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["readiness"],
        message: "A configured provider must declare its readiness.",
      })
    }
  })

export const contextWorkspaceStatusRequestSchema = z
  .object({
    companyId: z.string().uuid(),
  })
  .strict()

export const contextWorkspaceConfigurationRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    provider: contextProviderSchema.optional(),
    sandboxEnabled: z.boolean().optional(),
    expectedConfigurationVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider === undefined && value.sandboxEnabled === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provider"],
        message: "At least one Context or Sandbox setting must be supplied.",
      })
    }
  })

const contextEffectiveStatusSchema = z
  .object({
    operational: z.boolean(),
    status: contextReadinessSchema,
    detailCode: z.enum([
      "context_off",
      "provider_not_operational",
      "provider_ready",
      "provider_error",
    ]),
  })
  .strict()

const unavailableIndexingCoverageSchema = z
  .object({
    status: z.literal("unavailable"),
    eligibleRecordCount: z.null(),
    indexedRecordCount: z.null(),
    percent: z.null(),
  })
  .strict()

const evidenceOnlyIndexingCoverageSchema = z
  .object({
    status: z.literal("evidence_only"),
    eligibleRecordCount: z.number().int().nonnegative().nullable(),
    indexedRecordCount: z.number().int().nonnegative().nullable(),
    percent: z.null(),
  })
  .strict()

const availableIndexingCoverageSchema = z
  .object({
    status: z.literal("available"),
    eligibleRecordCount: z.number().int().nonnegative(),
    indexedRecordCount: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100),
  })
  .strict()

const unavailableSynchronizationSchema = z
  .object({
    status: z.literal("unavailable"),
    lagSeconds: z.null(),
    lastSynchronizedAt: z.null(),
    recentErrorCount: z.null(),
  })
  .strict()

const availableSynchronizationSchema = z
  .object({
    status: z.literal("available"),
    lagSeconds: z.number().int().nonnegative().nullable(),
    lastSynchronizedAt: timestampSchema.nullable(),
    recentErrorCount: z.number().int().nonnegative(),
  })
  .strict()

export const contextWorkspaceStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    companyId: z.string().uuid(),
    provider: contextProviderSchema,
    sandboxEnabled: z.boolean(),
    readiness: contextReadinessSchema,
    configurationVersion: z.number().int().positive(),
    updatedAt: timestampSchema,
    providerStatus: contextEffectiveStatusSchema,
    indexingCoverage: z.discriminatedUnion("status", [
      unavailableIndexingCoverageSchema,
      evidenceOnlyIndexingCoverageSchema,
      availableIndexingCoverageSchema,
    ]),
    synchronization: z.discriminatedUnion("status", [
      unavailableSynchronizationSchema,
      availableSynchronizationSchema,
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.providerStatus.status !== value.readiness) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerStatus", "status"],
        message: "Provider status must match effective readiness.",
      })
    }
    if (
      value.provider === "off" &&
      (value.readiness !== "disabled" ||
        value.providerStatus.operational ||
        value.providerStatus.detailCode !== "context_off")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerStatus"],
        message: "Context Off must report a non-operational disabled status.",
      })
    }
    if (
      value.provider === "supermemory" &&
      (value.readiness === "disabled" ||
        (value.readiness === "not_ready" &&
          (value.providerStatus.operational ||
            value.providerStatus.detailCode !== "provider_not_operational")) ||
        (value.readiness === "ready" &&
          (!value.providerStatus.operational ||
            value.providerStatus.detailCode !== "provider_ready")) ||
        (value.readiness === "error" &&
          (value.providerStatus.operational ||
            value.providerStatus.detailCode !== "provider_error")))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerStatus"],
        message: "Configured provider readiness must have consistent status.",
      })
    }
  })

const unsafeProviderFieldTokenPattern =
  /(password|passwd|secret|token|credential|authorization|apikey|accesskey|privatekey|cookie|prompt|systeminstruction|bearer|sessionkey)/

function isUnsafeProviderFieldPath(path: string): boolean {
  const normalized = path.toLowerCase().replace(/[^a-z0-9]/g, "")
  return unsafeProviderFieldTokenPattern.test(normalized)
}

export const contextIndexingPolicySchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    sourceKey: z
      .string()
      .min(1)
      .max(150)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    recordType: z
      .string()
      .min(1)
      .max(150)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    policyVersion: z.number().int().positive(),
    indexingEnabled: z.boolean().default(false),
    approvedFieldPaths: z
      .array(jsonPointerSchema)
      .max(CONTEXT_MAX_APPROVED_FIELDS)
      .default([]),
    maximumContentBytes: z.number().int().min(1).max(1_048_576).default(65_536),
    classification: z.enum(["internal", "confidential"]),
    retentionDays: z.number().int().min(1).max(3_650),
    projectionVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1_000),
    createdBy: z.string().uuid(),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.indexingEnabled && value.approvedFieldPaths.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedFieldPaths"],
        message:
          "An enabled policy must explicitly approve at least one field.",
      })
    }
    if (!value.indexingEnabled && value.approvedFieldPaths.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedFieldPaths"],
        message: "A disabled policy must not approve provider fields.",
      })
    }
    value.approvedFieldPaths.forEach((path, index) => {
      if (isUnsafeProviderFieldPath(path)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["approvedFieldPaths", index],
          message:
            "Provider indexing cannot approve a root or sensitive field.",
        })
      }
    })
  })

export const contextIndexDocumentSchema = z
  .object({
    requestId: z.string().uuid(),
    provider: contextProviderSchema,
    scope: contextTenantScopeSchema,
    stableCustomId: providerReferenceSchema,
    canonicalRecordId: z.string().uuid(),
    canonicalRecordVersion: z.string().trim().min(1).max(200),
    sourceId: z.string().uuid(),
    sourceKey: boundedKeySchema,
    recordType: boundedKeySchema,
    externalId: providerReferenceSchema,
    containerTag: providerReferenceSchema,
    policyVersion: z.number().int().positive(),
    policyHash: sha256Schema,
    contentHash: sha256Schema,
    content: z.string().min(1).max(CONTEXT_MAX_CHARACTERS),
    observedAt: timestampSchema,
  })
  .strict()

export const contextIndexDeleteRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    provider: contextProviderSchema,
    scope: contextTenantScopeSchema,
    stableCustomId: providerReferenceSchema,
    providerDocumentId: providerReferenceSchema,
    canonicalRecordId: z.string().uuid(),
  })
  .strict()

export const contextIndexOperationResultSchema = z
  .object({
    requestId: z.string().uuid(),
    provider: contextProviderSchema,
    operation: z.enum(["add", "replace", "delete"]),
    status: z.enum(["disabled", "accepted", "complete", "failed"]),
    providerDocumentId: providerReferenceSchema.nullable(),
    receipt: providerReferenceSchema.nullable(),
    estimatedCostMicrounits: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000_000)
      .default(0),
    completedAt: timestampSchema,
  })
  .strict()

export const contextProviderHealthSchema = z
  .object({
    provider: contextProviderSchema,
    scope: contextTenantScopeSchema,
    status: z.enum(["disabled", "healthy", "degraded", "unavailable"]),
    checkedAt: timestampSchema,
    detailCode: boundedKeySchema.nullable(),
  })
  .strict()

export const contextIndexListRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    provider: contextProviderSchema,
    scope: contextTenantScopeSchema,
    cursor: z.string().min(1).max(500).nullable(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()

export const contextIndexListResultSchema = z
  .object({
    requestId: z.string().uuid(),
    provider: contextProviderSchema,
    status: z.enum(["disabled", "complete", "failed"]),
    documents: z
      .array(
        z
          .object({
            stableCustomId: providerReferenceSchema,
            providerDocumentId: providerReferenceSchema,
          })
          .strict()
      )
      .max(100),
    nextCursor: z.string().min(1).max(500).nullable(),
  })
  .strict()

export const contextIndexProcessingStatusSchema = z
  .object({
    requestId: z.string().uuid(),
    provider: contextProviderSchema,
    scope: contextTenantScopeSchema,
    stableCustomId: providerReferenceSchema,
    status: z.enum(["disabled", "pending", "processing", "complete", "failed"]),
    checkedAt: timestampSchema,
  })
  .strict()

export const contextIndexOperationSchema = z.enum(["add", "replace", "delete"])

const contextOperationalProviderSchema = contextProviderSchema.refine(
  (provider) => provider !== "off",
  "The Off provider cannot receive indexing work."
)

export const contextIndexOutboxEventSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    provider: contextOperationalProviderSchema,
    operation: contextIndexOperationSchema,
    canonicalRecordId: z.string().uuid(),
    canonicalRecordVersion: z.string().trim().min(1).max(200),
    stableCustomId: z.string().regex(/^ctx_[0-9a-f]{64}$/),
    providerDocumentId: providerReferenceSchema.nullable(),
    policyVersion: z.number().int().positive().nullable(),
    policyHash: sha256Schema.nullable(),
    expectedContentHash: sha256Schema.nullable(),
    attempt: z.number().int().positive().max(CONTEXT_INDEX_MAX_ATTEMPTS),
    maxAttempts: z.number().int().positive().max(CONTEXT_INDEX_MAX_ATTEMPTS),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.attempt > event.maxAttempts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attempt"],
        message: "The event attempt cannot exceed its maximum attempts.",
      })
    }
    if (event.operation === "add" && event.providerDocumentId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerDocumentId"],
        message: "Add work cannot already have a provider document.",
      })
    }
    if (event.operation !== "add" && event.providerDocumentId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerDocumentId"],
        message: `${event.operation} work requires an existing provider document.`,
      })
    }
    const projectionIdentity = [event.policyVersion, event.policyHash]
    if (
      event.operation !== "delete" &&
      (projectionIdentity.some((value) => value === null) ||
        event.expectedContentHash === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policyVersion"],
        message: "Add and replace work require an immutable policy identity.",
      })
    }
  })

export const contextIndexCanonicalRecordSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    sourceId: z.string().uuid(),
    sourceKey: boundedKeySchema,
    recordType: boundedKeySchema,
    externalId: providerReferenceSchema,
    canonicalRecordVersion: z.string().trim().min(1).max(200),
    payload: z.record(z.string(), z.unknown()),
    observedAt: timestampSchema,
  })
  .strict()
  .superRefine((record, context) => {
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(record.payload)
    } catch {
      serialized = undefined
    }
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength >
        CONTEXT_INDEX_MAX_CANONICAL_PAYLOAD_BYTES
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "Canonical projection input exceeds its hard byte bound.",
      })
    }
  })

export const contextIndexPolicySnapshotSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    sourceKey: boundedKeySchema,
    recordType: boundedKeySchema,
    policyVersion: z.number().int().positive(),
    policyHash: sha256Schema,
    approvedFieldPaths: z
      .array(jsonPointerSchema)
      .min(1)
      .max(CONTEXT_MAX_APPROVED_FIELDS),
    maximumContentBytes: z.number().int().min(1).max(1_048_576),
    classification: z.enum(["internal", "confidential"]),
    retentionDays: z.number().int().min(1).max(3_650),
    projectionVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((policy, context) => {
    policy.approvedFieldPaths.forEach((path, index) => {
      if (isUnsafeProviderFieldPath(path)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["approvedFieldPaths", index],
          message: "Provider indexing cannot approve a sensitive field.",
        })
      }
    })
  })

export const contextIndexProjectionSourceSchema = z
  .object({
    eventId: z.string().uuid(),
    record: contextIndexCanonicalRecordSchema,
    policy: contextIndexPolicySnapshotSchema,
    projectedContent: z.string().min(2).max(1_048_576),
  })
  .strict()
  .superRefine((source, context) => {
    if (
      source.record.companyId !== source.policy.companyId ||
      source.record.sourceKey !== source.policy.sourceKey ||
      source.record.recordType !== source.policy.recordType
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policy"],
        message: "The policy must match the canonical record scope and type.",
      })
    }
  })

export const contextIndexLeaseSchema = z
  .object({
    leaseId: z.string().uuid(),
    leasedUntil: timestampSchema,
    event: contextIndexOutboxEventSchema,
    projectionSource: contextIndexProjectionSourceSchema.nullable(),
  })
  .strict()
  .superRefine((lease, context) => {
    if (
      (lease.event.operation === "delete") !==
      (lease.projectionSource === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectionSource"],
        message: "Only delete work may omit its canonical projection source.",
      })
    }
  })

export const contextIndexProjectionSchema = z
  .object({
    document: contextIndexDocumentSchema,
    projectedFieldPaths: z
      .array(jsonPointerSchema)
      .min(1)
      .max(CONTEXT_MAX_APPROVED_FIELDS),
    contentBytes: z.number().int().positive().max(1_048_576),
  })
  .strict()

export const contextIndexCompletionOutcomeSchema = z
  .object({
    eventId: z.string().uuid(),
    provider: contextOperationalProviderSchema,
    operation: contextIndexOperationSchema,
    providerDocumentId: providerReferenceSchema.nullable(),
    receipt: providerReferenceSchema.nullable(),
    contentHash: sha256Schema.nullable(),
    estimatedCostMicrounits: z.number().int().nonnegative(),
    completedAt: timestampSchema,
  })
  .strict()
  .superRefine((outcome, context) => {
    if (
      outcome.operation !== "delete" &&
      (outcome.providerDocumentId === null || outcome.contentHash === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerDocumentId"],
        message:
          "Completed add and replace work requires document identity and content hash.",
      })
    }
    if (outcome.operation === "delete" && outcome.contentHash !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentHash"],
        message:
          "Completed delete work cannot contain projected content identity.",
      })
    }
  })

export const contextIndexFailureDispositionSchema = z.enum([
  "retry",
  "terminal",
  "reconciliation_required",
])

export const contextIndexFailureStateSchema = z.enum([
  "pending",
  "dead_letter",
  "reconciliation_required",
])

export const contextIndexPreparationSummarySchema = z
  .object({
    recoveredCount: z.number().int().nonnegative(),
    deadLetteredCount: z.number().int().nonnegative(),
    preparedAt: timestampSchema,
  })
  .strict()

export const contextIndexReconciliationModeSchema = z.enum([
  "dry_run",
  "canary",
  "reconciliation",
])

export const contextIndexReconciliationRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    mode: contextIndexReconciliationModeSchema,
    requestedLimit: z.number().int().min(0).max(10_000),
    now: timestampSchema,
  })
  .strict()

export const contextIndexReconciliationSummarySchema = z
  .object({
    jobId: z.string().uuid(),
    companyId: z.string().uuid(),
    provider: contextOperationalProviderSchema,
    mode: contextIndexReconciliationModeSchema,
    status: z.enum(["running", "completed"]),
    eligibleCount: z.number().int().nonnegative(),
    queuedCount: z.number().int().nonnegative(),
    policyHash: sha256Schema,
    snapshotHash: sha256Schema,
    queryHash: sha256Schema,
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.queuedCount > summary.eligibleCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["queuedCount"],
        message: "Queued reconciliation work cannot exceed eligible work.",
      })
    }
    if (summary.mode === "dry_run" && summary.queuedCount !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["queuedCount"],
        message: "Dry-run reconciliation cannot enqueue provider work.",
      })
    }
  })

export const contextIndexWorkResultSchema = z
  .object({
    eventId: z.string().uuid(),
    status: z.enum([
      "completed",
      "retry_scheduled",
      "dead_letter",
      "reconciliation_required",
      "lease_unresolved",
    ]),
    operation: contextIndexOperationSchema,
    errorCode: z
      .string()
      .regex(/^[a-z0-9_]{1,64}$/)
      .optional(),
  })
  .strict()

export const contextIndexWorkerSummarySchema = z
  .object({
    claimed: z.number().int().nonnegative().max(CONTEXT_INDEX_MAX_BATCH_SIZE),
    completed: z.number().int().nonnegative(),
    retryScheduled: z.number().int().nonnegative(),
    deadLettered: z.number().int().nonnegative(),
    reconciliationRequired: z.number().int().nonnegative(),
    leaseUnresolved: z.number().int().nonnegative(),
    results: z
      .array(contextIndexWorkResultSchema)
      .max(CONTEXT_INDEX_MAX_BATCH_SIZE),
  })
  .strict()
  .superRefine((summary, context) => {
    const total =
      summary.completed +
      summary.retryScheduled +
      summary.deadLettered +
      summary.reconciliationRequired +
      summary.leaseUnresolved
    if (
      summary.claimed !== summary.results.length ||
      summary.claimed !== total
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claimed"],
        message: "Worker summary counts must exactly match claimed results.",
      })
    }
  })

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T

export type ContextProvider = z.infer<typeof contextProviderSchema>
export type ContextTenantScope = DeepReadonly<
  z.output<typeof contextTenantScopeSchema>
>
export type ContextRetrievalRequest = DeepReadonly<
  z.output<typeof contextRetrievalRequestSchema>
>
export type ContextRetrievalResult = DeepReadonly<
  z.output<typeof contextRetrievalResultSchema>
>
export type ContextPacketProvenance = DeepReadonly<
  z.output<typeof contextPacketProvenanceSchema>
>
export type ContextWorkspaceSettings = DeepReadonly<
  z.output<typeof contextWorkspaceSettingsSchema>
>
export type ContextWorkspaceStatusRequest = DeepReadonly<
  z.output<typeof contextWorkspaceStatusRequestSchema>
>
export type ContextWorkspaceConfigurationRequest = DeepReadonly<
  z.output<typeof contextWorkspaceConfigurationRequestSchema>
>
export type ContextWorkspaceStatus = DeepReadonly<
  z.output<typeof contextWorkspaceStatusSchema>
>
export type ContextIndexingPolicy = DeepReadonly<
  z.output<typeof contextIndexingPolicySchema>
>
export type ContextIndexDocument = DeepReadonly<
  z.output<typeof contextIndexDocumentSchema>
>
export type ContextIndexDeleteRequest = DeepReadonly<
  z.output<typeof contextIndexDeleteRequestSchema>
>
export type ContextIndexOperationResult = DeepReadonly<
  z.output<typeof contextIndexOperationResultSchema>
>
export type ContextProviderHealth = DeepReadonly<
  z.output<typeof contextProviderHealthSchema>
>
export type ContextIndexListRequest = DeepReadonly<
  z.output<typeof contextIndexListRequestSchema>
>
export type ContextIndexListResult = DeepReadonly<
  z.output<typeof contextIndexListResultSchema>
>
export type ContextIndexProcessingStatus = DeepReadonly<
  z.output<typeof contextIndexProcessingStatusSchema>
>
export type ContextIndexOperation = z.output<typeof contextIndexOperationSchema>
export type ContextIndexOutboxEvent = DeepReadonly<
  z.output<typeof contextIndexOutboxEventSchema>
>
export type ContextIndexLease = DeepReadonly<
  z.output<typeof contextIndexLeaseSchema>
>
export type ContextIndexCanonicalRecord = DeepReadonly<
  z.output<typeof contextIndexCanonicalRecordSchema>
>
export type ContextIndexPolicySnapshot = DeepReadonly<
  z.output<typeof contextIndexPolicySnapshotSchema>
>
export type ContextIndexProjectionSource = DeepReadonly<
  z.output<typeof contextIndexProjectionSourceSchema>
>
export type ContextIndexProjection = DeepReadonly<
  z.output<typeof contextIndexProjectionSchema>
>
export type ContextIndexCompletionOutcome = DeepReadonly<
  z.output<typeof contextIndexCompletionOutcomeSchema>
>
export type ContextIndexFailureDisposition = z.output<
  typeof contextIndexFailureDispositionSchema
>
export type ContextIndexFailureState = z.output<
  typeof contextIndexFailureStateSchema
>
export type ContextIndexPreparationSummary = DeepReadonly<
  z.output<typeof contextIndexPreparationSummarySchema>
>
export type ContextIndexReconciliationMode = z.output<
  typeof contextIndexReconciliationModeSchema
>
export type ContextIndexReconciliationRequest = DeepReadonly<
  z.output<typeof contextIndexReconciliationRequestSchema>
>
export type ContextIndexReconciliationSummary = DeepReadonly<
  z.output<typeof contextIndexReconciliationSummarySchema>
>
export type ContextIndexWorkResult = DeepReadonly<
  z.output<typeof contextIndexWorkResultSchema>
>
export type ContextIndexWorkerSummary = DeepReadonly<
  z.output<typeof contextIndexWorkerSummarySchema>
>

export interface ContextRetrievalProvider {
  readonly provider: ContextProvider
  retrieve(request: ContextRetrievalRequest): Promise<ContextRetrievalResult>
  health(scope: ContextTenantScope): Promise<ContextProviderHealth>
}

export interface ContextIndexProvider {
  readonly provider: ContextProvider
  add(document: ContextIndexDocument): Promise<ContextIndexOperationResult>
  replace(
    providerDocumentId: string,
    document: ContextIndexDocument
  ): Promise<ContextIndexOperationResult>
  delete(
    request: ContextIndexDeleteRequest
  ): Promise<ContextIndexOperationResult>
  list(request: ContextIndexListRequest): Promise<ContextIndexListResult>
  processingStatus(input: {
    readonly requestId: string
    readonly scope: ContextTenantScope
    readonly stableCustomId: string
    readonly providerDocumentId: string
  }): Promise<ContextIndexProcessingStatus>
  health(scope: ContextTenantScope): Promise<ContextProviderHealth>
}
