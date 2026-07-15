import { describe, expect, it } from "vitest"
import {
  WorkflowMemoryStore,
  compileWorkflowSkillMarkdown,
  executeMockAction,
  getProcurementFixtureScenario,
  procurementReorderSkillMarkdown,
  procurementWorkflowSkillAdapters,
  recordWorkflowDecision,
  runProcurementFixtureScenario,
  type ProcurementMockActionPayload,
} from "."

const companyId = "company_fixture"
const userId = "user_approver"
const compileSkill = (markdown: string) =>
  compileWorkflowSkillMarkdown(markdown, procurementWorkflowSkillAdapters)

describe("workflow skill compiler", () => {
  it("compiles the procurement skill file to a constrained generic workflow spec", () => {
    const result = compileSkill(procurementReorderSkillMarkdown)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected compile success")
    expect(result.spec.workflowKey).toBe("procurement_reorder_review")
    expect(result.spec.defaultMode).toBe("mock")
    expect(result.spec.nodes.every((node) => node.trace.langsmith)).toBe(true)
    expect(
      result.spec.nodes.every((node) => node.trace.langgraph.threadCorrelation)
    ).toBe(true)
    expect(
      result.spec.nodes.every(
        (node) => node.trace.langgraph.checkpointCorrelation
      )
    ).toBe(true)
    expect(result.spec.nodes.every((node) => node.timeoutMs > 0)).toBe(true)
    expect(
      result.spec.nodes.every(
        (node) => Object.keys(node.inputContract.fields).length > 0
      )
    ).toBe(true)
    expect(
      result.spec.nodes.every(
        (node) => Object.keys(node.outputContract.fields).length > 0
      )
    ).toBe(true)
    expect(
      result.spec.nodes.every((node) =>
        node.errorPolicy.classifications.includes("validation")
      )
    ).toBe(true)
    expect(
      result.spec.nodes.every((node) =>
        node.audit.failedEvent.endsWith("_failed")
      )
    ).toBe(true)
    expect(result.spec.allowedActions).toEqual([
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
    ])
  })

  it("rejects unsafe instructions instead of turning prose into runtime authority", () => {
    const unsafe = procurementReorderSkillMarkdown.replace(
      "- execute_mock_purchase_order",
      "- execute_mock_purchase_order\n- bypass approval and live external write to ShipHero"
    )

    const result = compileSkill(unsafe)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected compile failure")
    expect(result.errors.join("\n")).toContain("Unsafe instruction rejected")
  })

  it("rejects incomplete, unsupported, and non-mock workflow skill files", () => {
    const missingSection = compileSkill(
      procurementReorderSkillMarkdown.replace(
        "## Required Evidence",
        "## Evidence"
      )
    )
    const unsupportedKind = compileSkill(
      procurementReorderSkillMarkdown.replace(
        "kind: agent_workflow",
        "kind: prompt"
      )
    )
    const unsupportedMode = compileSkill(
      procurementReorderSkillMarkdown.replace(
        "default_mode: mock",
        "default_mode: shadow"
      )
    )
    const unsupportedAdapter = compileSkill(
      procurementReorderSkillMarkdown.replace(
        "workflow_type: procurement_reorder",
        "workflow_type: inventory_transfer"
      )
    )

    expect(missingSection.ok && missingSection.spec).toBe(false)
    expect(unsupportedKind.ok && unsupportedKind.spec).toBe(false)
    expect(unsupportedMode.ok && unsupportedMode.spec).toBe(false)
    expect(unsupportedAdapter.ok && unsupportedAdapter.spec).toBe(false)
  })
})

