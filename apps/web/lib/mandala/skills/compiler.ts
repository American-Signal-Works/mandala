import { createHash } from "node:crypto"
import { parseAgentSkillMarkdown, type SkillDiagnostic } from "./parser"
import {
  skillCompilerVersion,
  skillSchemaVersion,
  type AgentSkill,
  type SkillRule,
} from "./schema"

export type CompilerCapability = {
  id: string
  version: string
  access: "read" | "propose" | "execute"
  connectorId: string
  schemaDigest: string
  toolName: string
  healthy: boolean
  granted: boolean
  schemaCompatible?: boolean
  modelAllowedPaths?: string[]
}

export type CompiledCapabilityBinding = CompilerCapability & {
  alias: string
  useInPrompt: boolean
}

export type CompiledAgentManifest = {
  schemaVersion: typeof skillSchemaVersion
  compilerVersion: typeof skillCompilerVersion
  sourceDigest: string
  manifestDigest: string
  identity: AgentSkill["metadata"]
  workflow: AgentSkill["workflow"]
  capabilityBindings: CompiledCapabilityBinding[]
  graph: Array<{
    id: string
    handler:
      | "resolve_bindings"
      | "load_data"
      | "validate"
      | "agent_judgment"
      | "apply_rules"
      | "project_records"
      | "persist_review"
      | "human_approval"
      | "execute_action"
      | "audit"
    allowedTools: string[]
    idempotencyRequired: boolean
  }>
  rules: SkillRule[]
  records: AgentSkill["records"]
  evidence: AgentSkill["evidence"]
  approvals: AgentSkill["approvals"]
  actions: AgentSkill["actions"]
  tests: AgentSkill["tests"]
  guidance: {
    purpose: string
    investigation: string
    decision: string
    exceptions: string
    outputQuality: string
  }
}

export type CompileAgentSkillResult =
  | {
      ok: true
      manifest: CompiledAgentManifest
      diagnostics: SkillDiagnostic[]
    }
  | { ok: false; diagnostics: SkillDiagnostic[] }

