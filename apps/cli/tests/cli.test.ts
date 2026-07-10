import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Writable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ControlApi } from "../src/api-client.js"
import { executeCliCommand, runCli } from "../src/cli.js"
import { CliError } from "../src/errors.js"
import { SecureStore } from "../src/persistence.js"

const companyId = "20000000-0000-4000-8000-000000000001"
const runId = "30000000-0000-4000-8000-000000000001"
const itemId = "40000000-0000-4000-8000-000000000001"
const draftId = "50000000-0000-4000-8000-000000000001"
const decisionId = "60000000-0000-4000-8000-000000000001"
const attemptId = "70000000-0000-4000-8000-000000000001"
const tokenId = "80000000-0000-4000-8000-000000000001"
const controlId = "90000000-0000-4000-8000-000000000001"
const rawToken = "action-secret-".padEnd(64, "x")
const directories: string[] = []

let store: SecureStore
let stdout: CaptureStream
let stderr: CaptureStream

beforeEach(async () => {
  const directory = await mkdtemp(join(tmpdir(), "mandala-cli-command-"))
  directories.push(directory)
  store = new SecureStore(directory)
  await store.writeConfig({
    schemaVersion: 1,
    mode: "mock",
    selectedCompany: { id: companyId, name: "Example Company" },
  })
  stdout = new CaptureStream()
  stderr = new CaptureStream()
})

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("CLI commands", () => {
  it("returns a structured command result without writing a presentation", async () => {
    const api = fakeApi()

    const result = await executeCliCommand(["work", "show", itemId], {
      api,
      environment: {},
      store,
      stdout,
      stderr,
    })

    expect(result).toMatchObject({
      ok: true,
      data: { item: { id: itemId }, draft: { id: draftId } },
    })
    expect(stdout.value).toBe("")
    expect(api.recordControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        resolutionStatus: "executed",
        workflowItemId: itemId,
      })
    )
  })

  it("clears selected-company context when logging out", async () => {
    await store.writeSession({
      schemaVersion: 1,
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: 2_000_000_000,
      user: {
        id: "10000000-0000-4000-8000-000000000001",
        email: "user@example.com",
      },
    })

    expect(await command(["auth", "logout", "--json"], fakeApi())).toBe(0)
    await expect(store.readSession()).resolves.toBeNull()
    await expect(store.readConfig()).resolves.toMatchObject({
      selectedCompany: null,
    })
  })

  it("supports context and work show without exposing local credentials", async () => {
    await store.writeSession({
      schemaVersion: 1,
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: 2_000_000_000,
      user: {
        id: "10000000-0000-4000-8000-000000000001",
        email: "user@example.com",
      },
    })
    const api = fakeApi()

    expect(await command(["context", "--json"], api)).toBe(0)
    expect(stdout.value).toContain('"authenticated":true')
    expect(stdout.value).not.toContain("access-secret")
    expect(stdout.value).not.toContain("refresh-secret")

    stdout.value = ""
    expect(await command(["work", "show", itemId, "--json"], api)).toBe(0)
    expect(api.getWorkItem).toHaveBeenCalledWith(companyId, itemId)
    expect(api.recordControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        resolutionStatus: "executed",
        workflowRunId: runId,
        workflowItemId: itemId,
      })
    )
    expect(stdout.value).toContain('"payload":{"lines":[{"quantity":12}]}')
    expect(stdout.value).toContain('"editPolicy":{}')
  })

  it("renders complete one-shot work details as human tables", async () => {
    const api = fakeApi()

    expect(await command(["work", "show", itemId], api)).toBe(0)

    expect(stdout.value).toContain("Draft")
    expect(stdout.value).toContain("payload.lines")
    expect(stdout.value).toContain("quantity")
    expect(stdout.value).toContain("12")
    expect(stdout.value).not.toContain('"ok":true')
  })

  it("applies a generic JSON Pointer edit through the decide alias", async () => {
    const api = fakeApi()

    const confirm = vi.fn().mockResolvedValue(true)
    const exitCode = await command(
      [
        "work",
        "decide",
        itemId,
        "--edit",
        "--set",
        "/lines/0/quantity=24",
        "--reason",
        "Reviewed",
        "--json",
      ],
      api,
      confirm
    )

    expect(exitCode).toBe(0)
    expect(api.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        actionDraftId: draftId,
        decision: "edit",
        reason: "Reviewed",
        editedPayload: { lines: [{ quantity: 24 }] },
        control: { inputHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      })
    )
    expect(api.recordControlRequest).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          payload: { lines: [{ quantity: 24 }] },
        }),
      })
    )
    expect(stdout.value).not.toContain("Reviewed")
    expect(stdout.value).not.toContain("quantity")
  })

  it("records clarification before returning when a reason is missing", async () => {
    const api = fakeApi()

    const exitCode = await command(["work", "reject", itemId, "--json"], api)

    expect(exitCode).toBe(1)
    expect(api.getWorkItem).not.toHaveBeenCalled()
    expect(api.recordDecision).not.toHaveBeenCalled()
    expect(api.recordControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedIntent: {
          kind: "unresolved",
          outcome: "clarification_required",
        },
        resolutionStatus: "clarification_required",
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    )
    expect(
      JSON.stringify(vi.mocked(api.recordControlRequest).mock.calls)
    ).not.toContain("work reject")
  })

  it("does not mutate when interactive confirmation is declined", async () => {
    const api = fakeApi()

    const exitCode = await command(
      ["work", "approve", itemId, "--json"],
      api,
      vi.fn().mockResolvedValue(false)
    )

    expect(exitCode).toBe(1)
    expect(api.recordDecision).not.toHaveBeenCalled()
    expect(api.recordControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        resolutionStatus: "blocked",
        workflowItemId: itemId,
      })
    )
  })

  it("blocks and audits non-interactive bypass flags", async () => {
    const api = fakeApi()

    const exitCode = await command(
      ["work", "approve", itemId, "--yes", "--json"],
      api
    )

    expect(exitCode).toBe(1)
    expect(api.getWorkItem).not.toHaveBeenCalled()
    expect(api.recordDecision).not.toHaveBeenCalled()
    expect(api.recordControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedIntent: { kind: "unresolved", outcome: "blocked" },
        resolutionStatus: "blocked",
      })
    )
  })

  it("fetches a fresh action token and immediately executes through the atomic mutation", async () => {
    const order: string[] = []
    const api = fakeApi({
      getWorkItem: vi.fn(async () => {
        order.push("detail")
        return detail()
      }),
      issueExecutionToken: vi.fn(async () => {
        order.push("token")
        return {
          decisionId,
          executionToken: {
            id: tokenId,
            rawToken,
            expiresAt: "2026-07-09T12:15:00.000Z",
          },
        }
      }),
      execute: vi.fn(async (request) => {
        order.push("execute")
        expect(request.rawToken).toBe(rawToken)
        expect(request.control).toEqual({
          inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        })
        return executionResult()
      }),
    })

    const exitCode = await command(
      ["work", "execute", itemId, "--json"],
      api,
      vi.fn().mockResolvedValue(true)
    )

    expect(exitCode).toBe(0)
    expect(order).toEqual(["detail", "token", "execute"])
    expect(api.recordControlRequest).not.toHaveBeenCalled()
    expect(api.execute).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { lines: [{ quantity: 12 }] } })
    )
    expect(stdout.value).not.toContain(rawToken)
  })

  it("can approve and execute with two confirmations without reissuing the returned capability", async () => {
    const api = fakeApi({
      recordDecision: vi.fn(async () => ({
        decision: {
          id: decisionId,
          decision: "approve" as const,
          reason: "must not render",
        },
        draft: {
          id: draftId,
          status: "approved" as const,
          payload: { lines: [{ quantity: 12 }] },
        },
        item: {
          id: itemId,
          status: "approved" as const,
          workflow_run_id: runId,
        },
        executionToken: {
          id: tokenId,
          rawToken,
          expiresAt: "2026-07-09T12:15:00.000Z",
        },
      })),
    })
    const confirm = vi.fn().mockResolvedValue(true)

    expect(
      await command(
        ["work", "approve", itemId, "--execute", "--json"],
        api,
        confirm
      )
    ).toBe(0)

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        draft: expect.objectContaining({
          status: "approved",
          payload: { lines: [{ quantity: 12 }] },
        }),
      })
    )
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        draft: expect.objectContaining({
          status: "approved",
          payload: { lines: [{ quantity: 12 }] },
        }),
      })
    )
    expect(api.issueExecutionToken).not.toHaveBeenCalled()
    expect(api.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        rawToken,
        payload: { lines: [{ quantity: 12 }] },
        control: { inputHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      })
    )
    expect(api.recordControlRequest).not.toHaveBeenCalled()
    expect(stdout.value).not.toContain(rawToken)
    expect(stdout.value).not.toContain("must not render")
    expect(stdout.value).not.toContain("quantity")
    expect(JSON.parse(stdout.value)).toEqual({
      ok: true,
      data: {
        decision: {
          decision: {
            id: decisionId,
            kind: "approve",
            warningsAcknowledged: false,
          },
          draft: { id: draftId, status: "approved", actionType: null },
          item: { id: itemId, status: "approved" },
          executionCapabilityIssued: true,
        },
        execution: {
          attempt: {
            id: attemptId,
            status: "succeeded",
            mode: "mock",
            actionType: null,
            mockExternalId: null,
          },
          draft: { id: draftId, status: "executed" },
          item: { id: itemId, status: "executed" },
          duplicate: false,
        },
      },
    })
  })

  it("keeps the recorded approval but does not execute when the second confirmation is declined", async () => {
    const api = fakeApi({
      recordDecision: vi.fn(async () => ({
        decision: { id: decisionId, decision: "approve" as const },
        draft: {
          id: draftId,
          status: "approved" as const,
          payload: { lines: [{ quantity: 12 }] },
        },
        item: {
          id: itemId,
          status: "approved" as const,
          workflow_run_id: runId,
        },
        executionToken: {
          id: tokenId,
          rawToken,
          expiresAt: "2026-07-09T12:15:00.000Z",
        },
      })),
    })
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    expect(
      await command(
        ["work", "approve", itemId, "--execute", "--json"],
        api,
        confirm
      )
    ).toBe(0)

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(api.recordDecision).toHaveBeenCalledTimes(1)
    expect(api.execute).not.toHaveBeenCalled()
    expect(JSON.parse(stdout.value)).toEqual({
      ok: true,
      data: {
        decision: {
          decision: {
            id: decisionId,
            kind: "approve",
            warningsAcknowledged: false,
          },
          draft: { id: draftId, status: "approved", actionType: null },
          item: { id: itemId, status: "approved" },
          executionCapabilityIssued: true,
        },
        execution: { status: "cancelled" },
      },
    })
    expect(stdout.value).not.toContain(rawToken)
  })

  it("lists registered fixture scenarios without calling the workflow API", async () => {
    const api = fakeApi()

    expect(await command(["workflow", "fixture", "list", "--json"], api)).toBe(
      0
    )

    expect(stdout.value).toContain("clean_reorder")
    expect(api.runFixture).not.toHaveBeenCalled()
  })

  it("returns a minimal duplicate fixture summary and relies on the atomic audit", async () => {
    const duplicateRunId = "30000000-0000-4000-8000-000000000099"
    const api = fakeApi({
      runFixture: vi.fn(async () => ({
        duplicate: true,
        workflowRun: { id: duplicateRunId },
        itemId,
        eventId: "31000000-0000-4000-8000-000000000099",
      })),
    })

    const exitCode = await command(
      ["workflow", "fixture", "run", "clean_reorder", "--json"],
      api,
      vi.fn().mockResolvedValue(true)
    )

    expect(exitCode).toBe(0)
    expect(api.runFixture).toHaveBeenCalledWith(
      expect.objectContaining({
        control: { inputHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      })
    )
    expect(api.recordControlRequest).not.toHaveBeenCalled()
    expect(stdout.value).toContain(duplicateRunId)
    expect(stdout.value).not.toContain(itemId)
  })

  it("keeps deterministic parse local and hashes the phrase instead of argv", async () => {
    const api = fakeApi()

    expect(await command(["parse", "list", "work", "--json"], api)).toBe(0)

    expect(api.parseControlIntent).not.toHaveBeenCalled()
    expect(api.recordControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        parserKind: "deterministic",
        resolutionStatus: "resolved",
        inputHash:
          "c2355fa9377a327a82f2a5dcdb2e479ebcf277861a86fe537b5415780671b9fa",
      })
    )
  })

  it("uses the server parser only for an unsupported deterministic phrase", async () => {
    const api = fakeApi({
      parseControlIntent: vi.fn(async () => conversationalListResult()),
    })

    expect(
      await command(["chat", "What", "needs", "attention?", "--json"], api)
    ).toBe(0)

    expect(api.parseControlIntent).toHaveBeenCalledWith({
      companyId,
      input: "What needs attention?",
    })
    expect(api.listWorkItems).toHaveBeenCalledWith(companyId, undefined)
    expect(api.recordControlRequest).not.toHaveBeenCalled()
    expect(api.transitionControlRequest).toHaveBeenCalledWith({
      companyId,
      controlRequestId: controlId,
      resolutionStatus: "executed",
    })
    expect(stdout.value).toContain(controlId)
    expect(stdout.value).toContain("openai/gpt-5.4-mini")
  })

  it("fails closed without mutating or duplicating the server audit when parsing is unavailable", async () => {
    const api = fakeApi({
      parseControlIntent: vi.fn(async () => {
        throw new CliError(
          "parser_unavailable",
          "The conversational parser is unavailable."
        )
      }),
    })

    expect(
      await command(["chat", "What", "needs", "attention?", "--json"], api)
    ).toBe(1)

    expect(api.listWorkItems).not.toHaveBeenCalled()
    expect(api.recordDecision).not.toHaveBeenCalled()
    expect(api.recordControlRequest).not.toHaveBeenCalled()
    expect(stderr.value).toContain('"parser_unavailable"')
  })

  it("audits a failed server fallback as langchain when the request never reaches an audit", async () => {
    const api = fakeApi({
      parseControlIntent: vi.fn(async () => {
        throw new CliError("network_error", "The API could not be reached.")
      }),
    })

    expect(
      await command(["chat", "What", "needs", "attention?", "--json"], api)
    ).toBe(1)

    expect(api.recordControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        parserKind: "langchain",
        resolutionStatus: "failed",
      })
    )
    expect(api.listWorkItems).not.toHaveBeenCalled()
  })

  it("reads one bounded chat line from stdin and executes the resolved read", async () => {
    const api = fakeApi()

    const exitCode = await runCli(["chat", "--json"], {
      api,
      confirm: vi.fn().mockResolvedValue(true),
      environment: {},
      store,
      stdin: Readable.from(["list work\nlist work again\n"]),
      stdout,
      stderr,
    })

    expect(exitCode).toBe(0)
    expect(api.parseControlIntent).not.toHaveBeenCalled()
    expect(api.listWorkItems).toHaveBeenCalledTimes(1)
    expect(api.recordControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        resolutionStatus: "executed",
        normalizedIntent: {
          kind: "list_work_items",
          companyId,
          risk: "read",
        },
      })
    )
  })

  it("confirms conversational mutations without rendering raw tokens", async () => {
    const api = fakeApi({
      recordDecision: vi.fn(async () => ({
        decision: { id: decisionId, decision: "approve" as const },
        draft: { id: draftId, status: "approved" as const },
        item: {
          id: itemId,
          status: "approved" as const,
          workflow_run_id: runId,
        },
        executionToken: {
          id: tokenId,
          rawToken,
          expiresAt: "2026-07-09T12:15:00.000Z",
        },
      })),
    })

    expect(await command(["chat", "approve", itemId, "--json"], api)).toBe(0)

    expect(api.recordDecision).toHaveBeenCalledTimes(1)
    expect(stdout.value).not.toContain(rawToken)
    expect(stdout.value).not.toContain("quantity")
  })

  it("does not mutate when conversational confirmation is declined", async () => {
    const api = fakeApi()

    expect(
      await command(
        ["chat", "approve", itemId, "--json"],
        api,
        vi.fn().mockResolvedValue(false)
      )
    ).toBe(1)

    expect(api.recordDecision).not.toHaveBeenCalled()
    expect(api.recordControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        resolutionStatus: "blocked",
        workflowItemId: itemId,
      })
    )
  })

  it("reuses the server control request for mutation metadata and cancellation", async () => {
    const parsedDecision = conversationalDecisionResult()
    const mutationApi = fakeApi({
      parseControlIntent: vi.fn(async () => parsedDecision),
    })

    expect(
      await command(
        ["chat", "Please", "approve", "the", "current", "item", "--json"],
        mutationApi
      )
    ).toBe(0)
    expect(mutationApi.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        control: {
          inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          controlRequestId: controlId,
        },
      })
    )
    expect(mutationApi.recordControlRequest).not.toHaveBeenCalled()
    expect(mutationApi.transitionControlRequest).not.toHaveBeenCalled()

    const cancelledApi = fakeApi({
      parseControlIntent: vi.fn(async () => parsedDecision),
    })
    expect(
      await command(
        ["chat", "Please", "approve", "the", "current", "item", "--json"],
        cancelledApi,
        vi.fn().mockResolvedValue(false)
      )
    ).toBe(1)
    expect(cancelledApi.recordDecision).not.toHaveBeenCalled()
    expect(cancelledApi.transitionControlRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        controlRequestId: controlId,
        resolutionStatus: "blocked",
        workflowItemId: itemId,
        workflowRunId: runId,
      })
    )
  })

  it("marks a server-parsed action failed without creating another audit row", async () => {
    const api = fakeApi({
      parseControlIntent: vi.fn(async () => conversationalDecisionResult()),
      getWorkItem: vi.fn(async () => {
        throw new CliError("api_request_failed", "Request failed.")
      }),
    })

    expect(
      await command(
        ["chat", "Please", "approve", "the", "current", "item", "--json"],
        api
      )
    ).toBe(1)
    expect(api.recordControlRequest).not.toHaveBeenCalled()
    expect(api.transitionControlRequest).toHaveBeenCalledWith({
      companyId,
      controlRequestId: controlId,
      resolutionStatus: "failed",
    })
  })
})

