import { describe, expect, it, vi } from "vitest"
import { syntheticCompilerCapabilities } from "../skills/catalog-compiler"
import { compileAgentSkill } from "../skills/compiler"
import { WorkflowMemoryStore } from "../workflows"
import { runCompiledWorkflowInMemory } from "../runtime/memory-runner"
import {
  testCompleteContextResult,
  testContextRetriever,
} from "../runtime/context-test-support"
import { persistCompiledWorkflowReview } from "./persistence"

const companyId = "20000000-0000-4000-8000-000000000001"
const workflowId = "a0000000-0000-4000-8000-000000000001"
const snapshotId = "b0000000-0000-4000-8000-000000000001"

describe("compiled workflow review persistence", () => {
  it("uses the controlled RPC and the existing fixture payload shape", async () => {
    const manifest = compileAgentSkill({
      source: minimalSkill,
      capabilities: syntheticCompilerCapabilities(),
    })
    if (!manifest.ok) throw new Error("Test manifest did not compile.")
    const baseContext = testCompleteContextResult()
    const retrievedContext = {
      ...baseContext,
      provenance: {
        ...baseContext.provenance,
        scope: { companyId, workspaceScopeId: companyId },
      },
    }
    const run = await runCompiledWorkflowInMemory({
      store: new WorkflowMemoryStore(),
      manifest: manifest.manifest,
      companyId,
      actorUserId: "10000000-0000-4000-8000-000000000001",
      workflowDefinitionId: workflowId,
      trigger: { id: "test", kind: "fixture", input: {} },
      capabilityProvider: {
        load: async () => ({
          data: { products: { products: [] } },
          sourceRefs: [],
        }),
      },
      contextRetriever: testContextRetriever(retrievedContext),
      agentJudgment: async () => ({
        proposal: { selection: { sku: "SYN-1" } },
        rationale: "Synthetic test selection.",
        confidence: 0.75,
        warnings: [],
        context: {},
      }),
      now: new Date("2026-07-13T12:00:00.000Z"),
    })
    let capturedPayload: unknown
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      capturedPayload = args.p_payload
      return {
        data: {
          workflowRunId: run.run.id,
          itemId: run.item!.id,
          draftId: null,
          duplicate: false,
        },
        error: null,
      }
    })

    const persisted = await persistCompiledWorkflowReview({
      supabase: { rpc } as never,
      companyId,
      workflowId,
      bindingSnapshotId: snapshotId,
      result: run,
      inputHash: "a".repeat(64),
      clientSurface: "cli",
    })

    expect(persisted.workflowRunId).toBe(run.run.id)
    expect(rpc).toHaveBeenCalledWith(
      "persist_compiled_workflow_review_controlled",
      expect.objectContaining({
        p_company_id: companyId,
        p_workflow_id: workflowId,
        p_binding_snapshot_id: snapshotId,
        p_input_hash: "a".repeat(64),
        p_client_surface: "cli",
        p_payload: expect.objectContaining({
          company_id: companyId,
          definition: expect.objectContaining({ id: workflowId }),
          run: expect.objectContaining({ workflow_id: workflowId }),
          event: expect.objectContaining({ workflow_id: workflowId }),
          item: expect.any(Object),
          context_packet: expect.any(Object),
          recommendation: expect.any(Object),
          evidence: expect.any(Object),
          draft: null,
          audit_events: expect.any(Array),
        }),
      })
    )
    const payload = capturedPayload as {
      context_packet: {
        facts: Record<string, unknown>
        memory_refs: unknown[]
      }
    }
    expect(payload.context_packet.facts).toMatchObject({
      __mandalaOperationalContextV1: retrievedContext.provenance,
    })
    expect(payload.context_packet.memory_refs).toEqual([])
  })
})

const minimalSkill = `---
api_version: mandala.ai/v1
kind: agent_workflow
metadata:
  id: minimal-review
  name: Minimal Review
  version: 1.0.0
  description: Creates a minimal synthetic review.
workflow:
  type: minimal_review
  status: draft
  default_mode: mock
  triggers:
    - id: test
      kind: fixture
      description: Test safely.
capabilities:
  - id: commerce.catalog.read
    as: products
    access: read
    version: 1.0.0
    required: true
    use_in_prompt: true
    description: Read products.
rules:
  - id: selected
    operation: required_fields
    source: agent.selection
    fields: [sku]
records:
  item:
    type: minimal_review
    key: { template: "minimal:{{agent.selection.sku}}" }
    title: { template: "Review {{agent.selection.sku}}" }
    priority: { value: 50 }
    related: { sku: { path: agent.selection.sku } }
  recommendation:
    rationale: { path: agent.rationale }
    confidence: { path: agent.confidence }
    output: { sku: { path: agent.selection.sku } }
evidence:
  requirements: [Product identity]
  assumptions: []
  source_capabilities: [commerce.catalog.read]
approvals: []
actions: []
tests: []
---

# Minimal Review

## Purpose
Create a safe synthetic review.

## Investigation Guidance
Inspect the product identity.

## Decision Guidance
Create one review.

## Exceptions
Block missing product identity.

## Output Quality
Use clear language.
`
