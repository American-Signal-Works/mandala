import type { CompiledAgentManifest } from "../skills/compiler"
import type { AgentSkill, SkillValueSource } from "../skills/schema"
import { readRuntimePath, resolveValueSource } from "./primitives"
import type { RuntimeReviewProjection, RuntimeSourceRef } from "./state"

type ProjectionValue = AgentSkill["records"]["item"]["key"]

const templatePathPattern =
  /{{\s*((?:trigger|data|agent|rules|context)(?:\.[a-zA-Z0-9_-]+)+)\s*}}/g

export class RuntimeProjectionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "RuntimeProjectionError"
  }
}

export function projectRuntimeRecords(input: {
  manifest: CompiledAgentManifest
  context: Record<string, unknown>
  sourceRefs: RuntimeSourceRef[]
}): RuntimeReviewProjection {
  const { records } = input.manifest
  const itemKey = nonEmptyString(
    projectValue(records.item.key, input.context),
    "item.key"
  )
  const itemTitle = nonEmptyString(
    projectValue(records.item.title, input.context),
    "item.title"
  )
  const priority = boundedNumber(
    projectValue(records.item.priority, input.context),
    "item.priority",
    0,
    100,
    true
  )
  const rationale = nonEmptyString(
    projectValue(records.recommendation.rationale, input.context),
    "recommendation.rationale"
  )
  const confidence = boundedNumber(
    projectValue(records.recommendation.confidence, input.context),
    "recommendation.confidence",
    0,
    1,
    false
  )

  return {
    item: {
      type: records.item.type,
      key: itemKey,
      title: itemTitle,
      priority,
      related: projectRecord(records.item.related, input.context),
    },
    recommendation: {
      rationale,
      confidence,
      output: projectRecord(records.recommendation.output, input.context),
    },
    draft: records.draft
      ? {
          action: records.draft.action,
          payload: projectRecord(records.draft.payload, input.context),
          editPolicy: {
            editable: records.draft.edit_policy.editable,
            requireReason: records.draft.edit_policy.require_reason,
            immutablePaths: records.draft.edit_policy.immutable_paths,
            arrayLengthPaths: records.draft.edit_policy.array_length_paths,
            positiveIntegerPaths:
              records.draft.edit_policy.positive_integer_paths,
            nonEmptyStringPaths:
              records.draft.edit_policy.non_empty_string_paths,
          },
        }
      : null,
    evidence: {
      requirements: [...input.manifest.evidence.requirements],
      assumptions: [...input.manifest.evidence.assumptions],
      sourceCapabilities: [...input.manifest.evidence.source_capabilities],
      sourceRefs: structuredClone(input.sourceRefs),
    },
  }
}

export function projectValue(
  projection: ProjectionValue,
  context: Record<string, unknown>
): unknown {
  if ("template" in projection) {
    return renderTemplate(projection.template, context)
  }
  if ("object" in projection) {
    return projectRecord(projection.object, context)
  }
  if ("array" in projection) {
    return projection.array.map((value) => projectValue(value, context))
  }
  return resolveValueSource(
    projection as SkillValueSource,
    context,
    "projection"
  )
}

function projectRecord(
  definition: Record<string, ProjectionValue>,
  context: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(definition).map(([key, value]) => [
      key,
      projectValue(value, context),
    ])
  )
}

function renderTemplate(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replace(templatePathPattern, (_match, path: string) => {
    const value = readRuntimePath(context, path)
    if (value === undefined) {
      throw new RuntimeProjectionError(
        "template_path_not_found",
        `Template path ${path} was not found.`
      )
    }
    if (value === null) return ""
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return String(value)
    }
    throw new RuntimeProjectionError(
      "template_value_not_scalar",
      `Template path ${path} must resolve to a scalar value.`
    )
  })
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RuntimeProjectionError(
      "string_required",
      `${path} must resolve to a non-empty string.`
    )
  }
  return value.trim()
}

function boundedNumber(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  integer: boolean
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new RuntimeProjectionError(
      "bounded_number_required",
      `${path} must resolve to ${integer ? "an integer" : "a number"} between ${minimum} and ${maximum}.`
    )
  }
  return value
}
