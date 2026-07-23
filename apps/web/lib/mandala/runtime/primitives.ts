import type {
  SkillExpression,
  SkillRule,
  SkillValueSource,
} from "../skills/schema"
import {
  identifierSchema,
  type ValidationIssue,
} from "@workspace/control-plane"
import type { RuntimeRuleResult, RuntimeRuleTrace } from "./state"

const allowedRoots = new Set(["trigger", "data", "agent", "rules", "context"])
const unsafeSegments = new Set(["__proto__", "constructor", "prototype"])
const maximumExpressionDepth = 16
const maximumExpressionOperations = 200

export class RuntimePrimitiveError extends Error {
  constructor(
    readonly code: string,
    readonly ruleId: string,
    message: string
  ) {
    super(message)
    this.name = "RuntimePrimitiveError"
  }
}

export function applyDeterministicRules(input: {
  rules: readonly SkillRule[]
  context: Record<string, unknown>
}): RuntimeRuleResult {
  const context = structuredClone(input.context)
  const traces: RuntimeRuleTrace[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const messages: string[] = []
  const issues: ValidationIssue[] = []
  let disposition: RuntimeRuleResult["disposition"] = "continue"

  for (const rule of input.rules) {
    try {
      const output = executeRule(rule, context)
      if (output.outputPath) {
        writeRuntimePath(context, output.outputPath, output.value)
      }
      if (
        rule.outcome &&
        typeof output.value === "boolean" &&
        output.value === (rule.outcome.when === "true")
      ) {
        if (rule.outcome.effect === "warn") {
          warnings.push(rule.outcome.message)
          issues.push({
            code: ruleValidationCode(rule.id),
            message: rule.outcome.message,
            kind: "warning",
          })
        } else {
          messages.push(rule.outcome.message)
          issues.push({
            code: ruleValidationCode(rule.id),
            message: rule.outcome.message,
            kind: "reason",
          })
          disposition =
            rule.outcome.effect === "block" ? "blocked" : "suppressed"
        }
      }
      traces.push({
        ruleId: rule.id,
        operation: rule.operation,
        outputPath: output.outputPath,
        value: output.value,
        ok: true,
        error: null,
      })
      if (disposition !== "continue") break
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Rule execution failed."
      const validationMessage = `${rule.id}: ${message}`
      errors.push(validationMessage)
      issues.push({
        code: ruleValidationCode(
          rule.id,
          error instanceof RuntimePrimitiveError
            ? error.code
            : "execution_failed"
        ),
        message: validationMessage,
        kind: "reason",
      })
      traces.push({
        ruleId: rule.id,
        operation: rule.operation,
        outputPath: "output" in rule ? rule.output : null,
        value: null,
        ok: false,
        error: message,
      })
      break
    }
  }

  return {
    ok: errors.length === 0,
    disposition,
    context,
    traces,
    errors,
    warnings,
    messages,
    issues,
  }
}

function ruleValidationCode(ruleId: string, detail?: string): string {
  const candidates = [
    detail ? `rule:${ruleId}:${detail}` : `rule:${ruleId}`,
    ruleId,
  ]
  return (
    candidates.find(
      (candidate) => identifierSchema.safeParse(candidate).success
    ) ?? "rule_validation_failed"
  )
}

export function resolveValueSource(
  source: SkillValueSource,
  context: Record<string, unknown>,
  ruleId = "projection"
): unknown {
  if ("value" in source) return source.value
  const value = readRuntimePath(context, source.path)
  if (value === undefined) {
    throw new RuntimePrimitiveError(
      "path_not_found",
      ruleId,
      `Required path ${source.path} was not found.`
    )
  }
  return value
}

export function readRuntimePath(
  context: Record<string, unknown>,
  path: string
): unknown {
  const segments = safePathSegments(path)
  let current: unknown = context
  for (const segment of segments) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function executeRule(
  rule: SkillRule,
  context: Record<string, unknown>
): { outputPath: string | null; value: unknown } {
  switch (rule.operation) {
    case "required_fields": {
      const source = readRuntimePath(context, rule.source)
      if (!isRecord(source)) {
        throw new RuntimePrimitiveError(
          "invalid_source",
          rule.id,
          `${rule.source} must be an object.`
        )
      }
      const missing = rule.fields.filter(
        (field) =>
          !Object.hasOwn(source, field) ||
          source[field] === null ||
          source[field] === undefined
      )
      if (missing.length > 0) {
        throw new RuntimePrimitiveError(
          "required_fields_missing",
          rule.id,
          `Missing required fields: ${missing.join(", ")}.`
        )
      }
      return { outputPath: null, value: true }
    }
    case "filter": {
      const source = readRuntimePath(context, rule.source)
      if (!Array.isArray(source)) {
        throw new RuntimePrimitiveError(
          "invalid_source",
          rule.id,
          `${rule.source} must be an array.`
        )
      }
      const filtered = source.filter((item) => {
        const itemContext = {
          ...context,
          context: {
            ...(isRecord(context.context) ? context.context : {}),
            item,
          },
        }
        return rule.all.every((condition) =>
          evaluateComparison(condition, itemContext, rule.id)
        )
      })
      return { outputPath: rule.output, value: filtered }
    }
    case "compare":
      return {
        outputPath: rule.output,
        value: evaluateComparison(rule.condition, context, rule.id),
      }
    case "aggregate": {
      const source = readRuntimePath(context, rule.source)
      if (!Array.isArray(source)) {
        throw new RuntimePrimitiveError(
          "invalid_source",
          rule.id,
          `${rule.source} must be an array.`
        )
      }
      if (rule.function === "count") {
        return { outputPath: rule.output, value: source.length }
      }
      const values = source.map((item) => {
        if (!isRecord(item) || !rule.field) {
          throw new RuntimePrimitiveError(
            "invalid_aggregate_value",
            rule.id,
            "Aggregate rows must be objects with the configured field."
          )
        }
        return finiteNumber(item[rule.field], rule.id)
      })
      if (values.length === 0 && rule.function !== "sum") {
        throw new RuntimePrimitiveError(
          "empty_aggregate",
          rule.id,
          `${rule.function} cannot operate on an empty array.`
        )
      }
      const sum = values.reduce((total, value) => total + value, 0)
      const value =
        rule.function === "sum"
          ? sum
          : rule.function === "average"
            ? sum / values.length
            : rule.function === "min"
              ? Math.min(...values)
              : Math.max(...values)
      return { outputPath: rule.output, value }
    }
    case "freshness": {
      const ageHours = finiteNumber(
        resolveValueSource(rule.age_hours, context, rule.id),
        rule.id
      )
      return {
        outputPath: rule.output,
        value: ageHours <= rule.maximum_hours,
      }
    }
    case "duplicate_check": {
      const quantity = finiteNumber(
        resolveValueSource(rule.quantity, context, rule.id),
        rule.id
      )
      return {
        outputPath: rule.output,
        value: quantity <= rule.allowed_maximum,
      }
    }
    case "threshold": {
      const value = finiteNumber(
        resolveValueSource(rule.value, context, rule.id),
        rule.id
      )
      return {
        outputPath: rule.output,
        value: compareNumbers(value, rule.threshold, rule.operator),
      }
    }
    case "formula": {
      const budget = { operations: 0 }
      const calculated = evaluateExpression(
        rule.expression,
        context,
        rule.id,
        0,
        budget
      )
      const value =
        rule.precision === undefined
          ? calculated
          : roundToPrecision(calculated, rule.precision)
      return { outputPath: rule.output, value }
    }
    case "round_to_pack": {
      const quantity = finiteNumber(
        resolveValueSource(rule.quantity, context, rule.id),
        rule.id
      )
      const packSize = finiteNumber(
        resolveValueSource(rule.pack_size, context, rule.id),
        rule.id
      )
      const minimum = rule.minimum
        ? finiteNumber(
            resolveValueSource(rule.minimum, context, rule.id),
            rule.id
          )
        : 0
      if (packSize <= 0) {
        throw new RuntimePrimitiveError(
          "invalid_pack_size",
          rule.id,
          "Pack size must be greater than zero."
        )
      }
      const value =
        Math.ceil(Math.max(0, quantity, minimum) / packSize) * packSize
      return { outputPath: rule.output, value }
    }
    case "priority": {
      const band = rule.bands.find((candidate) =>
        evaluateComparison(candidate.when, context, rule.id)
      )
      return {
        outputPath: rule.output,
        value: band?.value ?? rule.default,
      }
    }
  }
}

function evaluateExpression(
  expression: SkillExpression,
  context: Record<string, unknown>,
  ruleId: string,
  depth: number,
  budget: { operations: number }
): number {
  if (depth > maximumExpressionDepth) {
    throw new RuntimePrimitiveError(
      "expression_too_deep",
      ruleId,
      "Formula exceeds the maximum expression depth."
    )
  }
  if (!("operator" in expression)) {
    return finiteNumber(resolveValueSource(expression, context, ruleId), ruleId)
  }
  budget.operations += 1
  if (budget.operations > maximumExpressionOperations) {
    throw new RuntimePrimitiveError(
      "expression_too_large",
      ruleId,
      "Formula exceeds the maximum operation count."
    )
  }
  const values = expression.operands.map((operand) =>
    evaluateExpression(operand, context, ruleId, depth + 1, budget)
  )
  switch (expression.operator) {
    case "add":
      return values.reduce((result, value) => result + value, 0)
    case "subtract":
      return values
        .slice(1)
        .reduce((result, value) => result - value, values[0]!)
    case "multiply":
      return values.reduce((result, value) => result * value, 1)
    case "divide":
      return values.slice(1).reduce((result, value) => {
        if (value === 0) {
          throw new RuntimePrimitiveError(
            "division_by_zero",
            ruleId,
            "Formula attempted to divide by zero."
          )
        }
        return result / value
      }, values[0]!)
    case "min":
      return Math.min(...values)
    case "max":
      return Math.max(...values)
  }
}

function evaluateComparison(
  comparison: {
    left: SkillValueSource
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in"
    right: SkillValueSource
  },
  context: Record<string, unknown>,
  ruleId: string
): boolean {
  const left = resolveValueSource(comparison.left, context, ruleId)
  const right = resolveValueSource(comparison.right, context, ruleId)
  switch (comparison.operator) {
    case "eq":
      return valuesEqual(left, right)
    case "neq":
      return !valuesEqual(left, right)
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return compareNumbers(
        finiteNumber(left, ruleId),
        finiteNumber(right, ruleId),
        comparison.operator
      )
    case "in":
    case "not_in": {
      if (!Array.isArray(right)) {
        throw new RuntimePrimitiveError(
          "invalid_membership_value",
          ruleId,
          `${comparison.operator} requires an array on the right side.`
        )
      }
      const included = right.some((value) => valuesEqual(value, left))
      return comparison.operator === "in" ? included : !included
    }
  }
}

function writeRuntimePath(
  context: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const segments = safePathSegments(path)
  let current = context
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment]
    if (next === undefined) {
      current[segment] = {}
    } else if (!isRecord(next)) {
      throw new Error(`Cannot write through non-object path ${path}.`)
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments.at(-1)!] = value
}

function safePathSegments(path: string): string[] {
  const segments = path.split(".")
  if (
    segments.length < 2 ||
    !allowedRoots.has(segments[0]!) ||
    segments.some((segment) => !segment || unsafeSegments.has(segment))
  ) {
    throw new Error(`Unsafe runtime path ${path}.`)
  }
  return segments
}

function finiteNumber(value: unknown, ruleId: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RuntimePrimitiveError(
      "number_required",
      ruleId,
      "Rule expected a finite number."
    )
  }
  return value
}

function compareNumbers(
  left: number,
  right: number,
  operator: "gt" | "gte" | "lt" | "lte"
): boolean {
  if (operator === "gt") return left > right
  if (operator === "gte") return left >= right
  if (operator === "lt") return left < right
  return left <= right
}

function roundToPrecision(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    )
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && valuesEqual(left[key], right[key])
      )
    )
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
