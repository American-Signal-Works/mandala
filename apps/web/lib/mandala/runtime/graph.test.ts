import { MemorySaver } from "@langchain/langgraph"
import { describe, expect, it, vi } from "vitest"
import type { CompiledAgentManifest } from "../skills/compiler"
import { createGenericWorkflowRuntime } from "./graph"

const manifest = createManifest()

describe("generic workflow runtime", () => {
  it("checkpoints at human approval and resumes without rerunning judgment", async () => {
    const checkpointer = new MemorySaver()
    const capabilityLoad = vi.fn(async () => ({
      data: {
        catalog: { sku: "DEMO-1", quantity: 2, target: 21, pack: 6 },
      },
      sourceRefs: [
        {
          capabilityAlias: "catalog",
          connectorId: "demo-connector",
          observedAt: "2026-07-13T12:00:00.000Z",
          reference: { snapshotId: "snapshot-1" },
        },
      ],
    }))
    const judgment = vi.fn(async () => ({
      proposal: { selectedSku: "DEMO-1" },
      rationale: "DEMO-1 needs review because stock is below its target.",
      confidence: 0.84,
      warnings: [],
      context: {},
    }))
    const persistReview = vi.fn(async () => ({
      workflowItemId: "item-1",
      recommendationId: "recommendation-1",
      evidenceId: "evidence-1",
      actionDraftId: "draft-1",
    }))
    const executeAction = vi.fn(async () => ({
      attemptId: "attempt-1",
      status: "succeeded" as const,
      output: { externalId: "mock-1" },
    }))
    const dependencies = {
      capabilityProvider: { load: capabilityLoad },
      agentJudgment: judgment,
      reviewPersister: persistReview,
      actionHandler: executeAction,
    }
    const firstRuntime = createGenericWorkflowRuntime({
      manifest,
      dependencies,
      checkpointer,
    })

    const started = await firstRuntime.start({
      companyId: "company-1",
      actorId: "user-1",
      workflowDefinitionId: "workflow-1",
      workflowRunId: "run-1",
      manifestDigest: manifest.manifestDigest,
      mode: "mock",
      trigger: { id: "manual", kind: "manual", input: {} },
    })

    expect(started.output.status).toBe("waiting_for_approval")
    expect(started.output.review).toMatchObject({
      item: {
        key: "DEMO-1",
        title: "Review DEMO-1",
        priority: 80,
      },
      recommendation: { output: { quantity: 24 } },
      draft: { action: "create_demo_draft" },
    })
    expect(started.output.__interrupt__).toBeTruthy()
    expect(started.correlation).toMatchObject({
      threadId: "run-1",
    })
    expect(started.correlation.checkpointId).toBeTruthy()
    expect(executeAction).not.toHaveBeenCalled()

    const resumedRuntime = createGenericWorkflowRuntime({
      manifest,
      dependencies,
      checkpointer,
    })
    const resumed = await resumedRuntime.resume({
      workflowRunId: "run-1",
      decision: {
        decisionId: "decision-1",
        decision: "approve",
        warningsAcknowledged: true,
      },
    })

    expect(resumed.output.status).toBe("executed")
    expect(resumed.output.actionResult).toMatchObject({
      attemptId: "attempt-1",
      status: "succeeded",
    })
    expect(resumed.correlation.threadId).toBe("run-1")
    expect(resumed.correlation.checkpointId).not.toBe(
      started.correlation.checkpointId
    )
    expect(capabilityLoad).toHaveBeenCalledTimes(1)
    expect(judgment).toHaveBeenCalledTimes(1)
    expect(persistReview).toHaveBeenCalledTimes(1)
    expect(executeAction).toHaveBeenCalledTimes(1)

    const duplicate = await resumedRuntime.resume({
      workflowRunId: "run-1",
      decision: {
        decisionId: "decision-1",
        decision: "approve",
        warningsAcknowledged: true,
      },
    })
    expect(duplicate.output.status).toBe("executed")
    expect(executeAction).toHaveBeenCalledTimes(1)
    await expect(
      resumedRuntime.resume({
        workflowRunId: "run-1",
        decision: { decisionId: "decision-other", decision: "reject" },
      })
    ).rejects.toThrow("already resumed with a different decision")
  })

  it("routes a rejection to audit without invoking an action", async () => {
    const executeAction = vi.fn()
    const runtime = createGenericWorkflowRuntime({
      manifest,
      dependencies: {
        capabilityProvider: {
          load: async () => ({
            data: {
              catalog: { sku: "DEMO-2", quantity: 1, target: 10, pack: 2 },
            },
            sourceRefs: [],
          }),
        },
        agentJudgment: async () => ({
          proposal: { selectedSku: "DEMO-2" },
          rationale: "DEMO-2 needs a human review before any draft action.",
          confidence: 0.75,
          warnings: [],
          context: {},
        }),
        reviewPersister: async () => ({
          workflowItemId: "item-2",
          recommendationId: "recommendation-2",
          evidenceId: "evidence-2",
          actionDraftId: "draft-2",
        }),
        actionHandler: executeAction,
      },
    })
    await runtime.start({
      companyId: "company-1",
      actorId: "user-1",
      workflowDefinitionId: "workflow-1",
      workflowRunId: "run-2",
      manifestDigest: manifest.manifestDigest,
      mode: "mock",
      trigger: { id: "manual", kind: "manual", input: {} },
    })

    const result = await runtime.resume({
      workflowRunId: "run-2",
      decision: { decisionId: "decision-2", decision: "reject" },
    })

    expect(result.output.status).toBe("rejected")
    expect(result.output.auditEvents.at(-1)?.eventType).toBe(
      "workflow_runtime_completed"
    )
    expect(executeAction).not.toHaveBeenCalled()
  })
})