export function compileAgentSkill(input: {
  source: string
  capabilities: readonly CompilerCapability[]
}): CompileAgentSkillResult {
  const parsed = parseAgentSkillMarkdown(input.source)
  if (!parsed.ok) return parsed

  const diagnostics = [...parsed.diagnostics]
  const bindings: CompiledCapabilityBinding[] = []
  for (const requirement of parsed.value.skill.capabilities) {
    const candidates = input.capabilities.filter(
      (candidate) =>
        candidate.id === requirement.id &&
        candidate.version === requirement.version &&
        candidate.access === requirement.access
    )
    if (candidates.length === 0) {
      if (requirement.required) {
        diagnostics.push({
          severity: "error",
          code: "capability.missing",
          path: `capabilities.${requirement.as}`,
          message: `No installed connector provides ${requirement.id} v${requirement.version} with ${requirement.access} access.`,
          resolution:
            "Install or grant a compatible connector capability, then validate again.",
        })
      }
      continue
    }
    const granted = candidates.filter((candidate) => candidate.granted)
    if (granted.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "capability.not_granted",
        path: `capabilities.${requirement.as}`,
        message: `${requirement.id} is installed but not granted to this company.`,
        resolution: "An owner or admin must grant the capability.",
      })
      continue
    }
    const healthy = granted.filter((candidate) => candidate.healthy)
    if (healthy.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "capability.unhealthy",
        path: `capabilities.${requirement.as}`,
        message: `${requirement.id} is not healthy.`,
        resolution: "Repair or reconnect the connector before activation.",
      })
      continue
    }
    const compatible = healthy.filter(
      (candidate) => candidate.schemaCompatible !== false
    )
    if (compatible.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "capability.schema_drift",
        path: `capabilities.${requirement.as}`,
        message: `${requirement.id} no longer matches the installed connector schema.`,
        resolution: "Refresh or upgrade the connector before validating again.",
      })
      continue
    }
    const promptAllowed = requirement.use_in_prompt
      ? compatible.filter(
          (candidate) => (candidate.modelAllowedPaths?.length ?? 0) > 0
        )
      : compatible
    if (promptAllowed.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "capability.model_egress_blocked",
        path: `capabilities.${requirement.as}`,
        message: `${requirement.id} has no fields approved for model processing.`,
        resolution:
          "Use the capability deterministically or ask an admin to review the platform-owned data classification.",
      })
      continue
    }
    if (promptAllowed.length > 1) {
      diagnostics.push({
        severity: "error",
        code: "capability.ambiguous",
        path: `capabilities.${requirement.as}`,
        message: `More than one connector can satisfy ${requirement.id}.`,
        resolution: "Choose one connector binding for this capability.",
      })
      continue
    }
    const candidate = promptAllowed[0]!
    bindings.push({
      ...candidate,
      alias: requirement.as,
      useInPrompt: requirement.use_in_prompt,
    })
  }

  for (const action of parsed.value.skill.actions) {
    const binding = bindings.find(
      (candidate) => candidate.id === action.capability
    )
    if (!binding || binding.access === "read") {
      diagnostics.push({
        severity: "error",
        code: "action.binding_missing",
        path: `actions.${action.id}`,
        message: `Action ${action.id} does not have a granted write-capable binding.`,
        resolution:
          "Bind the declared action capability with draft or execute access.",
      })
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics }
  }

  const sourceDigest = digest(input.source.replace(/\r\n/g, "\n").trim())
  const skill = parsed.value.skill
  const readTools = bindings
    .filter((binding) => binding.access === "read" && binding.useInPrompt)
    .map((binding) => binding.toolName)
    .sort()
  const graph: CompiledAgentManifest["graph"] = [
    node("resolve_bindings", "resolve_bindings", [], true),
    node(
      "load_data",
      "load_data",
      bindings
        .filter((binding) => binding.access === "read")
        .map((binding) => binding.toolName)
        .sort(),
      true
    ),
    node("validate", "validate", [], true),
    node("agent_judgment", "agent_judgment", readTools, false),
    node("apply_rules", "apply_rules", [], true),
    node("project_records", "project_records", [], true),
    node("persist_review", "persist_review", [], true),
    ...(skill.approvals.length > 0
      ? [node("human_approval", "human_approval", [], true)]
      : []),
    ...(skill.actions.length > 0
      ? [node("execute_action", "execute_action", [], true)]
      : []),
    node("audit", "audit", [], true),
  ]

  const withoutManifestDigest = {
    schemaVersion: skillSchemaVersion,
    compilerVersion: skillCompilerVersion,
    sourceDigest,
    identity: skill.metadata,
    workflow: skill.workflow,
    capabilityBindings: bindings.sort((left, right) =>
      left.alias.localeCompare(right.alias)
    ),
    graph,
    rules: skill.rules,
    records: skill.records,
    evidence: skill.evidence,
    approvals: skill.approvals,
    actions: skill.actions,
    tests: skill.tests,
    guidance: {
      purpose: parsed.value.sections["Purpose"]!,
      investigation: parsed.value.sections["Investigation Guidance"]!,
      decision: parsed.value.sections["Decision Guidance"]!,
      exceptions: parsed.value.sections["Exceptions"]!,
      outputQuality: parsed.value.sections["Output Quality"]!,
    },
  }
  const manifest: CompiledAgentManifest = {
    ...withoutManifestDigest,
    manifestDigest: digest(stableStringify(withoutManifestDigest)),
  }
  return { ok: true, manifest, diagnostics }
}

function node(
  id: string,
  handler: CompiledAgentManifest["graph"][number]["handler"],
  allowedTools: string[],
  idempotencyRequired: boolean
): CompiledAgentManifest["graph"][number] {
  return { id, handler, allowedTools, idempotencyRequired }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
