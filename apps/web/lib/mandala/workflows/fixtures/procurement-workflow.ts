import {
  WorkflowMemoryStore,
  type ValidationResult,
  type WorkflowActionDraftRecord,
  type WorkflowAuditEventRecord,
  type WorkflowContextPacketRecord,
  type WorkflowDefinitionRecord,
  type WorkflowEventRecord,
  type WorkflowEvidenceRecord,
  type WorkflowFixtureRunResult,
  type WorkflowItemRecord,
  type WorkflowRecommendationRecord,
  type WorkflowRunRecord,
} from "../engine"
import { hashWorkflowValue, workflowUuidFor } from "../hash"
import { compileWorkflowSkillMarkdown, type WorkflowSpec } from "../schema"
import {
  getProcurementFixtureScenario,
  type ProcurementFixtureScenario,
  type ProcurementFixtureScenarioId,
  type ProcurementSkuSnapshot,
} from "./procurement"
import {
  procurementReorderSkillMarkdown,
  procurementWorkflowSkillAdapters,
} from "./procurement-skill"

export type ProcurementMockActionPayload = {
  vendor: string
  lines: Array<{
    sku: string
    quantity: number
    reason: string
  }>
  mode: "mock"
}

type ProcurementRecommendationOutput = {
  sku: string
  recommendedQuantity: number
  projectedDailySales: number
  projectedCoverageDays: number
  reorderPoint: number
  availableInventory: number
}

export function runProcurementFixtureScenario(input: {
  store: WorkflowMemoryStore
  companyId: string
  actorUserId: string
  scenarioId: ProcurementFixtureScenarioId
  now?: Date
}): WorkflowFixtureRunResult {
  const createdAt = (input.now ?? new Date()).toISOString()
  const scenario = getProcurementFixtureScenario(input.scenarioId)
  const compileResult = compileWorkflowSkillMarkdown(
    procurementReorderSkillMarkdown,
    procurementWorkflowSkillAdapters
  )
  if (!compileResult.ok) {
    throw new Error(
      `Fixture workflow spec failed to compile: ${compileResult.errors.join(", ")}`
    )
  }

  const definition = upsertDefinition(
    input.store,
    input.companyId,
    compileResult.spec
  )
  const run = createRun(
    input.store,
    input.companyId,
    input.actorUserId,
    definition,
    scenario,
    createdAt
  )
  const validation = validateScenario(scenario)
  const event = createEvent(
    input.store,
    input.companyId,
    definition,
    run,
    scenario,
    validation,
    createdAt
  )
  const auditEvents = [
    createFixtureAuditEvent(input.store, {
      companyId: input.companyId,
      run,
      item: null,
      eventType: "event_validated",
      summary: `Validated fixture event: ${validation.status}.`,
      payload: { validation },
      createdAt,
    }),
  ]

  if (validation.suppressRecommendation) {
    run.status = validation.status === "blocked" ? "blocked" : "suppressed"
    run.completedAt = createdAt
    auditEvents.push(
      createFixtureAuditEvent(input.store, {
        companyId: input.companyId,
        run,
        item: null,
        eventType: "item_suppressed",
        summary: validation.reasons.join("; "),
        payload: { scenarioId: scenario.id, reasons: validation.reasons },
        createdAt,
      })
    )
    return emptyFixtureResult(definition, run, event, auditEvents)
  }

  const itemKey = `${definition.workflowType}:${scenario.sku.sku}:reorder_review`
  const existingItem = input.store.findActiveItem(itemKey, input.companyId)
  if (existingItem) {
    run.status = "suppressed"
    run.completedAt = createdAt
    auditEvents.push(
      createFixtureAuditEvent(input.store, {
        companyId: input.companyId,
        run,
        item: existingItem,
        eventType: "item_duplicate_suppressed",
        summary:
          "Existing active workflow item already covers this SKU review.",
        payload: { itemKey, existingItemId: existingItem.id },
        createdAt,
      })
    )
    return {
      definition,
      run,
      event,
      item: existingItem,
      contextPacket: findLast(
        input.store.contextPackets,
        (record) => record.workflowItemId === existingItem.id
      ),
      recommendation: findLast(
        input.store.recommendations,
        (record) => record.workflowItemId === existingItem.id
      ),
      evidence: findLast(
        input.store.evidenceSnapshots,
        (record) => record.workflowItemId === existingItem.id
      ),
      draft: input.store.latestDraftForItem(existingItem.id),
      auditEvents,
    }
  }

  const item = createItem(
    input.store,
    input.companyId,
    definition,
    run,
    event,
    scenario,
    createdAt
  )
  const contextPacket = createContextPacket(
    input.store,
    input.companyId,
    run,
    item,
    scenario,
    validation,
    createdAt
  )
  const recommendation = createRecommendation(
    input.store,
    input.companyId,
    run,
    item,
    contextPacket,
    scenario,
    validation,
    createdAt
  )
  const evidence = createEvidence(
    input.store,
    input.companyId,
    run,
    item,
    recommendation,
    scenario,
    validation,
    createdAt
  )
  const draft = createDraft(
    input.store,
    input.companyId,
    run,
    item,
    recommendation,
    evidence,
    scenario,
    createdAt
  )

  run.status = "waiting_for_approval"
  auditEvents.push(
    createFixtureAuditEvent(input.store, {
      companyId: input.companyId,
      run,
      item,
      eventType: "recommendation_created",
      summary: `Created reorder recommendation for ${scenario.sku.sku}.`,
      payload: {
        recommendationId: recommendation.id,
        draftId: draft.id,
        warningState: recommendation.warningState,
      },
      createdAt,
    })
  )

  return {
    definition,
    run,
    event,
    item,
    contextPacket,
    recommendation,
    evidence,
    draft,
    auditEvents,
  }
}

