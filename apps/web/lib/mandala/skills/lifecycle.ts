import { z } from "zod"
import { agentSummarySchema, type AgentSummary } from "@workspace/control-plane"
import type { Json } from "@/lib/supabase/types"
import type { WorkflowSupabaseClient } from "../workflows"
import {
  resolveCompanyCompilerCapabilities,
  resolveCompiledManifestGrantBindings,
} from "./capabilities"
import type { CompiledAgentManifest } from "./compiler"

const installResultSchema = z
  .object({ workflowId: z.string().uuid() })
  .passthrough()
const snapshotResultSchema = z
  .object({ bindingSnapshotId: z.string().uuid() })
  .passthrough()

export async function installAgentWorkflowVersion(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  source: string
  manifest: CompiledAgentManifest
  diagnostics: unknown[]
}): Promise<AgentSummary> {
  const { data, error } = await input.supabase.rpc(
    "install_agent_workflow_version",
    {
      p_company_id: input.companyId,
      p_skill_markdown: input.source,
      p_manifest: asJson({
        workflowKey: input.manifest.identity.id,
        workflowType: input.manifest.workflow.type,
        name: input.manifest.identity.name,
        version: input.manifest.identity.version,
        spec: input.manifest,
        compilerVersion: input.manifest.compilerVersion,
      }),
      p_compile_result: asJson({
        ok: true,
        diagnostics: { items: input.diagnostics },
      }),
    }
  )
  if (error) throw new Error(error.message)
  const installed = installResultSchema.parse(data)
  return getAgentSummary({
    supabase: input.supabase,
    companyId: input.companyId,
    agentId: installed.workflowId,
  })
}

export async function listAgentSummaries(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
}): Promise<AgentSummary[]> {
  const [
    { data: workflows, error },
    { data: activations, error: activationError },
  ] = await Promise.all([
    input.supabase
      .from("agent_workflows")
      .select("*")
      .eq("company_id", input.companyId)
      .not("skill_source_hash", "is", null)
      .order("created_at", { ascending: false }),
    input.supabase
      .from("workflow_activations")
      .select("workflow_id, workflow_key")
      .eq("company_id", input.companyId),
  ])
  if (error) throw new Error(error.message)
  if (activationError) throw new Error(activationError.message)
  const activeIds = new Set((activations ?? []).map((row) => row.workflow_id))
  return (workflows ?? []).map((row) => mapAgentRow(row, activeIds.has(row.id)))
}

export async function getAgentSummary(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
}): Promise<AgentSummary> {
  const [
    { data: workflow, error },
    { data: activation, error: activationError },
  ] = await Promise.all([
    input.supabase
      .from("agent_workflows")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("id", input.agentId)
      .not("skill_source_hash", "is", null)
      .single(),
    input.supabase
      .from("workflow_activations")
      .select("workflow_id")
      .eq("company_id", input.companyId)
      .eq("workflow_id", input.agentId)
      .maybeSingle(),
  ])
  if (error) throw new Error(error.message)
  if (activationError) throw new Error(activationError.message)
  return mapAgentRow(workflow, Boolean(activation))
}

export async function activateAgentWorkflow(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
}): Promise<AgentSummary> {
  const workflow = await loadWorkflowManifest(input)
  const bindingSnapshotId = await createAgentWorkflowBindingSnapshot({
    ...input,
    manifest: workflow.manifest,
  })
  const { data: current, error: currentError } = await input.supabase
    .from("workflow_activations")
    .select("workflow_id")
    .eq("company_id", input.companyId)
    .eq("workflow_key", workflow.row.workflow_key)
    .maybeSingle()
  if (currentError) throw new Error(currentError.message)

  const { error } = await input.supabase.rpc("activate_agent_workflow", {
    p_company_id: input.companyId,
    p_workflow_id: input.agentId,
    p_binding_snapshot_id: bindingSnapshotId,
    ...(current?.workflow_id
      ? { p_expected_current_workflow_id: current.workflow_id }
      : {}),
  })
  if (error) throw new Error(error.message)
  return getAgentSummary(input)
}