async function command(
  argv: string[],
  api: ReturnType<typeof fakeApi>,
  confirm = vi.fn().mockResolvedValue(true)
) {
  return runCli(argv, {
    api,
    confirm,
    environment: {},
    store,
    stdout,
    stderr,
  })
}

function fakeApi(overrides: Partial<ControlApi> = {}) {
  return {
    listCompanies: vi.fn(async () => ({ companies: [] })),
    listWorkItems: vi.fn(async () => ({ items: [] })),
    getWorkItem: vi.fn(async () => detail()),
    runFixture: vi.fn(async () => ({
      duplicate: false,
      workflowRun: { id: runId },
      item: { id: itemId },
    })),
    recordDecision: vi.fn(async () => ({
      decision: { id: decisionId, decision: "edit" as const },
      draft: { id: draftId, status: "approved" as const },
      item: { id: itemId, status: "approved" as const, workflow_run_id: runId },
      executionToken: null,
    })),
    issueExecutionToken: vi.fn(async () => ({
      decisionId,
      executionToken: {
        id: tokenId,
        rawToken,
        expiresAt: "2026-07-09T12:15:00.000Z",
      },
    })),
    execute: vi.fn(async () => executionResult()),
    parseControlIntent: vi.fn(async () => ({
      outcome: {
        status: "blocked" as const,
        reasonCode: "unsupported_command",
        reasons: ["The request is outside the supported command boundary."],
        confirmationRequired: false as const,
      },
      parserKind: "langchain" as const,
      model: null,
      durationMs: 0,
      trace: null,
      controlRequestId: controlId,
    })),
    recordControlRequest: vi.fn(async () => ({ request: { id: controlId } })),
    transitionControlRequest: vi.fn(async () => ({
      request: { id: controlId },
    })),
    ...overrides,
  }
}