function upsertDefinition(
  store: WorkflowMemoryStore,
  companyId: string,
  spec: WorkflowSpec
): WorkflowDefinitionRecord {
  const existing = store.definitions.find(
    (record) =>
      record.companyId === companyId &&
      record.workflowKey === spec.workflowKey &&
      record.version === spec.version
  )
  if (existing) return existing

  const definition: WorkflowDefinitionRecord = {
    id: idFor("workflow", companyId, spec.workflowKey, spec.version),
    companyId,
    workflowKey: spec.workflowKey,
    workflowType: spec.workflowType,
    version: spec.version,
    status: spec.status,
    spec,
    skillMarkdown: procurementReorderSkillMarkdown,
  }
  store.definitions.push(definition)
  return definition
}

function createRun(
  store: WorkflowMemoryStore,
  companyId: string,
  actorUserId: string,
  definition: WorkflowDefinitionRecord,
  scenario: ProcurementFixtureScenario,
  createdAt: string
): WorkflowRunRecord {
  const ordinal = String(store.runs.length + 1)
  const run: WorkflowRunRecord = {
    id: idFor("run", companyId, scenario.id, ordinal),
    companyId,
    workflowDefinitionId: definition.id,
    workflowType: definition.workflowType,
    status: "started",
    input: { scenarioId: scenario.id },
    langGraphThreadId: null,
    langGraphCheckpointId: null,
    langSmithTraceId: null,
    langSmithRunId: null,
    startedBy: actorUserId,
    startedAt: createdAt,
    completedAt: null,
  }
  store.runs.push(run)
  return run
}

function validateScenario(
  scenario: ProcurementFixtureScenario
): ValidationResult {
  const reasons: string[] = []
  const warnings: string[] = []
  const availableInventory =
    scenario.sku.inventoryOnHand + scenario.sku.inboundUnits

  if (scenario.sku.dataFreshnessHours > 72)
    reasons.push("Source data is stale.")
  if (scenario.sku.duplicateOpenOrderUnits > 0)
    reasons.push("Existing open purchase order covers projected need.")
  if (availableInventory > scenario.sku.reorderPoint)
    reasons.push("Available inventory is above reorder point.")
  if (scenario.sku.recentSpikeMultiplier >= 1.5)
    warnings.push("Recent sales spike requires human acknowledgement.")

  if (
    scenario.sku.dataFreshnessHours > 72 ||
    scenario.sku.duplicateOpenOrderUnits > 0
  ) {
    return {
      status: "blocked",
      reasons,
      warnings,
      suppressRecommendation: true,
    }
  }
  if (availableInventory > scenario.sku.reorderPoint) {
    return { status: "pass", reasons, warnings, suppressRecommendation: true }
  }
  return {
    status: warnings.length > 0 ? "warn" : "pass",
    reasons,
    warnings,
    suppressRecommendation: false,
  }
}