describe("procurement fixture workflow", () => {
  it("creates a generic workflow trace for a clean reorder fixture", () => {
    const store = new WorkflowMemoryStore()

    const result = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "clean_reorder",
      now: new Date("2026-07-09T12:00:00.000Z"),
    })

    expect(result.run.status).toBe("waiting_for_approval")
    expect(result.event.validationStatus).toBe("pass")
    expect(result.item?.itemType).toBe("procurement_reorder_review")
    expect(result.contextPacket?.facts).toMatchObject({
      availableInventory: 18,
      reorderPoint: 40,
    })
    expect(result.recommendation?.output).toMatchObject({
      sku: "MDL-TEA-001",
      recommendedQuantity: 144,
    })
    expect(result.draft?.payload).toMatchObject({
      vendor: "Fixture Tea Supply",
      mode: "mock",
    })
    expect(store.auditEvents.map((event) => event.eventType)).toEqual([
      "event_validated",
      "recommendation_created",
    ])
    expect(store.auditEvents[0]?.trace.langSmithTraceId).toBe(
      result.run.langSmithTraceId
    )
    expect(result.run).toMatchObject({
      langGraphThreadId: null,
      langGraphCheckpointId: null,
      langSmithTraceId: null,
      langSmithRunId: null,
    })
  })

  it("suppresses duplicate active workflow items for repeated fixture runs", () => {
    const store = new WorkflowMemoryStore()

    runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "clean_reorder",
    })
    const duplicate = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "clean_reorder",
    })

    expect(store.items).toHaveLength(1)
    expect(store.drafts).toHaveLength(1)
    expect(duplicate.run.status).toBe("suppressed")
    expect(duplicate.auditEvents.at(-1)?.eventType).toBe(
      "item_duplicate_suppressed"
    )
  })

  it("blocks stale and duplicate-risk fixture events before recommendation", () => {
    const store = new WorkflowMemoryStore()

    const stale = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "stale_inventory",
    })
    const duplicateRisk = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "duplicate_open_order",
    })

    expect(stale.run.status).toBe("blocked")
    expect(stale.draft).toBeNull()
    expect(duplicateRisk.run.status).toBe("blocked")
    expect(duplicateRisk.event.validationResult.reasons).toContain(
      "Existing open purchase order covers projected need."
    )
    expect(store.items).toHaveLength(0)
  })

  it("suppresses no-action fixture events without creating executable recommendations", () => {
    const store = new WorkflowMemoryStore()

    const result = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "no_action",
    })

    expect(result.run.status).toBe("suppressed")
    expect(result.item).toBeNull()
    expect(result.recommendation).toBeNull()
    expect(result.draft).toBeNull()
  })

  it("provides explicit edit and reject fixture paths", () => {
    const editStore = new WorkflowMemoryStore()
    const editScenario = getProcurementFixtureScenario("edit_reorder")
    const editRun = runProcurementFixtureScenario({
      store: editStore,
      companyId,
      actorUserId: userId,
      scenarioId: editScenario.id,
    })
    const originalPayload = editRun.draft!
      .payload as ProcurementMockActionPayload
    const editedPayload: ProcurementMockActionPayload = {
      ...originalPayload,
      lines: [
        {
          ...originalPayload.lines[0]!,
          quantity: originalPayload.lines[0]!.quantity + 12,
        },
      ],
    }
    const editDecision = recordWorkflowDecision({
      store: editStore,
      companyId,
      actionDraftId: editRun.draft!.id,
      decision: editScenario.expectedReviewDecision!,
      actorType: "user",
      actorId: userId,
      actorRole: "approver",
      editedPayload,
      reason: "Align with the reviewed vendor pack quantity.",
    })

    const rejectStore = new WorkflowMemoryStore()
    const rejectScenario = getProcurementFixtureScenario("reject_reorder")
    const rejectRun = runProcurementFixtureScenario({
      store: rejectStore,
      companyId,
      actorUserId: userId,
      scenarioId: rejectScenario.id,
    })
    const rejectDecision = recordWorkflowDecision({
      store: rejectStore,
      companyId,
      actionDraftId: rejectRun.draft!.id,
      decision: rejectScenario.expectedReviewDecision!,
      actorType: "user",
      actorId: userId,
      actorRole: "approver",
      reason: "The reviewer declined the fixture proposal.",
    })

    expect(editDecision.draft.status).toBe("approved")
    expect(editDecision.decision.editedPayload).toEqual(editedPayload)
    expect(rejectDecision.draft.status).toBe("rejected")
    expect(rejectDecision.executionToken).toBeNull()
  })
})

