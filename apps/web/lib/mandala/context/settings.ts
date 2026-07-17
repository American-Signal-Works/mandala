import { z } from "zod"
import {
  contextWorkspaceConfigurationRequestSchema,
  contextWorkspaceStatusSchema,
  type ContextWorkspaceConfigurationRequest,
  type ContextWorkspaceStatus,
} from "@workspace/control-plane"
import type { WorkflowSupabaseClient } from "../workflows"

const storedContextWorkspaceSettingsSchema = z
  .object({
    company_id: z.string().uuid(),
    provider: z.enum(["off", "supermemory"]),
    sandbox_enabled: z.boolean(),
    readiness: z.enum(["disabled", "not_ready", "ready", "error"]),
    configuration_version: z.number().int().positive(),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()

type StoredContextWorkspaceSettings = z.infer<
  typeof storedContextWorkspaceSettingsSchema
>

const contextIndexStatusEvidenceSchema = z
  .object({
    companyId: z.string().uuid(),
    provider: z.literal("supermemory"),
    evidenceAvailable: z.boolean(),
    eligibleCount: z.number().int().nonnegative().nullable(),
    indexedCount: z.number().int().nonnegative().nullable(),
    coveragePercent: z.number().min(0).max(100).nullable(),
    lagSeconds: z.number().int().nonnegative().nullable(),
    lastSynchronizedAt: z.string().datetime({ offset: true }).nullable(),
    recentErrorCount: z.number().int().nonnegative().nullable(),
    workerEnabled: z.boolean(),
    canaryRecordLimit: z.number().int().nonnegative(),
  })
  .strict()

type ContextIndexStatusEvidence = z.infer<
  typeof contextIndexStatusEvidenceSchema
>

export type ContextWorkspaceSettingsErrorCode =
  | "context_workspace_configuration_not_found"
  | "stale_context_workspace_configuration"
  | "context_workspace_configuration_unchanged"
  | "invalid_context_workspace_configuration"
  | "context_workspace_settings_failed"
  | "context_workspace_configuration_failed"

export class ContextWorkspaceSettingsError extends Error {
  constructor(
    readonly code: ContextWorkspaceSettingsErrorCode,
    readonly databaseCode?: string
  ) {
    super(code)
    this.name = "ContextWorkspaceSettingsError"
  }
}

export async function getContextWorkspaceStatus(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
}): Promise<ContextWorkspaceStatus> {
  const settings = await readStoredSettings(input)
  const evidence =
    settings.provider === "supermemory"
      ? await readContextIndexStatusEvidence(input)
      : undefined
  return projectContextWorkspaceStatus(settings, evidence)
}

export async function setContextWorkspaceConfiguration(input: {
  supabase: WorkflowSupabaseClient
  request: ContextWorkspaceConfigurationRequest
}): Promise<ContextWorkspaceStatus> {
  const request = contextWorkspaceConfigurationRequestSchema.parse(
    input.request
  )
  const current = await readStoredSettings({
    supabase: input.supabase,
    companyId: request.companyId,
  })
  const provider = request.provider ?? current.provider
  const sandboxEnabled = request.sandboxEnabled ?? current.sandbox_enabled
  // Slice 3 has no operational Supermemory adapter. Readiness is derived by
  // trusted server code and can never be supplied by the CLI.
  const readiness = provider === "off" ? "disabled" : "not_ready"

  const result = await input.supabase.rpc(
    "set_context_workspace_configuration_v1",
    {
      p_company_id: request.companyId,
      p_expected_configuration_version: request.expectedConfigurationVersion,
      p_provider: provider,
      p_sandbox_enabled: sandboxEnabled,
      p_readiness: readiness,
      p_reason: request.reason,
    }
  )
  if (result.error) throwConfigurationError(result.error)

  return getContextWorkspaceStatus({
    supabase: input.supabase,
    companyId: request.companyId,
  })
}

export function projectContextWorkspaceStatus(
  value: StoredContextWorkspaceSettings,
  evidence?: ContextIndexStatusEvidence
): ContextWorkspaceStatus {
  const stored = storedContextWorkspaceSettingsSchema.parse(value)
  const providerOff = stored.provider === "off"
  // Do not trust a persisted ready/error marker until an operational provider
  // adapter can verify it. This projection makes the public status truthful.
  const readiness = providerOff ? "disabled" : "not_ready"

  return contextWorkspaceStatusSchema.parse({
    schemaVersion: 1,
    companyId: stored.company_id,
    provider: stored.provider,
    sandboxEnabled: stored.sandbox_enabled,
    readiness,
    configurationVersion: stored.configuration_version,
    updatedAt: stored.updated_at,
    providerStatus: {
      operational: false,
      status: readiness,
      detailCode: providerOff ? "context_off" : "provider_not_operational",
    },
    indexingCoverage: projectIndexingCoverage(stored, evidence),
    synchronization: projectSynchronization(stored, evidence),
  })
}

function projectIndexingCoverage(
  settings: StoredContextWorkspaceSettings,
  evidence?: ContextIndexStatusEvidence
) {
  if (settings.provider !== "supermemory" || !evidence?.evidenceAvailable) {
    return {
      status: "unavailable" as const,
      eligibleRecordCount: null,
      indexedRecordCount: null,
      percent: null,
    }
  }
  if (
    evidence.coveragePercent !== null &&
    evidence.eligibleCount !== null &&
    evidence.indexedCount !== null
  ) {
    return {
      status: "available" as const,
      eligibleRecordCount: evidence.eligibleCount,
      indexedRecordCount: evidence.indexedCount,
      percent: evidence.coveragePercent,
    }
  }
  return {
    status: "evidence_only" as const,
    eligibleRecordCount: evidence.eligibleCount,
    indexedRecordCount: evidence.indexedCount,
    percent: null,
  }
}

function projectSynchronization(
  settings: StoredContextWorkspaceSettings,
  evidence?: ContextIndexStatusEvidence
) {
  if (
    settings.provider !== "supermemory" ||
    !evidence?.evidenceAvailable ||
    evidence.recentErrorCount === null
  ) {
    return {
      status: "unavailable" as const,
      lagSeconds: null,
      lastSynchronizedAt: null,
      recentErrorCount: null,
    }
  }
  return {
    status: "available" as const,
    lagSeconds: evidence.lagSeconds,
    lastSynchronizedAt: evidence.lastSynchronizedAt,
    recentErrorCount: evidence.recentErrorCount,
  }
}

async function readContextIndexStatusEvidence(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
}): Promise<ContextIndexStatusEvidence> {
  const result = await input.supabase.rpc("get_context_index_status_v1", {
    p_company_id: input.companyId,
  })
  if (result.error) {
    throw new ContextWorkspaceSettingsError(
      "context_workspace_settings_failed",
      result.error.code
    )
  }
  const evidence = contextIndexStatusEvidenceSchema.parse(result.data)
  if (evidence.companyId !== input.companyId) {
    throw new ContextWorkspaceSettingsError("context_workspace_settings_failed")
  }
  return evidence
}

async function readStoredSettings(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
}): Promise<StoredContextWorkspaceSettings> {
  const result = await input.supabase
    .from("context_workspace_settings")
    .select(
      "company_id, provider, sandbox_enabled, readiness, configuration_version, updated_at"
    )
    .eq("company_id", input.companyId)
    .maybeSingle()

  if (result.error) {
    throw new ContextWorkspaceSettingsError(
      "context_workspace_settings_failed",
      result.error.code
    )
  }
  if (!result.data) {
    throw new ContextWorkspaceSettingsError(
      "context_workspace_configuration_not_found"
    )
  }
  return storedContextWorkspaceSettingsSchema.parse(result.data)
}

function throwConfigurationError(error: {
  message: string
  code?: string
}): never {
  const knownCodes: ContextWorkspaceSettingsErrorCode[] = [
    "context_workspace_configuration_not_found",
    "stale_context_workspace_configuration",
    "context_workspace_configuration_unchanged",
    "invalid_context_workspace_configuration",
  ]
  const matched = knownCodes.find((code) => error.message.includes(code))
  throw new ContextWorkspaceSettingsError(
    matched ?? "context_workspace_configuration_failed",
    error.code
  )
}