function conversationalListResult() {
  return {
    outcome: {
      status: "resolved" as const,
      intent: {
        kind: "list_work_items" as const,
        companyId,
        risk: "read" as const,
      },
      confirmationRequired: false,
    },
    parserKind: "langchain" as const,
    model: "openai/gpt-5.4-mini",
    durationMs: 12,
    trace: { traceId: controlId, runId: controlId },
    controlRequestId: controlId,
  }
}

function conversationalDecisionResult() {
  return {
    outcome: {
      status: "resolved" as const,
      intent: {
        kind: "record_decision" as const,
        companyId,
        itemId,
        decision: "approve" as const,
        warningsAcknowledged: false,
        risk: "state_change" as const,
      },
      confirmationRequired: true,
    },
    parserKind: "langchain" as const,
    model: "openai/gpt-5.4-mini",
    durationMs: 12,
    trace: { traceId: controlId, runId: controlId },
    controlRequestId: controlId,
  }
}

function detail() {
  return {
    item: {
      id: itemId,
      workflowRunId: runId,
      itemType: "mock_action_review",
      title: "Review mock action",
      status: "approved" as const,
      priority: 50,
      resolutionState: {},
      createdAt: "2026-07-09T12:00:00.000Z",
      updatedAt: "2026-07-09T12:00:00.000Z",
    },
    contextPacket: null,
    recommendation: null,
    evidence: null,
    draft: {
      id: draftId,
      workflowRunId: runId,
      workflowItemId: itemId,
      actionType: "mock_action",
      status: "approved" as const,
      payload: { lines: [{ quantity: 12 }] },
      editPolicy: {},
      updatedAt: "2026-07-09T12:00:00.000Z",
    },
    decision: {
      id: decisionId,
      actionDraftId: draftId,
      decision: "approve" as const,
      reason: null,
      warningsAcknowledged: false,
      createdAt: "2026-07-09T12:00:00.000Z",
    },
    attempt: null,
    auditEvents: [],
  }
}

function executionResult() {
  return {
    attempt: { id: attemptId, status: "succeeded" as const },
    draft: { id: draftId, status: "executed" as const },
    item: { id: itemId, status: "executed" as const, workflow_run_id: runId },
    duplicate: false,
  }
}

class CaptureStream extends Writable {
  value = ""

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.value += chunk.toString()
    callback()
  }
}