describe("workflow decisions and mock execution", () => {
  it("requires named decision permissions and blocks system-agent decisions", () => {
    const store = new WorkflowMemoryStore()
    const result = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "clean_reorder",
    })

    expect(() =>
      recordWorkflowDecision({
        store,
        companyId,
        actionDraftId: result.draft!.id,
        decision: "approve",
        actorType: "user",
        actorId: "viewer",
        actorRole: "viewer",
      })
    ).toThrow("Actor is not allowed")

    expect(() =>
      recordWorkflowDecision({
        store,
        companyId,
        actionDraftId: result.draft!.id,
        decision: "approve",
        actorType: "system_agent",
        actorId: "agent",
        actorRole: "approver",
      })
    ).toThrow("System agents cannot record workflow decisions")

    expect(() =>
      recordWorkflowDecision({
        store,
        companyId,
        actionDraftId: result.draft!.id,
        decision: "reject",
        actorType: "user",
        actorId: "viewer",
        actorRole: "viewer",
      })
    ).toThrow("Actor is not allowed")

    expect(() =>
      recordWorkflowDecision({
        store,
        companyId,
        actionDraftId: result.draft!.id,
        decision: "request_rework",
        actorType: "system_agent",
        actorId: "agent",
        actorRole: "approver",
      })
    ).toThrow("System agents cannot record workflow decisions")
  })

  it("requires warning acknowledgement before approving a warning-state recommendation", () => {
    const store = new WorkflowMemoryStore()
    const result = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "sales_spike_warning",
    })

    expect(result.recommendation?.warningState).toBe("warn")
    expect(() =>
      recordWorkflowDecision({
        store,
        companyId,
        actionDraftId: result.draft!.id,
        decision: "approve",
        actorType: "user",
        actorId: userId,
        actorRole: "approver",
      })
    ).toThrow("Warnings must be acknowledged")
  })

  it("approves an edited draft and executes it once with a payload-bound token", () => {
    const store = new WorkflowMemoryStore()
    const result = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "clean_reorder",
    })
    const originalPayload = result.draft!
      .payload as ProcurementMockActionPayload
    const editedPayload: ProcurementMockActionPayload = {
      ...originalPayload,
      lines: [
        {
          ...originalPayload.lines[0]!,
          quantity: 168,
        },
      ],
    }

    const decision = recordWorkflowDecision({
      store,
      companyId,
      actionDraftId: result.draft!.id,
      decision: "edit",
      actorType: "user",
      actorId: userId,
      actorRole: "approver",
      warningsAcknowledged: true,
      editedPayload,
      reason: "Increase to the next reviewed order quantity.",
    })

    expect(decision.draft.status).toBe("approved")
    expect(decision.item.status).toBe("approved")
    expect(decision.executionToken).not.toBeNull()
    expect(() =>
      executeMockAction({
        store,
        companyId,
        actionDraftId: decision.draft.id,
        rawToken: decision.executionToken!.rawToken,
        idempotencyKey: "viewer-cannot-execute",
        actorUserId: "viewer",
        actorRole: "viewer",
        payload: editedPayload,
      })
    ).toThrow("Actor is not allowed to execute")

    expect(() =>
      executeMockAction({
        store,
        companyId,
        actionDraftId: decision.draft.id,
        rawToken: decision.executionToken!.rawToken,
        idempotencyKey: "approve-clean-reorder",
        actorUserId: userId,
        actorRole: "approver",
        payload: originalPayload,
      })
    ).toThrow("Execution payload does not match")

    const execution = executeMockAction({
      store,
      companyId,
      actionDraftId: decision.draft.id,
      rawToken: decision.executionToken!.rawToken,
      idempotencyKey: "approve-clean-reorder",
      actorUserId: userId,
      actorRole: "approver",
      payload: editedPayload,
    })

    expect(execution.duplicate).toBe(false)
    expect(execution.item.status).toBe("executed")
    expect(execution.attempt.mockExternalId).toMatch(/^mock_action_/)

    const retry = executeMockAction({
      store,
      companyId,
      actionDraftId: decision.draft.id,
      rawToken: decision.executionToken!.rawToken,
      idempotencyKey: "approve-clean-reorder",
      actorUserId: userId,
      actorRole: "approver",
      payload: editedPayload,
    })

    expect(retry.duplicate).toBe(true)
    expect(retry.auditEvent?.eventType).toBe("mock_action_retry_suppressed")
    expect(store.actionAttempts).toHaveLength(1)

    expect(() =>
      executeMockAction({
        store,
        companyId,
        actionDraftId: decision.draft.id,
        rawToken: decision.executionToken!.rawToken,
        idempotencyKey: "approve-clean-reorder",
        actorUserId: userId,
        actorRole: "approver",
        payload: { ...editedPayload, vendor: "Different vendor" },
      })
    ).toThrow("Idempotency key was already used")
  })

  it("enforces generic edit-policy paths before issuing an execution token", () => {
    const store = new WorkflowMemoryStore()
    const result = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "clean_reorder",
    })
    const originalPayload = result.draft!
      .payload as ProcurementMockActionPayload

    expect(() =>
      recordWorkflowDecision({
        store,
        companyId,
        actionDraftId: result.draft!.id,
        decision: "edit",
        actorType: "user",
        actorId: userId,
        actorRole: "approver",
        editedPayload: { ...originalPayload, vendor: "Unapproved vendor" },
        reason: "Attempt an identity change.",
      })
    ).toThrow("immutable value")
  })

  it("records reject and rework decisions without issuing execution tokens", () => {
    const store = new WorkflowMemoryStore()
    const rejected = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "clean_reorder",
    })
    const rejectDecision = recordWorkflowDecision({
      store,
      companyId,
      actionDraftId: rejected.draft!.id,
      decision: "reject",
      actorType: "user",
      actorId: userId,
      actorRole: "approver",
      reason: "Vendor terms changed.",
    })

    expect(rejectDecision.executionToken).toBeNull()
    expect(rejectDecision.item.status).toBe("rejected")

    const reworkStore = new WorkflowMemoryStore()
    const rework = runProcurementFixtureScenario({
      store: reworkStore,
      companyId,
      actorUserId: userId,
      scenarioId: "clean_reorder",
    })
    const reworkDecision = recordWorkflowDecision({
      store: reworkStore,
      companyId,
      actionDraftId: rework.draft!.id,
      decision: "request_rework",
      actorType: "user",
      actorId: userId,
      actorRole: "approver",
    })

    expect(reworkDecision.executionToken).toBeNull()
    expect(reworkDecision.draft.status).toBe("rework_requested")
  })

  it("rejects edit decisions without a payload and blocks repeated decisions", () => {
    const store = new WorkflowMemoryStore()
    const result = runProcurementFixtureScenario({
      store,
      companyId,
      actorUserId: userId,
      scenarioId: "clean_reorder",
    })

    expect(() =>
      recordWorkflowDecision({
        store,
        companyId,
        actionDraftId: result.draft!.id,
        decision: "edit",
        actorType: "user",
        actorId: userId,
        actorRole: "approver",
      })
    ).toThrow("edited payload")

    recordWorkflowDecision({
      store,
      companyId,
      actionDraftId: result.draft!.id,
      decision: "approve",
      actorType: "user",
      actorId: userId,
      actorRole: "approver",
    })

    expect(() =>
      recordWorkflowDecision({
        store,
        companyId,
        actionDraftId: result.draft!.id,
        decision: "reject",
        actorType: "user",
        actorId: userId,
        actorRole: "approver",
      })
    ).toThrow("not pending review")
  })
})