function createEvent(
  store: WorkflowMemoryStore,
  companyId: string,
  definition: WorkflowDefinitionRecord,
  run: WorkflowRunRecord,
  scenario: ProcurementFixtureScenario,
  validation: ValidationResult,
  createdAt: string
): WorkflowEventRecord {
  const eventKey = `${definition.workflowType}:${scenario.sourceSnapshotId}`
  const event: WorkflowEventRecord = {
    id: idFor("event", companyId, eventKey),
    companyId,
    workflowRunId: run.id,
    workflowDefinitionId: definition.id,
    eventKey,
    eventType: "fixture_inventory_snapshot",
    origin: "fixture",
    sourceRef: {
      scenarioId: scenario.id,
      sourceSnapshotId: scenario.sourceSnapshotId,
    },
    payload: { runReason: scenario.runReason, sku: scenario.sku },
    freshnessState: scenario.sku.dataFreshnessHours > 72 ? "stale" : "fresh",
    validationStatus: validation.status,
    validationResult: validation,
    createdAt,
  }
  store.events.push(event)
  return event
}

function createItem(
  store: WorkflowMemoryStore,
  companyId: string,
  definition: WorkflowDefinitionRecord,
  run: WorkflowRunRecord,
  event: WorkflowEventRecord,
  scenario: ProcurementFixtureScenario,
  createdAt: string
): WorkflowItemRecord {
  const itemKey = `${definition.workflowType}:${scenario.sku.sku}:reorder_review`
  const item: WorkflowItemRecord = {
    id: idFor("item", companyId, itemKey),
    companyId,
    workflowRunId: run.id,
    workflowEventId: event.id,
    workflowDefinitionId: definition.id,
    itemKey,
    itemType: "procurement_reorder_review",
    title: `Review reorder recommendation for ${scenario.sku.sku}`,
    status: "active",
    priority: scenario.sku.recentSpikeMultiplier >= 1.5 ? 80 : 50,
    relatedRecords: {
      sku: scenario.sku.sku,
      vendor: scenario.sku.vendor,
      sourceSnapshotId: scenario.sourceSnapshotId,
    },
    resolutionState: {},
    createdAt,
    updatedAt: createdAt,
  }
  store.items.push(item)
  return item
}

function createContextPacket(
  store: WorkflowMemoryStore,
  companyId: string,
  run: WorkflowRunRecord,
  item: WorkflowItemRecord,
  scenario: ProcurementFixtureScenario,
  validation: ValidationResult,
  createdAt: string
): WorkflowContextPacketRecord {
  const { sku } = scenario
  const packet: WorkflowContextPacketRecord = {
    id: idFor("context", companyId, item.id),
    companyId,
    workflowRunId: run.id,
    workflowItemId: item.id,
    sources: [
      {
        source: "fixture_inventory",
        snapshotId: scenario.sourceSnapshotId,
        sku: sku.sku,
      },
      {
        source: "fixture_sales_velocity",
        snapshotId: scenario.sourceSnapshotId,
        sku: sku.sku,
      },
    ],
    facts: {
      availableInventory: sku.inventoryOnHand + sku.inboundUnits,
      reorderPoint: sku.reorderPoint,
      recent30DaySales: sku.recent30DaySales,
      trailing90DaySales: sku.trailing90DaySales,
      seasonalIndex: sku.seasonalIndex,
      leadTimeDays: sku.leadTimeDays,
      vendorMinimumOrderQuantity: sku.vendorMinimumOrderQuantity,
      vendorPackSize: sku.vendorPackSize,
    },
    memoryRefs: [],
    freshnessState: sku.dataFreshnessHours > 72 ? "stale" : "fresh",
    warnings: validation.warnings,
    createdAt,
  }
  store.contextPackets.push(packet)
  return packet
}

