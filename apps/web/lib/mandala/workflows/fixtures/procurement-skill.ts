import {
  workflowSpecSchema,
  type WorkflowNode,
  type WorkflowSkillAdapter,
  type WorkflowSpec,
} from "../schema"

export const procurementReorderSkillMarkdown = `---
name: Procurement Reorder Review
kind: agent_workflow
workflow_type: procurement_reorder
version: 0.1.0
status: draft
default_mode: mock
---

## Goal
Identify SKUs that need reorder review, assemble evidence, recommend a mock purchase-order draft, and wait for human approval.

## When To Run
- Manual fixture run
- Future scheduled inventory review

## Data Needed
- Inventory counts
- Reorder levels
- Recent sales velocity
- Open purchase orders
- Vendor pack size and minimum order quantity

## Candidate Selection
- Consider SKUs where available inventory is at or below reorder point.
- Block recommendations when source data is stale or a duplicate open order already covers the need.

## Recommendation Behavior
- Use deterministic SKU signal calculations first.
- Create reviewable recommendations only for bounded candidate sets.
- Include quantity, rationale summary, warnings, and confidence markers.

## Required Evidence
- Inventory snapshot
- Sales velocity summary
- Reorder point and projected coverage
- Duplicate/open-order check
- Freshness check

## Approval Rules
- Human approval is required before mock execution.
- Warnings must be acknowledged.
- System agents cannot self-approve.

## Allowed Actions
- create_mock_purchase_order_draft
- execute_mock_purchase_order

## User Review Options
- approve
- edit
- reject
- request_rework
`

const requiredSections = [
  "Goal",
  "When To Run",
  "Data Needed",
  "Candidate Selection",
  "Recommendation Behavior",
  "Required Evidence",
  "Approval Rules",
  "Allowed Actions",
  "User Review Options",
] as const

export const procurementWorkflowSkillAdapter: WorkflowSkillAdapter = {
  workflowType: "procurement_reorder",
  requiredSections,
  compile: (frontmatter) =>
    createProcurementReorderWorkflowSpec({
      name: frontmatter.name,
      workflowType: frontmatter.workflow_type,
      version: frontmatter.version,
      status: frontmatter.status as WorkflowSpec["status"] | undefined,
      defaultMode: frontmatter.default_mode as
        | WorkflowSpec["defaultMode"]
        | undefined,
    }),
}

export const procurementWorkflowSkillAdapters = [
  procurementWorkflowSkillAdapter,
] as const

export function createProcurementReorderWorkflowSpec(
  overrides: Partial<
    Pick<
      WorkflowSpec,
      "name" | "workflowType" | "version" | "status" | "defaultMode"
    >
  > = {}
): WorkflowSpec {
  return workflowSpecSchema.parse({
    workflowKey: "procurement_reorder_review",
    workflowType: overrides.workflowType ?? "procurement_reorder",
    name: overrides.name ?? "Procurement Reorder Review",
    version: overrides.version ?? "0.1.0",
    status: overrides.status ?? "draft",
    defaultMode: overrides.defaultMode ?? "mock",
    triggers: [
      {
        id: "manual_fixture_run",
        kind: "fixture",
        description: "Start from deterministic fixture data.",
      },
    ],
    dataSources: [
      {
        id: "inventory_counts",
        description: "Current inventory by SKU.",
        required: true,
      },
      {
        id: "reorder_levels",
        description: "SKU reorder points and safety stock.",
        required: true,
      },
      {
        id: "sales_velocity",
        description: "Recent sales and seasonal trend signals.",
        required: true,
      },
      {
        id: "open_purchase_orders",
        description: "Existing purchase orders used for duplicate-risk checks.",
        required: true,
      },
    ],
    nodes: [
      workflowNode(
        "sync_source_data",
        "source_sync",
        "Sync source data",
        ["read_fixture_records"],
        false
      ),
      workflowNode(
        "validate_event",
        "validation",
        "Validate event freshness and duplicate risk",
        ["validate_fixture_event"],
        true
      ),
      workflowNode(
        "route_work_item",
        "routing",
        "Route or suppress work item",
        ["route_work_item"],
        true
      ),
      workflowNode(
        "assemble_context",
        "context_assembly",
        "Assemble frozen context packet",
        ["assemble_context_packet"],
        true
      ),
      workflowNode(
        "generate_recommendation",
        "recommendation",
        "Generate reviewable recommendation",
        ["compute_reorder_recommendation"],
        true
      ),
      workflowNode(
        "create_mock_draft",
        "draft_action",
        "Create mock action draft",
        ["create_mock_action_draft"],
        true
      ),
      workflowNode(
        "record_decision",
        "human_approval",
        "Record human approval decision",
        ["record_human_decision"],
        true
      ),
      workflowNode(
        "execute_mock_action",
        "mock_execution",
        "Execute approved mock action",
        ["execute_mock_action"],
        true
      ),
      workflowNode(
        "write_audit_events",
        "audit",
        "Write durable audit events",
        ["write_workflow_audit_event"],
        true
      ),
    ],
    evidenceRequirements: [
      "Inventory snapshot",
      "Sales velocity summary",
      "Reorder point and projected coverage",
      "Duplicate/open-order check",
      "Freshness check",
    ],
    approvalRules: [
      {
        actionType: "execute_mock_purchase_order",
        minimumRole: "approver",
        requireHumanApproval: true,
        requireWarningAcknowledgement: true,
      },
    ],
    allowedActions: [
      {
        actionType: "create_mock_purchase_order_draft",
        mode: "mock",
        requiresApproval: false,
      },
      {
        actionType: "execute_mock_purchase_order",
        mode: "mock",
        requiresApproval: true,
      },
    ],
  })
}

function workflowNode(
  id: WorkflowNode["id"],
  kind: WorkflowNode["kind"],
  title: string,
  allowedTools: string[],
  idempotencyRequired: boolean
): WorkflowNode {
  return {
    id,
    kind,
    title,
    allowedTools,
    timeoutMs: 30_000,
    retry: { maxAttempts: 2, backoffMs: 500 },
    idempotencyRequired,
    inputContract: {
      schemaVersion: "1",
      type: "object",
      fields: { company_id: "uuid", workflow_run_id: "uuid" },
    },
    outputContract: {
      schemaVersion: "1",
      type: "object",
      fields: { status: "string", workflow_run_id: "uuid" },
    },
    errorPolicy: {
      classifications: [
        "authorization",
        "permanent",
        "transient",
        "validation",
      ],
      retryable: ["transient"],
      onExhausted: kind === "human_approval" ? "request_rework" : "block",
    },
    audit: {
      startedEvent: `${id}_started`,
      completedEvent: `${id}_completed`,
      failedEvent: `${id}_failed`,
    },
    trace: {
      langsmith: true,
      langgraph: { threadCorrelation: true, checkpointCorrelation: true },
      eventName: id,
    },
  }
}