function createManifest(): CompiledAgentManifest {
  return {
    schemaVersion: "mandala.ai/v1",
    compilerVersion: "1.0.0",
    sourceDigest: "source-digest",
    manifestDigest: "manifest-digest",
    identity: {
      id: "demo.agent",
      name: "Demo agent",
      version: "1.0.0",
      description: "A generic runtime test agent.",
    },
    workflow: {
      type: "demo_review",
      status: "draft",
      default_mode: "mock",
      triggers: [
        { id: "manual", kind: "manual", description: "Run manually." },
      ],
    },
    capabilityBindings: [
      {
        id: "demo.catalog.read",
        version: "1.0.0",
        access: "read",
        connectorId: "demo-connector",
        schemaDigest: "catalog-schema",
        toolName: "read_catalog",
        healthy: true,
        granted: true,
        alias: "catalog",
        useInPrompt: true,
      },
      {
        id: "demo.draft.create",
        version: "1.0.0",
        access: "propose",
        connectorId: "demo-connector",
        schemaDigest: "draft-schema",
        toolName: "create_draft",
        healthy: true,
        granted: true,
        alias: "drafts",
        useInPrompt: false,
      },
    ],
    graph: [
      node("resolve_bindings", []),
      node("load_data", ["read_catalog"]),
      node("validate", []),
      node("agent_judgment", ["read_catalog"], false),
      node("apply_rules", []),
      node("project_records", []),
      node("persist_review", []),
      node("human_approval", []),
      node("execute_action", []),
      node("audit", []),
    ],
    rules: [
      {
        id: "required_catalog",
        operation: "required_fields",
        source: "data.catalog",
        fields: ["sku", "quantity", "target", "pack"],
      },
      {
        id: "needed",
        operation: "formula",
        expression: {
          operator: "subtract",
          operands: [
            { path: "data.catalog.target" },
            { path: "data.catalog.quantity" },
          ],
        },
        output: "rules.needed",
      },
      {
        id: "quantity",
        operation: "round_to_pack",
        quantity: { path: "rules.needed" },
        pack_size: { path: "data.catalog.pack" },
        output: "rules.quantity",
      },
      {
        id: "priority",
        operation: "priority",
        bands: [
          {
            when: {
              left: { path: "rules.needed" },
              operator: "gt",
              right: { value: 10 },
            },
            value: 80,
          },
        ],
        default: 50,
        output: "rules.priority",
      },
    ],
    records: {
      item: {
        type: "demo_review",
        key: { path: "data.catalog.sku" },
        title: { template: "Review {{data.catalog.sku}}" },
        priority: { path: "rules.priority" },
        related: { sku: { path: "data.catalog.sku" } },
      },
      recommendation: {
        rationale: { path: "agent.rationale" },
        confidence: { path: "agent.confidence" },
        output: { quantity: { path: "rules.quantity" } },
      },
      draft: {
        action: "create_demo_draft",
        payload: {
          sku: { path: "data.catalog.sku" },
          quantity: { path: "rules.quantity" },
        },
        edit_policy: {
          editable: true,
          require_reason: true,
          immutable_paths: [["sku"]],
          array_length_paths: [],
          positive_integer_paths: [["quantity"]],
          non_empty_string_paths: [],
        },
      },
    },
    evidence: {
      requirements: ["Catalog snapshot"],
      assumptions: [],
      source_capabilities: ["catalog"],
    },
    approvals: [
      {
        action: "create_demo_draft",
        minimum_role: "approver",
        human_required: true,
        warning_acknowledgement: false,
      },
    ],
    actions: [
      {
        id: "create_demo_draft",
        capability: "demo.draft.create",
        mode: "mock",
        requires_approval: true,
      },
    ],
    tests: [],
    guidance: {
      purpose: "Create a review.",
      investigation: "Inspect provided data.",
      decision: "Propose one result.",
      exceptions: "Stop when data is missing.",
      outputQuality: "Use source facts.",
    },
  }
}

function node(
  handler: CompiledAgentManifest["graph"][number]["handler"],
  allowedTools: string[],
  idempotencyRequired = true
): CompiledAgentManifest["graph"][number] {
  return { id: handler, handler, allowedTools, idempotencyRequired }
}