function createRecommendation(
  store: WorkflowMemoryStore,
  companyId: string,
  run: WorkflowRunRecord,
  item: WorkflowItemRecord,
  contextPacket: WorkflowContextPacketRecord,
  scenario: ProcurementFixtureScenario,
  validation: ValidationResult,
  createdAt: string
): WorkflowRecommendationRecord {
  const output = calculateRecommendation(scenario.sku)
  const recommendation: WorkflowRecommendationRecord = {
    id: idFor("recommendation", companyId, item.id),
    companyId,
    workflowRunId: run.id,
    workflowItemId: item.id,
    contextPacketId: contextPacket.id,
    status: "ready_for_review",
    rationaleSummary: `${scenario.sku.sku} is below reorder point; recommend ${output.recommendedQuantity} units for mock action review.`,
    warningState: validation.status,
    warnings: validation.warnings,
    confidence: validation.warnings.length > 0 ? 0.72 : 0.86,
    freshnessState: "fresh",
    input: contextPacket.facts,
    output,
    langSmithTraceId: run.langSmithTraceId,
    langSmithRunId: run.langSmithRunId,
    createdAt,
  }
  store.recommendations.push(recommendation)
  return recommendation
}

function createEvidence(
  store: WorkflowMemoryStore,
  companyId: string,
  run: WorkflowRunRecord,
  item: WorkflowItemRecord,
  recommendation: WorkflowRecommendationRecord,
  scenario: ProcurementFixtureScenario,
  validation: ValidationResult,
  createdAt: string
): WorkflowEvidenceRecord {
  const { sku } = scenario
  const evidence: WorkflowEvidenceRecord = {
    id: idFor("evidence", companyId, recommendation.id),
    companyId,
    workflowRunId: run.id,
    workflowItemId: item.id,
    recommendationRunId: recommendation.id,
    sourceRefs: [
      {
        source: "fixture_inventory",
        sourceSnapshotId: scenario.sourceSnapshotId,
        sku: sku.sku,
      },
      {
        source: "fixture_sales_velocity",
        sourceSnapshotId: scenario.sourceSnapshotId,
        sku: sku.sku,
      },
      { source: "fixture_validation", validationStatus: validation.status },
    ],
    assumptions: [
      "Fixture data is synthetic.",
      "Recommendation is mock-only and cannot write to a live vendor or ERP system.",
      "Projected sales use the higher of recent and trailing velocity, adjusted by seasonal and spike signals.",
    ],
    warnings: validation.warnings,
    evidence: [
      {
        label: "available_inventory",
        value: sku.inventoryOnHand + sku.inboundUnits,
      },
      { label: "reorder_point", value: sku.reorderPoint },
      {
        label: "duplicate_open_order_units",
        value: sku.duplicateOpenOrderUnits,
      },
      { label: "data_freshness_hours", value: sku.dataFreshnessHours },
    ],
    createdAt,
  }
  store.evidenceSnapshots.push(evidence)
  return evidence
}

