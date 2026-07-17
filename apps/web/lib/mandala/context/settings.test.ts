import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ContextWorkspaceSettingsError,
  getContextWorkspaceStatus,
  projectContextWorkspaceStatus,
  setContextWorkspaceConfiguration,
} from "./settings"

const companyId = "20000000-0000-4000-8000-000000000001"
const timestamp = "2026-07-16T20:00:00.000Z"

type StoredRow = {
  company_id: string
  provider: "off" | "supermemory"
  sandbox_enabled: boolean
  readiness: "disabled" | "not_ready" | "ready" | "error"
  configuration_version: number
  updated_at: string
}

function row(overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    company_id: companyId,
    provider: "off",
    sandbox_enabled: true,
    readiness: "disabled",
    configuration_version: 1,
    updated_at: timestamp,
    ...overrides,
  }
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    companyId,
    provider: "supermemory",
    evidenceAvailable: false,
    eligibleCount: null,
    indexedCount: null,
    coveragePercent: null,
    lagSeconds: null,
    lastSynchronizedAt: null,
    recentErrorCount: null,
    workerEnabled: false,
    canaryRecordLimit: 0,
    ...overrides,
  }
}

function supabaseMock(results: unknown[]) {
  const maybeSingle = vi.fn()
  for (const result of results) maybeSingle.mockResolvedValueOnce(result)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn()
  return { client: { from, rpc }, from, rpc, maybeSingle }
}

describe("Context workspace settings service", () => {
  beforeEach(() => vi.clearAllMocks())

  it("projects Context Off without provider work or invented measurements", () => {
    expect(projectContextWorkspaceStatus(row())).toEqual({
      schemaVersion: 1,
      companyId,
      provider: "off",
      sandboxEnabled: true,
      readiness: "disabled",
      configurationVersion: 1,
      updatedAt: timestamp,
      providerStatus: {
        operational: false,
        status: "disabled",
        detailCode: "context_off",
      },
      indexingCoverage: {
        status: "unavailable",
        eligibleRecordCount: null,
        indexedRecordCount: null,
        percent: null,
      },
      synchronization: {
        status: "unavailable",
        lagSeconds: null,
        lastSynchronizedAt: null,
        recentErrorCount: null,
      },
    })
  })

  it("normalizes any stored Supermemory marker to non-operational not_ready", () => {
    expect(
      projectContextWorkspaceStatus(
        row({ provider: "supermemory", readiness: "ready" })
      )
    ).toMatchObject({
      provider: "supermemory",
      readiness: "not_ready",
      providerStatus: {
        operational: false,
        status: "not_ready",
        detailCode: "provider_not_operational",
      },
    })
  })

  it("labels incomplete indexing counts as evidence rather than coverage", () => {
    expect(
      projectContextWorkspaceStatus(
        row({ provider: "supermemory", readiness: "ready" }),
        evidence({
          evidenceAvailable: true,
          eligibleCount: 12,
          indexedCount: 7,
          recentErrorCount: 2,
        }) as never
      )
    ).toMatchObject({
      readiness: "not_ready",
      indexingCoverage: {
        status: "evidence_only",
        eligibleRecordCount: 12,
        indexedRecordCount: 7,
        percent: null,
      },
      synchronization: {
        status: "available",
        recentErrorCount: 2,
      },
    })
  })

  it("reads the tenant-scoped server setting", async () => {
    const mock = supabaseMock([{ data: row(), error: null }])
    await expect(
      getContextWorkspaceStatus({
        supabase: mock.client as never,
        companyId,
      })
    ).resolves.toMatchObject({ companyId, readiness: "disabled" })
    expect(mock.from).toHaveBeenCalledWith("context_workspace_settings")
  })

  it("derives readiness and preserves an omitted Sandbox setting on mutation", async () => {
    const mock = supabaseMock([
      { data: row(), error: null },
      {
        data: row({
          provider: "supermemory",
          readiness: "not_ready",
          configuration_version: 2,
        }),
        error: null,
      },
    ])
    mock.rpc
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: evidence(), error: null })

    await expect(
      setContextWorkspaceConfiguration({
        supabase: mock.client as never,
        request: {
          companyId,
          provider: "supermemory",
          expectedConfigurationVersion: 1,
          reason: "Prepare Context without enabling provider operations.",
        },
      })
    ).resolves.toMatchObject({
      provider: "supermemory",
      sandboxEnabled: true,
      readiness: "not_ready",
      configurationVersion: 2,
    })
    expect(mock.rpc).toHaveBeenCalledWith(
      "set_context_workspace_configuration_v1",
      {
        p_company_id: companyId,
        p_expected_configuration_version: 1,
        p_provider: "supermemory",
        p_sandbox_enabled: true,
        p_readiness: "not_ready",
        p_reason: "Prepare Context without enabling provider operations.",
      }
    )
  })

  it("preserves the configured provider on a Sandbox-only mutation", async () => {
    const current = row({ provider: "supermemory", readiness: "not_ready" })
    const mock = supabaseMock([
      { data: current, error: null },
      {
        data: row({
          provider: "supermemory",
          readiness: "not_ready",
          sandbox_enabled: false,
          configuration_version: 2,
        }),
        error: null,
      },
    ])
    mock.rpc
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: evidence(), error: null })

    await setContextWorkspaceConfiguration({
      supabase: mock.client as never,
      request: {
        companyId,
        sandboxEnabled: false,
        expectedConfigurationVersion: 1,
        reason: "Disable Sandbox after an explicit operational review.",
      },
    })
    expect(mock.rpc).toHaveBeenCalledWith(
      "set_context_workspace_configuration_v1",
      expect.objectContaining({
        p_provider: "supermemory",
        p_sandbox_enabled: false,
        p_readiness: "not_ready",
      })
    )
  })

  it("maps stale writes to a bounded service error", async () => {
    const mock = supabaseMock([{ data: row(), error: null }])
    mock.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "40001",
        message: "stale_context_workspace_configuration",
      },
    })

    const error = await setContextWorkspaceConfiguration({
      supabase: mock.client as never,
      request: {
        companyId,
        sandboxEnabled: false,
        expectedConfigurationVersion: 1,
        reason: "Disable Sandbox after an explicit operational review.",
      },
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(ContextWorkspaceSettingsError)
    expect(error).toMatchObject({
      code: "stale_context_workspace_configuration",
      databaseCode: "40001",
    })
  })
})