export async function createAgentWorkflowBindingSnapshot(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
  manifest?: CompiledAgentManifest
}): Promise<string> {
  const manifest =
    input.manifest ?? (await loadWorkflowManifest(input)).manifest
  const capabilities = await resolveCompanyCompilerCapabilities({
    supabase: input.supabase,
    companyId: input.companyId,
  })
  const grants = resolveCompiledManifestGrantBindings({
    manifest,
    capabilities,
  })
  const { data, error } = await input.supabase.rpc(
    "create_workflow_binding_snapshot",
    {
      p_company_id: input.companyId,
      p_workflow_id: input.agentId,
      p_bindings: asJson(grants),
    }
  )
  if (error) throw new Error(error.message)
  return snapshotResultSchema.parse(data).bindingSnapshotId
}

export async function deactivateAgentWorkflow(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
}): Promise<AgentSummary> {
  const workflow = await loadWorkflowManifest(input)
  const { data: current, error: currentError } = await input.supabase
    .from("workflow_activations")
    .select("workflow_id")
    .eq("company_id", input.companyId)
    .eq("workflow_key", workflow.row.workflow_key)
    .maybeSingle()
  if (currentError) throw new Error(currentError.message)
  if (!current) throw new Error("Agent is not active.")
  const { error } = await input.supabase.rpc("deactivate_agent_workflow", {
    p_company_id: input.companyId,
    p_workflow_key: workflow.row.workflow_key,
    p_expected_current_workflow_id: current.workflow_id,
  })
  if (error) throw new Error(error.message)
  return getAgentSummary(input)
}

export async function rollbackAgentWorkflow(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
  version: string
}): Promise<AgentSummary> {
  const current = await loadWorkflowManifest(input)
  const { data: target, error: targetError } = await input.supabase
    .from("agent_workflows")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("workflow_key", current.row.workflow_key)
    .eq("version", input.version)
    .not("skill_source_hash", "is", null)
    .single()
  if (targetError) throw new Error(targetError.message)
  const bindingSnapshotId = await createAgentWorkflowBindingSnapshot({
    supabase: input.supabase,
    companyId: input.companyId,
    agentId: target.id,
  })
  const { error } = await input.supabase.rpc("rollback_agent_workflow", {
    p_company_id: input.companyId,
    p_workflow_id: target.id,
    p_binding_snapshot_id: bindingSnapshotId,
    p_expected_current_workflow_id: input.agentId,
  })
  if (error) throw new Error(error.message)
  return getAgentSummary({ ...input, agentId: target.id })
}

async function loadWorkflowManifest(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
}) {
  const { data: row, error } = await input.supabase
    .from("agent_workflows")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("id", input.agentId)
    .not("skill_source_hash", "is", null)
    .single()
  if (error) throw new Error(error.message)
  return { row, manifest: row.spec as unknown as CompiledAgentManifest }
}

function mapAgentRow(
  row: DatabaseAgentWorkflowRow,
  active: boolean
): AgentSummary {
  const manifest = row.spec as unknown as CompiledAgentManifest
  const diagnosticObject = asRecord(row.compiler_diagnostics)
  const diagnosticItems = Array.isArray(diagnosticObject.items)
    ? diagnosticObject.items
    : []
  return agentSummarySchema.parse({
    id: row.id,
    companyId: row.company_id,
    workflowKey: row.workflow_key,
    workflowType: row.workflow_type,
    name: row.name,
    version: row.version,
    status: active ? "active" : "draft",
    skillSchemaVersion: manifest.schemaVersion ?? "mandala.ai/v1",
    compilerVersion: row.compiler_version ?? manifest.compilerVersion,
    skillDigest: row.skill_source_hash,
    manifestDigest: manifest.manifestDigest ?? row.compiled_manifest_hash,
    active,
    capabilities: (manifest.capabilityBindings ?? []).map((binding) => ({
      id: binding.id,
      alias: binding.alias,
      access: binding.access,
      version: binding.version,
      connectorId: binding.connectorId,
      status: binding.granted && binding.healthy ? "resolved" : "unauthorized",
    })),
    diagnostics: diagnosticItems,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

type DatabaseAgentWorkflowRow =
  Awaited<ReturnType<WorkflowSupabaseClient["from"]>> extends never
    ? never
    : {
        id: string
        company_id: string
        workflow_key: string
        workflow_type: string
        name: string
        version: string
        status: string
        spec: Json
        compiler_diagnostics: Json | null
        compiler_version: string | null
        skill_source_hash: string | null
        compiled_manifest_hash: string | null
        created_at: string
        updated_at: string
      }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}