function createDraft(
  store: WorkflowMemoryStore,
  companyId: string,
  run: WorkflowRunRecord,
  item: WorkflowItemRecord,
  recommendation: WorkflowRecommendationRecord,
  evidence: WorkflowEvidenceRecord,
  scenario: ProcurementFixtureScenario,
  createdAt: string
): WorkflowActionDraftRecord {
  const output = recommendation.output as ProcurementRecommendationOutput
  const payload: ProcurementMockActionPayload = {
    vendor: scenario.sku.vendor,
    lines: [
      {
        sku: scenario.sku.sku,
        quantity: output.recommendedQuantity,
        reason: recommendation.rationaleSummary,
      },
    ],
    mode: "mock",
  }
  const draft: WorkflowActionDraftRecord = {
    id: idFor("draft", companyId, item.id),
    companyId,
    workflowRunId: run.id,
    workflowItemId: item.id,
    recommendationRunId: recommendation.id,
    evidenceSnapshotId: evidence.id,
    actionType: "execute_mock_purchase_order",
    status: "pending_review",
    payload,
    payloadHash: hashWorkflowValue(payload),
    editPolicy: {
      editable: true,
      requireReason: true,
      immutablePaths: [
        ["vendor"],
        ["mode"],
        ...payload.lines.map((_, index) => ["lines", String(index), "sku"]),
      ],
      arrayLengthPaths: [["lines"]],
      positiveIntegerPaths: payload.lines.map((_, index) => [
        "lines",
        String(index),
        "quantity",
      ]),
      nonEmptyStringPaths: payload.lines.map((_, index) => [
        "lines",
        String(index),
        "reason",
      ]),
    },
    createdAt,
    updatedAt: createdAt,
  }
  store.drafts.push(draft)
  return draft
}

function calculateRecommendation(
  sku: ProcurementSkuSnapshot
): ProcurementRecommendationOutput {
  const availableInventory = sku.inventoryOnHand + sku.inboundUnits
  const recentDailySales = sku.recent30DaySales / 30
  const trailingDailySales = sku.trailing90DaySales / 90
  const projectedDailySales = roundToTwo(
    Math.max(recentDailySales, trailingDailySales * sku.seasonalIndex) *
      sku.recentSpikeMultiplier
  )
  const targetStock = Math.ceil(
    projectedDailySales * sku.leadTimeDays + sku.safetyStockUnits
  )
  const neededUnits = Math.max(0, targetStock - availableInventory)
  const quantityBeforePack = Math.max(
    neededUnits,
    sku.vendorMinimumOrderQuantity
  )
  const recommendedQuantity =
    Math.ceil(quantityBeforePack / sku.vendorPackSize) * sku.vendorPackSize
  return {
    sku: sku.sku,
    recommendedQuantity,
    projectedDailySales,
    projectedCoverageDays: roundToTwo(
      (availableInventory + recommendedQuantity) / projectedDailySales
    ),
    reorderPoint: sku.reorderPoint,
    availableInventory,
  }
}

function createFixtureAuditEvent(
  store: WorkflowMemoryStore,
  input: {
    companyId: string
    run: WorkflowRunRecord
    item: WorkflowItemRecord | null
    eventType: string
    summary: string
    payload: Record<string, unknown>
    createdAt: string
  }
): WorkflowAuditEventRecord {
  const event: WorkflowAuditEventRecord = {
    id: idFor(
      "audit",
      input.companyId,
      input.run.id,
      input.eventType,
      String(store.auditEvents.length + 1)
    ),
    companyId: input.companyId,
    actorType: "user",
    actorId: input.run.startedBy,
    workflowRunId: input.run.id,
    workflowItemId: input.item?.id ?? null,
    eventType: input.eventType,
    summary: input.summary,
    payload: input.payload,
    trace: {
      langGraphThreadId: input.run.langGraphThreadId,
      langGraphCheckpointId: input.run.langGraphCheckpointId,
      langSmithTraceId: input.run.langSmithTraceId,
      langSmithRunId: input.run.langSmithRunId,
    },
    createdAt: input.createdAt,
  }
  store.auditEvents.push(event)
  return event
}

function emptyFixtureResult(
  definition: WorkflowDefinitionRecord,
  run: WorkflowRunRecord,
  event: WorkflowEventRecord,
  auditEvents: WorkflowAuditEventRecord[]
): WorkflowFixtureRunResult {
  return {
    definition,
    run,
    event,
    item: null,
    contextPacket: null,
    recommendation: null,
    evidence: null,
    draft: null,
    auditEvents,
  }
}

function findLast<T>(
  records: T[],
  predicate: (record: T) => boolean
): T | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!
    if (predicate(record)) return record
  }
  return null
}

function idFor(prefix: string, ...parts: string[]): string {
  return workflowUuidFor(prefix, ...parts)
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100
}
